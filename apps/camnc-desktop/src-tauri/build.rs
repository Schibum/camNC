fn main() {
    // App commands get generated `allow-…` permissions, so the capability can grant them to the app's page, which
    // Tauri treats as a remote origin (it is served from 127.0.0.1, see APP_PORT in src/lib.rs).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["go2rtc_stream"])),
    )
    .expect("failed to run tauri-build");
}
