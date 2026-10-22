use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::SessionDto;
use crate::spawn::task_monitor::{TASK_STATE_RUNNING, TASK_STATE_STARTING};
use crate::spawn::{ProjectIdeSessions, TaskMonitorEntry, TaskMonitors};

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
    db::start_session(
        &pool,
        &payload.project_id,
        payload.command,
        payload.session_id,
    )
    .await
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
pub async fn list_all_active_sessions(
    db: State<'_, DbInstances>,
) -> Result<Vec<SessionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_active_sessions_for_project_all(&pool).await
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
    #[cfg(not(any(target_os = "android", target_os = "ios")))] terms: State<
        '_,
        crate::spawn::EmbeddedTerminals,
    >,
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Emitter;
        // Exact project_id matches
        let _ = crate::spawn::embedded::kill_project_terminals(&terms, &project_id);
        // Prefix-matched terminals (global terminals opened inside a project path)
        let metas = crate::spawn::embedded::list_terminal_metas(&terms);
        // Need project path for prefix match — resolve via db if available
        let target_prefixes: Vec<String> = {
            // Best-effort: try to get the project path from the db
            #[allow(unused_assignments)]
            let mut out: Vec<String> = Vec::new();
            // _db is DbInstances; resolve pool best-effort
            if let Ok(pool) = crate::db::sqlite_pool(&_db).await {
                if let Ok(p) = crate::db::get_project(&pool, &project_id).await {
                    out.push(p.path);
                }
                if let Ok(all) = crate::db::list_projects(&pool).await {
                    // include only this project's path (already pushed); keep for clarity
                    let _ = all;
                }
            }
            out
        };
        for meta in metas {
            if meta.project_id.as_deref() == Some(project_id.as_str()) {
                continue; // already killed
            }
            if meta.project_id.is_some() {
                continue; // belongs to another project
            }
            let mut matched = false;
            for prefix in &target_prefixes {
                if path_is_within(&meta.cwd, prefix) {
                    matched = true;
                    break;
                }
            }
            if matched {
                let _ = crate::spawn::embedded::kill_session(&terms, &meta.session_id);
            }
        }
        let _ = app.emit(
            "terminal-state-changed",
            serde_json::json!({ "projectId": project_id, "running": false }),
        );
    }

    Ok(())
}

#[cfg(windows)]
fn normalize_path_sep(p: &str) -> String {
    let mut s = p.replace('/', "\\");
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

#[cfg(not(windows))]
fn normalize_path_sep(p: &str) -> String {
    let mut t = p.to_string();
    while t.len() > 1 && t.ends_with('/') {
        t.pop();
    }
    t
}

#[cfg(windows)]
fn path_is_within(cwd: &str, prefix: &str) -> bool {
    let c = normalize_path_sep(cwd);
    let p = normalize_path_sep(prefix);
    c == p || c.starts_with(&format!("{p}\\"))
}

#[cfg(not(windows))]
fn path_is_within(cwd: &str, prefix: &str) -> bool {
    let c = normalize_path_sep(cwd);
    let p = normalize_path_sep(prefix);
    c == p || c.starts_with(&format!("{p}/"))
}

fn resolve_terminal_project<'a>(
    meta_project_id: Option<&str>,
    cwd: &str,
    projects: &'a [(String, String, String)],
) -> Option<&'a (String, String, String)> {
    if let Some(pid) = meta_project_id {
        return projects.iter().find(|(id, _, _)| id == pid);
    }
    // Longest prefix match of cwd against project paths
    let mut best: Option<&'a (String, String, String)> = None;
    let mut best_len = 0usize;
    for proj in projects {
        let path = &proj.1;
        if path_is_within(cwd, path) && path.len() > best_len {
            best_len = path.len();
            best = Some(proj);
        }
    }
    best
}

