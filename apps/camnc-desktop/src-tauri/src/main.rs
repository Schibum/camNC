// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Chromium starts its helper processes from this executable; the attribute runs them and returns early.
#[tauri_runtime_cef::cef_entry_point]
fn main() {
    camnc_desktop_lib::run()
}
