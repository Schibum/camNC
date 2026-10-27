mod go2rtc;

use go2rtc::{Go2rtc, StreamInfo};
use tauri::{AppHandle, Manager, RunEvent, State};

/// Starts serving an RTSP camera through the bundled go2rtc and returns where the web app connects to it.
#[tauri::command]
async fn go2rtc_stream(app: AppHandle, go2rtc: State<'_, Go2rtc>, url: String) -> Result<StreamInfo, String> {
    go2rtc.stream(&app, &url).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // The machine controller's `ws://` socket and file upload go through Rust, so neither mixed-content
        // blocking nor Chrome's Local Network Access applies, whatever engine the webview uses.
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .manage(Go2rtc::default())
        .setup(|app| {
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
            #[cfg(not(target_os = "linux"))]
            let _ = app;
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
