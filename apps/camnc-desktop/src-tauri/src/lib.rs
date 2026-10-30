mod discovery;
mod go2rtc;
mod updater;

use go2rtc::{Go2rtc, StreamInfo};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_runtime_cef::{Cef, RemoteDebugging, SecretStorage};

/// In debug builds, Chromium's DevTools protocol listens here, so Playwright (`chromium.connectOverCDP`) and
/// `chrome://inspect` can drive and debug the app like the web app in Chrome.
const DEBUG_CDP_PORT: u16 = 9222;

/// Starts serving an RTSP camera through the bundled go2rtc and returns where the web app connects to it.
#[tauri::command]
async fn go2rtc_stream(
    app: AppHandle,
    go2rtc: State<'_, Go2rtc>,
    url: String,
) -> Result<StreamInfo, String> {
    go2rtc.stream(&app, &url).await
}

/// Looks for IP cameras on the local network (ONVIF discovery and the RTSP port).
#[tauri::command]
async fn discover_cameras() -> Vec<discovery::FoundCamera> {
    discovery::discover().await
}

/// Asks an ONVIF camera for its streams with the login; the URLs include the login.
#[tauri::command]
async fn onvif_streams(
    onvif_url: String,
    user: String,
    password: String,
) -> Result<Vec<discovery::CameraStream>, String> {
    discovery::onvif_streams(&onvif_url, &user, &password).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Chromium (CEF) rather than the system webview: the app behaves like camNC in Chrome on every platform,
    // including WebRTC, WebGPU and the cross-origin isolation OpenCV's threads need.
    let mut cef = Cef::default();
    if cfg!(debug_assertions) {
        cef = cef
            .remote_debugging(RemoteDebugging::Port {
                port: DEBUG_CDP_PORT,
                allowed_origins: vec![],
            })
            // Debug builds are ad-hoc signed, so the keychain item Chromium keeps its cookie key in would ask for the
            // login password after every rebuild. The app keeps no cookies worth protecting.
            .secret_storage(SecretStorage::Mock);
    }
    tauri::Builder::default()
        .runtime(cef)
        .plugin(tauri_plugin_shell::init())
        // The machine controller's `ws://` socket and file upload go through Rust, so neither mixed-content
        // blocking nor Chrome's Local Network Access permission applies.
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Go2rtc::default())
        .manage(updater::UpdaterState::default())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("camNC")
                .inner_size(1400.0, 900.0)
                .min_inner_size(800.0, 600.0)
                // The webcam source; macOS asks the user once more (NSCameraUsageDescription in Info.plist).
                .on_permission_request(|_, kind| match kind {
                    PermissionKind::Camera => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .build()?;
            // Development builds are not released, so they would always find an "update".
            if !cfg!(debug_assertions) {
                updater::spawn(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            go2rtc_stream,
            discover_cameras,
            onvif_streams,
            updater::ready_update,
            updater::restart_to_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building the camNC desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Go2rtc>().stop();
            }
        });
}
