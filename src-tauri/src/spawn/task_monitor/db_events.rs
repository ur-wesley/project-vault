use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use super::types::{
    TaskExitEmit, TaskMonitorEntry, TaskMonitors, TaskStateEmit, TaskTreeEmit,
    TASK_STATE_SUCCESS,
};
use super::actions::snapshot_task;

pub async fn persist_snapshot(
    app: &AppHandle,
    monitors: &TaskMonitors,
    session_id: &str,
) -> Result<(), StableError> {
    let snapshot = snapshot_task(monitors, session_id)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "task session not found"))?;
    persist_from_snapshot(app, &snapshot).await
}

pub async fn persist_final_state(
    app: &AppHandle,
    snapshot: &TaskMonitorEntry,
    state: &str,
    exit_code: Option<i32>,
    stop_reason: Option<String>,
) -> Result<(), StableError> {
    let mut final_snapshot = snapshot.clone();
    final_snapshot.state = state.to_string();
    final_snapshot.exit_code = exit_code;
    final_snapshot.stop_reason = stop_reason;
    final_snapshot.last_event_at_ms = db::now_ms();
    persist_from_snapshot(app, &final_snapshot).await
}

pub async fn persist_from_snapshot(
    app: &AppHandle,
    snapshot: &TaskMonitorEntry,
) -> Result<(), StableError> {
    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;
    let tree_pids: Vec<u32> = snapshot.tree_pids.iter().copied().collect();
    let _ = db::update_session_runtime(
        &pool,
        &snapshot.session_id,
        &snapshot.state,
        snapshot.root_pid,
        &tree_pids,
        snapshot.exit_code,
        snapshot.stop_reason.as_deref(),
        snapshot.last_event_at_ms,
    )
    .await?;
    Ok(())
}

pub fn emit_live_events(app: &AppHandle, monitors: &TaskMonitors, session_id: &str) -> Result<(), StableError> {
    if let Some(snapshot) = snapshot_task(monitors, session_id) {
        let _ = app.emit("task-state-changed", task_state_emit(&snapshot));
        let _ = app.emit("task-tree-changed", task_tree_emit(&snapshot));
    }
    Ok(())
}

pub fn emit_final_events(
    app: &AppHandle,
    snapshot: &TaskMonitorEntry,
    state: &str,
    exit_code: Option<i32>,
    stop_reason: Option<String>,
) -> Result<(), StableError> {
    let state_emit = TaskStateEmit {
        session_id: snapshot.session_id.clone(),
        project_id: snapshot.project_id.clone(),
        command: snapshot.command.clone(),
        root_pid: snapshot.root_pid,
        tree_pids: snapshot.tree_pids.iter().copied().collect(),
        state: state.to_string(),
        stream_output: snapshot.stream_output,
        started_at_ms: snapshot.started_at_ms,
        last_event_at_ms: db::now_ms(),
        exit_code,
        stop_reason: stop_reason.clone(),
    };
    let exit_emit = TaskExitEmit {
        session_id: snapshot.session_id.clone(),
        project_id: snapshot.project_id.clone(),
        state: state.to_string(),
        exit_code,
        stop_reason,
        success: state == TASK_STATE_SUCCESS,
    };
    let _ = app.emit("task-state-changed", state_emit);
    let _ = app.emit("task-exited", exit_emit);
    Ok(())
}

pub fn task_state_emit(snapshot: &TaskMonitorEntry) -> TaskStateEmit {
    TaskStateEmit {
        session_id: snapshot.session_id.clone(),
        project_id: snapshot.project_id.clone(),
        command: snapshot.command.clone(),
        root_pid: snapshot.root_pid,
        tree_pids: snapshot.tree_pids.iter().copied().collect(),
        state: snapshot.state.clone(),
        stream_output: snapshot.stream_output,
        started_at_ms: snapshot.started_at_ms,
        last_event_at_ms: snapshot.last_event_at_ms,
        exit_code: snapshot.exit_code,
        stop_reason: snapshot.stop_reason.clone(),
    }
}

pub fn task_tree_emit(snapshot: &TaskMonitorEntry) -> TaskTreeEmit {
    TaskTreeEmit {
        session_id: snapshot.session_id.clone(),
        project_id: snapshot.project_id.clone(),
        root_pid: snapshot.root_pid,
        tree_pids: snapshot.tree_pids.iter().copied().collect(),
        last_event_at_ms: snapshot.last_event_at_ms,
    }
}
