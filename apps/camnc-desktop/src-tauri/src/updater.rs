//! Keeps release builds on the newest build of `main`: checks the latest GitHub release, downloads a newer version in
//! the background and tells the page, which offers a restart. Nothing restarts on its own, so a running machine job is
//! never interrupted.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The first check waits for the app to settle; later checks catch builds released while the app stays open.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

/// Event sent to the page once an update is ready.
pub const UPDATE_READY_EVENT: &str = "update-ready";

#[derive(Clone, Serialize)]
pub struct ReadyUpdate {
    pub version: String,
}

enum Pending {
    /// macOS and Linux replace the app in place; the new version runs after a restart.
    Installed(String),
    /// Windows runs an installer that quits the app, so it only runs when the user restarts.
    Downloaded(Box<Update>, Vec<u8>),
}

#[derive(Default)]
pub struct UpdaterState(Mutex<Option<Pending>>);

impl UpdaterState {
    fn version(&self) -> Option<String> {
        match self.0.lock().unwrap().as_ref()? {
            Pending::Installed(version) => Some(version.clone()),
            Pending::Downloaded(update, _) => Some(update.version.clone()),
        }
    }
}

/// Checks for updates now and then until one is ready.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            match prepare(&app).await {
                Ok(Some(version)) => {
                    let _ = app.emit(UPDATE_READY_EVENT, ReadyUpdate { version });
                    return;
                }
                Ok(None) => {}
                // Offline, or the release is still being published: try again later.
                Err(err) => eprintln!("update check failed: {err}"),
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn prepare<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_updater::Result<Option<String>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    let pending = if cfg!(windows) {
        Pending::Downloaded(Box::new(update), bytes)
    } else {
        update.install(&bytes)?;
        Pending::Installed(version.clone())
    };
    *app.state::<UpdaterState>().0.lock().unwrap() = Some(pending);
    Ok(Some(version))
}

/// The version of an update that is ready, for a page that missed the event.
#[tauri::command]
pub fn ready_update(state: State<'_, UpdaterState>) -> Option<ReadyUpdate> {
    state.version().map(|version| ReadyUpdate { version })
}

/// Restarts into the ready update.
#[tauri::command]
pub fn restart_to_update(app: AppHandle, state: State<'_, UpdaterState>) -> Result<(), String> {
    match state.0.lock().unwrap().take() {
        // Quits the app; the installer starts the new version.
        Some(Pending::Downloaded(update, bytes)) => {
            update.install(bytes).map_err(|err| err.to_string())
        }
        Some(Pending::Installed(_)) => app.restart(),
        None => Err("No update is ready".into()),
    }
}
