use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::models::ConcurrentTask;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::{concurrent, embedded};
use crate::spawn::{
    argv_needs_confirmation, open_interactive_shell, use_mise_for_project,
    EmbeddedTerminals, TaskMonitors,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::TerminalBuffers;
use crate::spawn::task_monitor;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnProjectTaskPayload {
    pub project_id: String,
    pub argv: Vec<String>,
    pub acknowledge_risk: bool,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub concurrent: Option<Vec<ConcurrentTask>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnProjectTaskResponse {
    pub session_id: String,
    pub stream_output: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectShellPayload {
    pub project_id: String,
}

#[tauri::command]
pub async fn spawn_project_task(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    monitor: State<'_, TaskMonitors>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    payload: SpawnProjectTaskPayload,
) -> Result<SpawnProjectTaskResponse, StableError> {
    let is_concurrent = payload.concurrent.as_ref().map_or(false, |c| !c.is_empty());

    if !is_concurrent && payload.argv.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "argv empty"));
    }
    if !is_concurrent && argv_needs_confirmation(&payload.argv) && !payload.acknowledge_risk {
        return Err(StableError::new(
            codes::CONFIRM_REQUIRED,
            "high-risk command needs confirmation",
        ));
    }
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let project_path = std::path::PathBuf::from(&project.path);
    if !project_path.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project path not a directory",
        ));
    }
    let cwd = if let Some(ref rel) = payload.cwd {
        let resolved = project_path.join(rel);
        if resolved.is_dir() { resolved } else { project_path.clone() }
    } else {
        project_path.clone()
    };

    let use_mise = use_mise_for_project(&cwd);
    let cmd_line = if is_concurrent {
        payload.concurrent.as_ref().unwrap().iter()
            .map(|s| s.label.as_str())
            .collect::<Vec<_>>()
            .join(" + ")
    } else {
        payload.argv.join(" ")
    };

    let shell_pref = {
        let custom = db::get_setting(&pool, "shell_path")
            .await?
            .filter(|s| !s.trim().is_empty());
        if custom.is_some() {
            custom
        } else {
            db::get_setting(&pool, "default_shell_path")
                .await?
                .filter(|s| !s.trim().is_empty())
        }
    };

    let session = db::start_session(&pool, &payload.project_id, Some(cmd_line.clone()), payload.session_id).await?;
    let session_id = session.id.clone();
    let response_session_id = session_id.clone();
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (
            &app,
            &terms,
            &monitor,
            &payload,
            &pool,
            &project,
            &cwd,
            &use_mise,
            &cmd_line,
            &shell_pref,
            &session,
            &session_id,
            &response_session_id,
        );
        return Err(StableError::new(
            codes::INTERNAL,
            "task execution not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if is_concurrent {
            // Concurrent task: spawn multiple PTYs
            let sub_tasks = payload.concurrent.unwrap();
            if let Err(e) = concurrent::spawn_concurrent_tasks(
                app.clone(),
                &terms,
                &buffers,
                &monitor,
                payload.project_id.clone(),
                session_id.clone(),
                cmd_line.clone(),
                session.started_at_ms,
                &cwd,
                &sub_tasks,
                use_mise,
                project.runtime_hint.clone(),
                project.stack.clone(),
                shell_pref,
            ) {
                let _ = db::update_session_runtime(
                    &pool,
                    &session_id,
                    task_monitor::TASK_STATE_ERROR,
                    None,
                    &[],
                    None,
                    Some(e.message.as_str()),
                    db::now_ms(),
                )
                .await;
                let _ = db::end_session(&pool, &session_id).await;
                return Err(e);
            }
        } else {
            // Single task: spawn one PTY
            if let Err(e) = embedded::spawn_task_in_pty(
                app.clone(),
                &terms,
                &buffers,
                &monitor,
                payload.project_id.clone(),
                Some(cmd_line.clone()),
                session.started_at_ms,
                &cwd,
                &payload.argv,
                use_mise,
                session_id.clone(),
                project.runtime_hint.clone(),
                project.stack.clone(),
                shell_pref,
            ) {
                let _ = db::update_session_runtime(
                    &pool,
                    &session_id,
                    task_monitor::TASK_STATE_ERROR,
                    None,
                    &[],
                    None,
                    Some(e.message.as_str()),
                    db::now_ms(),
                )
                .await;
                let _ = db::end_session(&pool, &session_id).await;
                return Err(e);
            }
        }
        return Ok(SpawnProjectTaskResponse {
            session_id: response_session_id,
            stream_output: true,
        });
    }
}

#[tauri::command]
pub async fn open_project_shell(
    db: State<'_, DbInstances>,
    payload: OpenProjectShellPayload,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let cwd = std::path::PathBuf::from(&project.path);
    if !cwd.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project path not a directory",
        ));
    }
    let shell_pref = db::get_setting(&pool, "shell_path")
        .await?
        .filter(|s| !s.trim().is_empty());
    open_interactive_shell(&cwd, shell_pref.as_deref())?;
    db::touch_project_opened(&pool, &payload.project_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn stop_project_task(
    app: AppHandle,
    monitor: State<'_, TaskMonitors>,
    session_id: String,
) -> Result<(), StableError> {
    task_monitor::request_stop(app, &monitor, &session_id).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShellAtPathPayload {
    pub path: String,
}

#[tauri::command]
pub async fn open_shell_at_path(
    payload: OpenShellAtPathPayload,
) -> Result<(), StableError> {
    let cwd = std::path::PathBuf::from(&payload.path);
    if !cwd.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "path not a directory",
        ));
    }
    open_interactive_shell(&cwd, None)?;
    Ok(())
}
