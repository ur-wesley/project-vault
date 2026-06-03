use std::collections::BTreeSet;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use super::types::{
    TaskMonitorEntry, TaskMonitors, TaskRegisterInput, TaskStartedEmit,
    TASK_STATE_CANCELLED, TASK_STATE_STARTING,
};
use super::db_events::{
    emit_final_events, emit_live_events, persist_final_state, persist_snapshot,
    task_state_emit, task_tree_emit,
};
use super::process::kill_task_tree;
use super::watch::watch_task;

pub fn register_task(
    app: &AppHandle,
    monitors: &TaskMonitors,
    input: TaskRegisterInput,
) -> Result<(), StableError> {
    let mut tree_pids = BTreeSet::new();
    if let Some(pid) = input.root_pid {
        tree_pids.insert(pid);
    }

    let entry = TaskMonitorEntry {
        session_id: input.session_id.clone(),
        project_id: input.project_id.clone(),
        command: input.command.clone(),
        root_pid: input.root_pid,
        tree_pids,
        state: TASK_STATE_STARTING.to_string(),
        stream_output: input.stream_output,
        stop_requested: false,
        finished: false,
        started_at_ms: input.started_at_ms,
        last_event_at_ms: input.started_at_ms,
        exit_code: None,
        stop_reason: None,
        ports: Vec::new(),
    };

    {
        let mut guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        guard.insert(input.session_id.clone(), entry.clone());
    }

    let started_emit = TaskStartedEmit {
        session_id: entry.session_id.clone(),
        project_id: entry.project_id.clone(),
        command: entry.command.clone(),
        root_pid: entry.root_pid,
        state: entry.state.clone(),
        stream_output: entry.stream_output,
        started_at_ms: entry.started_at_ms,
        last_event_at_ms: entry.last_event_at_ms,
    };
    let state_emit = task_state_emit(&entry);
    let tree_emit = task_tree_emit(&entry);

    let _ = app.emit("session:started", started_emit);
    let _ = app.emit("task-state-changed", state_emit);
    let _ = app.emit("task-tree-changed", tree_emit);

    let app_h = app.clone();
    let monitors_h = monitors.clone();
    let session_id_h = input.session_id.clone();
    tauri::async_runtime::spawn(async move {
        watch_task(app_h, monitors_h, session_id_h).await;
    });

    Ok(())
}

pub fn reregister_task(
    app: &AppHandle,
    monitors: &TaskMonitors,
    session_id: String,
    project_id: String,
    command: Option<String>,
    root_pid: Option<u32>,
    started_at_ms: i64,
) -> Result<(), StableError> {
    let mut tree_pids = BTreeSet::new();
    if let Some(pid) = root_pid {
        tree_pids.insert(pid);
    }

    let entry = TaskMonitorEntry {
        session_id: session_id.clone(),
        project_id: project_id.clone(),
        command: command.clone(),
        root_pid,
        tree_pids,
        state: TASK_STATE_STARTING.to_string(),
        stream_output: true,
        stop_requested: false,
        finished: false,
        started_at_ms,
        last_event_at_ms: db::now_ms(),
        exit_code: None,
        stop_reason: None,
        ports: Vec::new(),
    };

    {
        let mut guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        guard.insert(session_id.clone(), entry.clone());
    }

    let state_emit = task_state_emit(&entry);
    let tree_emit = task_tree_emit(&entry);
    let _ = app.emit("task-state-changed", state_emit);
    let _ = app.emit("task-tree-changed", tree_emit);

    let app_h = app.clone();
    let monitors_h = monitors.clone();
    let session_id_h = session_id.clone();
    tauri::async_runtime::spawn(async move {
        watch_task(app_h, monitors_h, session_id_h).await;
    });

    Ok(())
}

pub fn snapshot_task(monitors: &TaskMonitors, session_id: &str) -> Option<TaskMonitorEntry> {
    let guard = monitors.0.lock().ok()?;
    guard.get(session_id).cloned()
}

pub fn is_stop_requested(monitors: &TaskMonitors, session_id: &str) -> bool {
    snapshot_task(monitors, session_id)
        .map(|entry| entry.stop_requested)
        .unwrap_or(false)
}

pub async fn request_stop(
    app: AppHandle,
    monitors: &TaskMonitors,
    session_id: &str,
) -> Result<(), StableError> {
    let snapshot = match snapshot_task(monitors, session_id) {
        Some(s) => s,
        None => return Ok(()), // already finished and cleaned up
    };
    if snapshot.finished {
        return Ok(());
    }

    let now = db::now_ms();
    {
        let mut guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        if let Some(entry) = guard.get_mut(session_id) {
            entry.stop_requested = true;
            entry.state = TASK_STATE_CANCELLED.to_string();
            entry.last_event_at_ms = now;
            if entry.stop_reason.is_none() {
                entry.stop_reason = Some("stop requested".to_string());
            }
        }
    }

    persist_snapshot(&app, monitors, session_id).await?;
    emit_live_events(&app, monitors, session_id)?;
    kill_task_tree(monitors, session_id).await;
    Ok(())
}

pub async fn finalize_task(
    app: AppHandle,
    monitors: TaskMonitors,
    session_id: String,
    state: String,
    exit_code: Option<i32>,
    stop_reason: Option<String>,
) -> Result<(), StableError> {
    let snapshot = snapshot_task(&monitors, &session_id)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "task session not found"))?;

    {
        let mut guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        if let Some(entry) = guard.get_mut(&session_id) {
            entry.finished = true;
            entry.state = state.clone();
            entry.exit_code = exit_code;
            entry.stop_reason = stop_reason.clone();
            entry.last_event_at_ms = db::now_ms();
        }
    }

    persist_final_state(&app, &snapshot, &state, exit_code, stop_reason.clone()).await?;
    emit_final_events(&app, &snapshot, &state, exit_code, stop_reason.clone())?;

    {
        let mut guard = monitors
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        guard.remove(&session_id);
    }

    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;
    let ended = db::end_session(&pool, &session_id).await?;
    let _ = app.emit(
        "session:ended",
        super::types::SessionEndedEmit {
            session_id: ended.id,
            project_id: ended.project_id,
        },
    );

    Ok(())
}
