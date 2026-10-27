//! Runs a bundled go2rtc as a sidecar, so the web app can show RTSP cameras through go2rtc's WebRTC API on
//! `127.0.0.1`. One go2rtc process serves every camera. Its config lists the streams and its API only allows the
//! WebSocket endpoint, so nothing else on this computer (e.g. a web page) can add `exec:` sources through it. A new
//! camera therefore restarts go2rtc with the new config, which only happens when a camera is set up.

use std::collections::BTreeMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

/// What the web app passes to its go2rtc client (`go2rtc:?host=…&src=…`).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StreamInfo {
    pub host: String,
    pub src: String,
}

struct Running {
    child: CommandChild,
    api_port: u16,
    /// Bumped on every start, so the exit watcher of an old process does not clear a newer one.
    generation: u64,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    generation: u64,
    /// Stream name -> source URL.
    streams: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct Go2rtc {
    inner: Mutex<Inner>,
}

const READY_TIMEOUT: Duration = Duration::from_secs(10);

impl Go2rtc {
    /// Makes sure go2rtc runs and serves `url`, and returns where the web app connects to it.
    pub async fn stream<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        url: &str,
    ) -> Result<StreamInfo, String> {
        validate_source(url)?;
        let name = stream_name(url);
        let mut inner = self.inner.lock().await;
        let is_new = inner
            .streams
            .insert(name.clone(), url.to_string())
            .is_none();

        if is_new {
            if let Some(running) = inner.running.take() {
                let _ = running.child.kill();
            }
        }
        let api_port = match &inner.running {
            Some(running) => running.api_port,
            None => start(app, &mut inner).await?,
        };
        Ok(StreamInfo {
            host: format!("http://127.0.0.1:{api_port}"),
            src: name,
        })
    }

    /// Stops go2rtc, e.g. when the app exits.
    pub fn stop(&self) {
        if let Ok(mut inner) = self.inner.try_lock() {
            if let Some(running) = inner.running.take() {
                let _ = running.child.kill();
            }
        }
    }
}

async fn start<R: Runtime>(app: &AppHandle<R>, inner: &mut Inner) -> Result<u16, String> {
    let pid_file = app_data_dir(app)?.join("go2rtc.pid");
    kill_stale(&pid_file);
    let api_port = free_port()?;
    let config = write_config(app, api_port, &inner.streams)?;
    let (mut events, child) = app
        .shell()
        .sidecar("go2rtc")
        .map_err(|e| format!("go2rtc is missing from the app: {e}"))?
        .args(["-config", &config.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("could not start go2rtc: {e}"))?;
    // If the app is killed rather than quit, go2rtc outlives it; the next start stops that one.
    let _ = std::fs::write(&pid_file, child.pid().to_string());
    inner.generation += 1;
    let generation = inner.generation;
    inner.running = Some(Running {
        child,
        api_port,
        generation,
    });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[go2rtc] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[go2rtc] exited: {status:?}");
                    // The next stream request starts it again with every stream from the config.
                    let state = handle.state::<Go2rtc>();
                    let mut inner = state.inner.lock().await;
                    if inner
                        .running
                        .as_ref()
                        .is_some_and(|r| r.generation == generation)
                    {
                        inner.running = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    wait_until_ready(api_port).await?;
    Ok(api_port)
}

/// Accepts the camera sources go2rtc can open by itself, without ffmpeg.
fn validate_source(url: &str) -> Result<(), String> {
    let scheme = url.split_once("://").map(|(s, _)| s.to_ascii_lowercase());
    match scheme.as_deref() {
        Some("rtsp" | "rtsps" | "rtmp") => Ok(()),
        _ => Err(format!(
            "unsupported camera URL, expected rtsp://…: {}",
            redact(url)
        )),
    }
}

/// A stable name per source URL that does not leak its credentials into URLs and logs.
fn stream_name(url: &str) -> String {
    // FNV-1a, stable across runs and platforms.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("camera_{:016x}", hash)
}

/// The URL with any `user:password@` removed, for error messages.
fn redact(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(scheme_end), Some(at)) if at > scheme_end => {
            format!("{}***{}", &url[..scheme_end + 3], &url[at..])
        }
        _ => url.to_string(),
    }
}