#[tauri::command]
pub async fn list_all_processes(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    ide_sessions: State<'_, ProjectIdeSessions>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))] terms: State<
        '_,
        crate::spawn::EmbeddedTerminals,
    >,
) -> Result<Vec<ProcessDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;

    // Collect task monitor entries + their session ids (for terminal double-count skip)
    let (entries, monitor_ids): (Vec<TaskMonitorEntry>, std::collections::HashSet<String>) = {
        let guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
        let ids: std::collections::HashSet<String> =
            guard.keys().cloned().collect();
        let live: Vec<TaskMonitorEntry> = guard
            .values()
            .filter(|e| {
                !e.finished && (e.state == TASK_STATE_STARTING || e.state == TASK_STATE_RUNNING)
            })
            .cloned()
            .collect();
        (live, ids)
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
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let metas = crate::spawn::embedded::list_terminal_metas(&terms);
        if !metas.is_empty() {
            let all = db::list_projects(&pool).await.unwrap_or_default();
            // (id, path, name)
            let projects: Vec<(String, String, String)> = all
                .into_iter()
                .map(|p| (p.id, p.path, p.name))
                .collect();
            // Single sysinfo snapshot for all terminals: only PTYs with a
            // live child task AND past the 5s debounce count as active.
            // `spawn_task_in_pty` PTYs are already covered by TaskMonitors,
            // so skip those session ids to avoid double-counting.
            let now_ms = db::now_ms();
            let mut sys = sysinfo::System::new_all();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            for meta in metas {
                if monitor_ids.contains(&meta.session_id) {
                    continue;
                }
                if !crate::spawn::embedded::terminal_is_active(
                    meta.started_at_ms,
                    meta.root_pid,
                    now_ms,
                    &sys,
                ) {
                    continue;
                }
                if let Some((pid, _, pname)) = resolve_terminal_project(
                    meta.project_id.as_deref(),
                    &meta.cwd,
                    &projects,
                ) {
                    out.push(ProcessDto {
                        session_id: meta.session_id.clone(),
                        project_id: pid.clone(),
                        project_name: pname.clone(),
                        command: Some("terminal".to_string()),
                        state: "running".to_string(),
                        root_pid: meta.root_pid,
                        ports: Vec::new(),
                        started_at_ms: meta.started_at_ms,
                        last_event_at_ms: meta.started_at_ms,
                        kind: "terminal".to_string(),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
    Ok(out)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionDto {
    pub session_id: String,
    pub project_id: Option<String>,
    pub cwd: String,
    pub started_at_ms: i64,
    pub is_active: bool,
}

#[tauri::command]
pub async fn list_terminal_sessions(
    db: State<'_, DbInstances>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))] terms: State<
        '_,
        crate::spawn::EmbeddedTerminals,
    >,
) -> Result<Vec<TerminalSessionDto>, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = db;
        return Ok(Vec::new());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let pool = db::sqlite_pool(&*db).await?;
        let metas = crate::spawn::embedded::list_terminal_metas(&terms);
        let all = db::list_projects(&pool).await.unwrap_or_default();
        let projects: Vec<(String, String, String)> = all
            .into_iter()
            .map(|p| (p.id, p.path, p.name))
            .collect();
        let now_ms = db::now_ms();
        let mut sys = sysinfo::System::new_all();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        let mut out = Vec::with_capacity(metas.len());
        for meta in metas {
            let resolved = resolve_terminal_project(
                meta.project_id.as_deref(),
                &meta.cwd,
                &projects,
            )
            .map(|(id, _, _)| id.clone())
            .or(meta.project_id.clone());
            let is_active = crate::spawn::embedded::terminal_is_active(
                meta.started_at_ms,
                meta.root_pid,
                now_ms,
                &sys,
            );
            out.push(TerminalSessionDto {
                session_id: meta.session_id,
                project_id: resolved,
                cwd: meta.cwd,
                started_at_ms: meta.started_at_ms,
                is_active,
            });
        }
        Ok(out)
    }
}
