//! Startup orphan recovery: re-register live sessions, fail the dead.
//! (Extracted verbatim from the `run()` setup closure in `lib.rs`.)

use tauri::{AppHandle, Manager};

use crate::db;

/// Re-register sessions whose PIDs are still alive; mark the rest errored.
pub async fn recover_orphans(handle: &AppHandle) {
    let db = handle.state::<tauri_plugin_sql::DbInstances>();
    let monitors = handle.state::<crate::spawn::TaskMonitors>().clone();
    if let Ok(pool) = db::sqlite_pool(&*db).await {
        let orphans = db::list_active_sessions_for_project_all(&pool).await.ok().unwrap_or_default();
        let mut sys = sysinfo::System::new_all();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for s in orphans {
            let alive = s.root_pid.map(|pid| sys.process(sysinfo::Pid::from(pid as usize)).is_some()).unwrap_or(false);
            if alive {
                let _ = crate::spawn::task_monitor::reregister_task(
                    handle,
                    &monitors,
                    s.id.clone(),
                    s.project_id.clone(),
                    s.command.clone(),
                    s.root_pid,
                    s.started_at_ms,
                );
            } else {
                let now = db::now_ms();
                let _ = sqlx::query("UPDATE sessions SET ended_at_ms = ?1, state = 'error', stop_reason = COALESCE(stop_reason, 'Process not found on startup'), last_event_at_ms = ?1 WHERE id = ?2")
                    .bind(now)
                    .bind(&s.id)
                    .execute(&pool)
                    .await;
            }
        }

        super::playtime::spawn_playtime_tracker(pool.clone());

        if let Ok(locs) = db::list_locations(&pool).await {
            for loc in locs {
                let _ = crate::fs_scope_util::allow_library_root(handle, &loc.path);
            }
        }

        super::mcp::maybe_autostart_mcp_server(handle, &pool).await;
    }
}