fn free_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no free port for go2rtc: {e}"))?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

/// go2rtc reads YAML, and JSON is valid YAML.
fn config_json(api_port: u16, streams: &BTreeMap<String, String>) -> serde_json::Value {
    serde_json::json!({
        // Only this computer may use the API. `origin: "*"` lets the app page (tauri://localhost or
        // http://tauri.localhost) open the WebSocket.
        "api": { "listen": format!("127.0.0.1:{api_port}"), "origin": "*", "allow_paths": ["/api/ws"] },
        // Restreaming is not needed, and its default ports could clash with a go2rtc already running here.
        "rtsp": { "listen": "" },
        "rtmp": { "listen": "" },
        "srtp": { "listen": "" },
        // WebRTC to the app on the same computer: no fixed port, so it never clashes with another go2rtc.
        "webrtc": { "listen": "", "candidates": [] },
        "streams": streams,
    })
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Stops a go2rtc left running by an earlier app process, if the pid in `pid_file` is still a go2rtc.
fn kill_stale(pid_file: &std::path::Path) {
    let Some(pid) = std::fs::read_to_string(pid_file)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
    else {
        return;
    };
    let _ = std::fs::remove_file(pid_file);
    let pid = pid.to_string();
    #[cfg(unix)]
    {
        let name = std::process::Command::new("ps")
            .args(["-p", &pid, "-o", "comm="])
            .output();
        if name.is_ok_and(|out| String::from_utf8_lossy(&out.stdout).contains("go2rtc")) {
            let _ = std::process::Command::new("kill").arg(&pid).status();
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let filter = format!("PID eq {pid}");
        let name = std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if name.is_ok_and(|out| String::from_utf8_lossy(&out.stdout).contains("go2rtc")) {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid, "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }
}

fn write_config<R: Runtime>(
    app: &AppHandle<R>,
    api_port: u16,
    streams: &BTreeMap<String, String>,
) -> Result<PathBuf, String> {
    let path = app_data_dir(app)?.join("go2rtc.yaml");
    let json =
        serde_json::to_string_pretty(&config_json(api_port, streams)).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path)
}

async fn wait_until_ready(api_port: u16) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        if TcpStream::connect(("127.0.0.1", api_port)).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() > deadline {
            return Err("go2rtc did not start in time".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_rtsp_only() {
        assert!(validate_source("rtsp://admin:pw@192.168.1.5:554/h264Preview_01_main").is_ok());
        assert!(validate_source("RTSPS://cam.local/stream").is_ok());
        assert!(validate_source("exec:rm -rf /").is_err());
        assert!(validate_source("ffmpeg:rtsp://x").is_err());
        assert!(validate_source("http://cam/").is_err());
    }

    #[test]
    fn stream_name_is_stable_and_hides_credentials() {
        let url = "rtsp://admin:secret@192.168.1.5/";
        assert_eq!(stream_name(url), stream_name(url));
        assert_ne!(
            stream_name(url),
            stream_name("rtsp://admin:secret@192.168.1.6/")
        );
        assert!(!stream_name(url).contains("secret"));
    }

    #[test]
    fn redacts_credentials() {
        assert_eq!(redact("ftp://admin:p@ss@host/x"), "ftp://***@host/x");
        assert_eq!(redact("ftp://host/x"), "ftp://host/x");
    }

    #[test]
    fn config_binds_api_to_loopback() {
        let mut streams = BTreeMap::new();
        streams.insert("camera_1".to_string(), "rtsp://h/".to_string());
        let config = config_json(1234, &streams);
        assert_eq!(config["api"]["listen"], "127.0.0.1:1234");
        assert_eq!(config["api"]["allow_paths"], serde_json::json!(["/api/ws"]));
        assert_eq!(config["rtsp"]["listen"], "");
        assert_eq!(config["streams"]["camera_1"], "rtsp://h/");
    }
}
