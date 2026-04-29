use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::time::interval;

use crate::db;
use crate::search::indexer::build_project_index;

/// Start a background task that re-scans all indexed projects periodically.
pub fn start_background_scanner(app: AppHandle, period_minutes: u64) {
    if period_minutes == 0 {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_secs(period_minutes * 60));
        ticker.tick().await; // first tick fires immediately, wait for it

        loop {
            ticker.tick().await;

            let app_data_dir = match app.path().app_data_dir() {
                Ok(d) => d,
                Err(_) => continue,
            };

            let db = match app.try_state::<tauri_plugin_sql::DbInstances>() {
                Some(d) => d,
                None => continue,
            };

            let pool = match db::sqlite_pool(&*db).await {
                Ok(p) => p,
                Err(_) => continue,
            };

            let projects = match db::list_projects(&pool).await {
                Ok(p) => p,
                Err(_) => continue,
            };

            for project in projects {
                let index_dir = crate::search::index_dir(&app_data_dir, &project.id);
                if !index_dir.exists() {
                    continue;
                }

                let app_data = app_data_dir.clone();
                let pid = project.id.clone();
                let path = PathBuf::from(&project.path);

                // Spawn each rebuild in its own task so one failure doesn't block others.
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::task::spawn_blocking(move || {
                        let _ = build_project_index(&app_data, &pid, &path);
                    }).await;
                });
            }
        }
    });
}
