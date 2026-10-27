mod go2rtc;

use go2rtc::{Go2rtc, StreamInfo};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

/// The built app is served from `http://127.0.0.1:<port>`: WKWebView makes a page cross-origin isolated (needed for
/// `SharedArrayBuffer`, used by OpenCV's threads) only for real HTTP responses, not for the `tauri://` scheme. The
/// port is fixed because it is part of the origin, which keeps the settings in local storage.
const APP_PORT: u16 = 41987;

/// Starts serving an RTSP camera through the bundled go2rtc and returns where the web app connects to it.
#[tauri::command]
async fn go2rtc_stream(app: AppHandle, go2rtc: State<'_, Go2rtc>, url: String) -> Result<StreamInfo, String> {
    go2rtc.stream(&app, &url).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    if !tauri::is_dev() {
        builder = builder.plugin(
            tauri_plugin_localhost::Builder::new(APP_PORT)
                .host("127.0.0.1")
                .on_request(|_, response| {
                    response.add_header("Cross-Origin-Opener-Policy", "same-origin");
                    response.add_header("Cross-Origin-Embedder-Policy", "require-corp");
                })
                .build(),
        );
    }
    builder
        .plugin(tauri_plugin_shell::init())
        // The machine controller's `ws://` socket and file upload go through Rust, so neither mixed-content
        // blocking nor Chrome's Local Network Access applies, whatever engine the webview uses.
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .manage(Go2rtc::default())
        .setup(|app| {
            // The dev build loads the vite dev server (`build.devUrl`), which sets the headers itself.
            let url = if tauri::is_dev() {
                WebviewUrl::App("index.html".into())
            } else {
                WebviewUrl::External(format!("http://127.0.0.1:{APP_PORT}").parse().expect("valid app URL"))
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("camNC")
                .inner_size(1400.0, 900.0)
                .min_inner_size(800.0, 600.0)
                .build()?;
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    if let Some(settings) = webview.inner().settings() {
                        // Off by default in WebKitGTK; go2rtc delivers the camera over WebRTC.
                        settings.set_enable_webrtc(true);
                        settings.set_enable_media_stream(true);
                        settings.set_enable_write_console_messages_to_stdout(cfg!(debug_assertions));
                    }
                })?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![go2rtc_stream])
        .build(tauri::generate_context!())
        .expect("error while building the camNC desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Go2rtc>().stop();
            }
        });
}
