//! Runtime watchers: location, git, file, background scanner, clipboard.
//! (Extracted verbatim from the `run()` setup closure in `lib.rs`.)

/// Start all runtime watchers. The file watcher is fallible, hence the Result.
pub fn start_watchers(
    app: &mut tauri::App,
    handle: &tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Manager;
    let watcher = crate::location_watcher::LocationWatcher::new(handle.clone());
    let watcher_spawn = watcher.clone();
    tauri::async_runtime::spawn(async move {
        watcher_spawn.watch_all_enabled().await;
    });
    app.manage(watcher);

    let git_watcher = crate::git_watcher::GitWatcher::new(handle.clone());
    app.manage(git_watcher);

    let file_watcher = std::sync::Arc::new(
        crate::file_watcher::FileWatcher::new(handle.clone())
            .map_err(|e| format!("file watcher init: {e}"))?,
    );
    app.manage(file_watcher);

    crate::search::background::start_background_scanner(handle.clone(), 15);
    crate::clipboard_history::start_watcher(handle.clone());
    Ok(())
}
