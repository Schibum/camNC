fn main() {
    // App commands get generated `allow-…` permissions, which the capability grants to the app's page.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "go2rtc_stream",
            "discover_cameras",
            "onvif_streams",
        ]),
    ))
    .expect("failed to run tauri-build");
}
