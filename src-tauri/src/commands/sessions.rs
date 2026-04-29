use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::SessionDto;
use crate::spawn::{TaskMonitorEntry, TaskMonitors, ProjectIdeSessions};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionPayload {
    pub project_id: String,
    pub command: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDto {
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub command: Option<String>,
    pub state: String,
    pub root_pid: Option<u32>,
    pub ports: Vec<u16>,
    pub started_at_ms: i64,
    pub last_event_at_ms: i64,
    pub kind: String,
}

#[tauri::command]
pub async fn start_session(
    db: State<'_, DbInstances>,
    payload: StartSessionPayload,
) -> Result<SessionDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::start_session(&pool, &payload.project_id, payload.command, payload.session_id).await
}

#[tauri::command]
pub async fn end_session(
    db: State<'_, DbInstances>,
    session_id: String,
) -> Result<SessionDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::end_session(&pool, &session_id).await
}

#[tauri::command]
pub async fn list_sessions_for_project(
    db: State<'_, DbInstances>,
    project_id: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<SessionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_sessions_for_project(&pool, &project_id, limit, offset).await
}

#[tauri::command]
pub async fn list_active_sessions(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Vec<SessionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_active_sessions_for_project(&pool, &project_id).await
}

#[tauri::command]
pub async fn recover_orphan_sessions(db: State<'_, DbInstances>) -> Result<u64, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::recover_orphan_sessions(&pool).await
}

#[tauri::command]
pub async fn clear_sessions_for_project(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<u64, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::clear_sessions_for_project(&pool, &project_id).await
}

#[tauri::command]
pub async fn get_session_count_for_project(
    db: State<'_, DbInstances>,
    project_id: String,
    state_filter: Option<String>,
) -> Result<i64, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::get_session_count_for_project(&pool, &project_id, state_filter.as_deref()).await
}

#[tauri::command]
pub async fn stop_all_project_processes(
    app: AppHandle,
    _db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    ide_sessions: State<'_, ProjectIdeSessions>,
    project_id: String,
) -> Result<(), StableError> {
    // Stop IDE session first
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = crate::spawn::ide_session::stop_ide_session(&ide_sessions, &project_id);
    }

    // Stop all task sessions for this project
    let session_ids: Vec<String> = {
        let guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
        guard
            .values()
            .filter(|e| e.project_id == project_id && !e.finished)
            .map(|e| e.session_id.clone())
            .collect()
    };

    for session_id in session_ids {
        let _ = crate::spawn::task_monitor::request_stop(app.clone(), &monitors, &session_id).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn list_all_processes(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    ide_sessions: State<'_, ProjectIdeSessions>,
) -> Result<Vec<ProcessDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;

    // Collect task monitor entries
    let entries: Vec<TaskMonitorEntry> = {
        let guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
        guard
            .values()
            .filter(|e| !e.finished)
            .cloned()
            .collect()
    };

    // Collect IDE sessions
    let ide_entries: Vec<(String, Option<u32>)> = {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let guard = ide_sessions.0.lock().unwrap();
            guard
                .iter()
                .map(|(project_id, session)| (project_id.clone(), session.pid))
                .collect()
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            Vec::new()
        }
    };

    let mut out = Vec::new();
    for entry in entries {
        let project_name = db::get_project(&pool, &entry.project_id)
            .await
            .map(|p| p.name)
            .unwrap_or_else(|_| String::new());
        out.push(ProcessDto {
            session_id: entry.session_id.clone(),
            project_id: entry.project_id.clone(),
            project_name,
            command: entry.command.clone(),
            state: entry.state.clone(),
            root_pid: entry.root_pid,
            ports: entry.ports.clone(),
            started_at_ms: entry.started_at_ms,
            last_event_at_ms: entry.last_event_at_ms,
            kind: "task".to_string(),
        });
    }
    for (project_id, pid) in ide_entries {
        let project_name = db::get_project(&pool, &project_id)
            .await
            .map(|p| p.name)
            .unwrap_or_else(|_| String::new());
        out.push(ProcessDto {
            session_id: format!("ide-{project_id}"),
            project_id: project_id.clone(),
            project_name,
            command: Some("IDE".to_string()),
            state: "running".to_string(),
            root_pid: pid,
            ports: Vec::new(),
            started_at_ms: 0,
            last_event_at_ms: 0,
            kind: "ide".to_string(),
        });
    }
    out.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
    Ok(out)
}
