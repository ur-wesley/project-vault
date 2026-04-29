#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

pub const TASK_STATE_STARTING: &str = "starting";
pub const TASK_STATE_RUNNING: &str = "running";
pub const TASK_STATE_SUCCESS: &str = "success";
pub const TASK_STATE_ERROR: &str = "error";
pub const TASK_STATE_CANCELLED: &str = "cancelled";

#[derive(Clone, Default)]
pub struct TaskMonitors(pub Arc<Mutex<HashMap<String, TaskMonitorEntry>>>);

#[derive(Clone, Debug)]
pub struct TaskMonitorEntry {
    pub session_id: String,
    pub project_id: String,
    pub command: Option<String>,
    pub root_pid: Option<u32>,
    pub tree_pids: BTreeSet<u32>,
    pub state: String,
    pub stream_output: bool,
    pub stop_requested: bool,
    pub finished: bool,
    pub started_at_ms: i64,
    pub last_event_at_ms: i64,
    pub exit_code: Option<i32>,
    pub stop_reason: Option<String>,
    pub ports: Vec<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStartedEmit {
    session_id: String,
    project_id: String,
    command: Option<String>,
    root_pid: Option<u32>,
    state: String,
    stream_output: bool,
    started_at_ms: i64,
    last_event_at_ms: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStateEmit {
    session_id: String,
    project_id: String,
    command: Option<String>,
    root_pid: Option<u32>,
    tree_pids: Vec<u32>,
    state: String,
    stream_output: bool,
    started_at_ms: i64,
    last_event_at_ms: i64,
    exit_code: Option<i32>,
    stop_reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskTreeEmit {
    session_id: String,
    project_id: String,
    root_pid: Option<u32>,
    tree_pids: Vec<u32>,
    last_event_at_ms: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskExitEmit {
    session_id: String,
    project_id: String,
    state: String,
    exit_code: Option<i32>,
    stop_reason: Option<String>,
    success: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEmit {
    session_id: String,
    project_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskPortsEmit {
    session_id: String,
    project_id: String,
    ports: Vec<u16>,
    last_event_at_ms: i64,
}

#[derive(Clone)]
pub struct TaskRegisterInput {
    pub session_id: String,
    pub project_id: String,
    pub command: Option<String>,
    pub root_pid: Option<u32>,
    pub stream_output: bool,
    pub started_at_ms: i64,
}

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
        SessionEndedEmit {
            session_id: ended.id,
            project_id: ended.project_id,
        },
    );

    Ok(())
}

fn discover_ports_for_pids(pids: &[u32]) -> Vec<u16> {
    let mut ports = Vec::new();
    eprintln!("[discover_ports_for_pids] scanning pids: {:?}", pids);
    if pids.is_empty() {
        eprintln!("[discover_ports_for_pids] no pids, returning empty");
        return ports;
    }

    #[cfg(windows)]
    {
        let pids_set: std::collections::HashSet<u32> = pids.iter().copied().collect();
        let mut cmd = std::process::Command::new("netstat");
        cmd.args(["-ano"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = cmd.output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                eprintln!("[discover_ports_for_pids] netstat output {} lines", text.lines().count());
                for line in text.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() < 4 {
                        continue;
                    }
                    let proto = parts[0];
                    if proto != "TCP" && proto != "UDP" {
                        continue;
                    }
                    let Some(pid_str) = parts.last() else { continue };
                    let Ok(pid) = pid_str.parse::<u32>() else { continue };
                    if !pids_set.contains(&pid) {
                        continue;
                    }
                    // Locale-independent listening detection:
                    // A bound socket has a wildcard foreign address.
                    let is_listening = if proto == "TCP" && parts.len() >= 5 {
                        let foreign = parts[2];
                        foreign == "*:*" || foreign == "0.0.0.0:0" || foreign == "[::]:0"
                    } else if proto == "UDP" && parts.len() >= 4 {
                        let foreign = parts[2];
                        foreign == "*:*"
                    } else {
                        false
                    };
                    eprintln!("[discover_ports_for_pids] matched pid={pid} proto={proto} parts={parts:?} is_listening={is_listening}");
                    if !is_listening {
                        continue;
                    }
                    // Parse port from local address "0.0.0.0:3000" or "[::]:3000"
                    if let Some(addr_part) = parts.get(1) {
                        if let Some(port_str) = addr_part.rsplit(':').next() {
                            if let Ok(port) = port_str.parse::<u16>() {
                                if !ports.contains(&port) {
                                    eprintln!("[discover_ports_for_pids] found port {port}");
                                    ports.push(port);
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[discover_ports_for_pids] netstat failed: {e}");
            }
        }
    }

    #[cfg(not(windows))]
    {
        let pid_list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let output = std::process::Command::new("lsof")
            .args(["-P", "-n", "-iTCP", "-sTCP:LISTEN", "-p", &pid_list])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 9 {
                    // Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
                    // NAME is like "*:3000" or "0.0.0.0:3000" or "[::]:3000"
                    if let Some(name) = parts.get(8) {
                        if let Some(port_str) = name.rsplit(':').next() {
                            if let Ok(port) = port_str.parse::<u16>() {
                                if !ports.contains(&port) {
                                    ports.push(port);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    ports.sort_unstable();
    ports
}

async fn watch_task(app: AppHandle, monitors: TaskMonitors, session_id: String) {
    let mut sys = System::new_all();
    let mut interval = tokio::time::interval(Duration::from_millis(350));
    let mut last_tree: BTreeSet<u32> = BTreeSet::new();
    let mut last_ports: Vec<u16> = Vec::new();
    let mut tick_count = 0u32;

    loop {
        interval.tick().await;

        let snapshot = match snapshot_task(&monitors, &session_id) {
            Some(entry) => entry,
            None => break,
        };

        if snapshot.finished {
            break;
        }

        let Some(root_pid) = snapshot.root_pid else {
            if last_tree.is_empty() {
                let _ = persist_snapshot(&app, &monitors, &session_id).await;
            }
            continue;
        };

        sys.refresh_processes(ProcessesToUpdate::All, true);
        let tree = discover_task_tree(&sys, &snapshot.tree_pids, root_pid);
        let alive = tree.iter().any(|pid| sys.process(Pid::from(*pid as usize)).is_some());
        let mut next_state = snapshot.state.clone();
        if next_state == TASK_STATE_STARTING && alive {
            next_state = TASK_STATE_RUNNING.to_string();
        }

        let tree_changed = tree != snapshot.tree_pids;
        let state_changed = next_state != snapshot.state;

        // Port detection: scan every ~2 seconds (6 ticks) or when state becomes running
        tick_count += 1;
        let should_scan_ports = (tick_count % 6 == 0) || (state_changed && next_state == TASK_STATE_RUNNING);
        eprintln!("[watch_task {session_id}] tick={tick_count} alive={alive} should_scan={should_scan_ports} tree={:?}", tree);
        if should_scan_ports && alive {
            let pids: Vec<u32> = tree.iter().copied().collect();
            let detected = discover_ports_for_pids(&pids);
            eprintln!("[watch_task {session_id}] detected ports: {:?} last_ports: {:?}", detected, last_ports);
            if detected != last_ports {
                last_ports = detected.clone();
                {
                    let mut guard = match monitors.0.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    if let Some(entry) = guard.get_mut(&session_id) {
                        entry.ports = detected.clone();
                        entry.last_event_at_ms = db::now_ms();
                    }
                }
                eprintln!("[watch_task {session_id}] EMITTING task-ports-changed ports={:?} project_id={}", detected, snapshot.project_id);
                let _ = persist_snapshot(&app, &monitors, &session_id).await;
                let _ = app.emit(
                    "task-ports-changed",
                    TaskPortsEmit {
                        session_id: session_id.clone(),
                        project_id: snapshot.project_id.clone(),
                        ports: detected,
                        last_event_at_ms: db::now_ms(),
                    },
                );
            }
        } else {
            eprintln!("[watch_task {session_id}] SKIPPING scan should_scan={should_scan_ports} alive={alive}");
        }

        if tree_changed || state_changed {
            {
                let mut guard = match monitors.0.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if let Some(entry) = guard.get_mut(&session_id) {
                    if tree_changed {
                        entry.tree_pids = tree.clone();
                    }
                    if state_changed {
                        entry.state = next_state.clone();
                    }
                    entry.last_event_at_ms = db::now_ms();
                }
            }

            if tree_changed || state_changed {
                let _ = persist_snapshot(&app, &monitors, &session_id).await;
            }

            if state_changed {
                if let Some(updated) = snapshot_task(&monitors, &session_id) {
                    let _ = app.emit("task-state-changed", task_state_emit(&updated));
                }
            }

            if tree_changed {
                if let Some(updated) = snapshot_task(&monitors, &session_id) {
                    let _ = app.emit("task-tree-changed", task_tree_emit(&updated));
                    last_tree = updated.tree_pids.clone();
                }
            }
        } else if last_tree.is_empty() {
            let _ = persist_snapshot(&app, &monitors, &session_id).await;
            last_tree = snapshot.tree_pids.clone();
        }
    }
}

async fn persist_snapshot(
    app: &AppHandle,
    monitors: &TaskMonitors,
    session_id: &str,
) -> Result<(), StableError> {
    let snapshot = snapshot_task(monitors, session_id)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "task session not found"))?;
    persist_from_snapshot(app, &snapshot).await
}

async fn persist_final_state(
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

async fn persist_from_snapshot(
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

fn emit_live_events(app: &AppHandle, monitors: &TaskMonitors, session_id: &str) -> Result<(), StableError> {
    if let Some(snapshot) = snapshot_task(monitors, session_id) {
        let _ = app.emit("task-state-changed", task_state_emit(&snapshot));
        let _ = app.emit("task-tree-changed", task_tree_emit(&snapshot));
    }
    Ok(())
}

fn emit_final_events(
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

fn task_state_emit(snapshot: &TaskMonitorEntry) -> TaskStateEmit {
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

fn task_tree_emit(snapshot: &TaskMonitorEntry) -> TaskTreeEmit {
    TaskTreeEmit {
        session_id: snapshot.session_id.clone(),
        project_id: snapshot.project_id.clone(),
        root_pid: snapshot.root_pid,
        tree_pids: snapshot.tree_pids.iter().copied().collect(),
        last_event_at_ms: snapshot.last_event_at_ms,
    }
}

fn discover_task_tree(
    sys: &System,
    existing_tree: &BTreeSet<u32>,
    root_pid: u32,
) -> BTreeSet<u32> {
    let mut seeds = existing_tree.clone();
    if seeds.is_empty() {
        seeds.insert(root_pid);
    }

    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children_by_parent
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    let mut tree = seeds.clone();
    let mut queue: VecDeque<u32> = seeds.into_iter().collect();
    while let Some(pid) = queue.pop_front() {
        if let Some(children) = children_by_parent.get(&pid) {
            for child_pid in children {
                if tree.insert(*child_pid) {
                    queue.push_back(*child_pid);
                }
            }
        }
    }

    tree
}

async fn kill_task_tree(monitors: &TaskMonitors, session_id: &str) {
    let snapshot = match snapshot_task(monitors, session_id) {
        Some(snapshot) => snapshot,
        None => return,
    };
    let mut pids = snapshot.tree_pids.iter().copied().collect::<Vec<_>>();
    if pids.is_empty() {
        if let Some(root) = snapshot.root_pid {
            pids.push(root);
        }
    }
    if pids.is_empty() {
        return;
    }

    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut sys = System::new_all();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let mut tree: Vec<(u32, usize)> = Vec::new();
        let seed_set: BTreeSet<u32> = pids.into_iter().collect();
        let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, process) in sys.processes() {
            if let Some(parent) = process.parent() {
                children_by_parent
                    .entry(parent.as_u32())
                    .or_default()
                    .push(pid.as_u32());
            }
        }
        let mut queue: VecDeque<(u32, usize)> = seed_set.into_iter().map(|pid| (pid, 0)).collect();
        let mut seen = BTreeSet::new();
        while let Some((pid, depth)) = queue.pop_front() {
            if !seen.insert(pid) {
                continue;
            }
            tree.push((pid, depth));
            if let Some(children) = children_by_parent.get(&pid) {
                for child in children {
                    queue.push_back((*child, depth + 1));
                }
            }
        }
        tree.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
        for (pid, _) in tree {
            let p = Pid::from(pid as usize);
            if let Some(process) = sys.process(p) {
                let _ = process.kill();
            }
        }
    })
    .await;
}
/*
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, Signal, System};
use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};

pub const TASK_STARTED_EVENT: &str = "task:started";
pub const TASK_STATE_CHANGED_EVENT: &str = "task:state-changed";
pub const TASK_TREE_CHANGED_EVENT: &str = "task:tree-changed";
pub const TASK_LOG_CHUNK_EVENT: &str = "task:log-chunk";
pub const TASK_EXITED_EVENT: &str = "task:exited";
pub const TASK_KILLED_EVENT: &str = "task:killed";
pub const TASK_RECOVERED_EVENT: &str = "task:recovered";
pub const TASK_ERROR_EVENT: &str = "task:error";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Idle,
    Starting,
    Running,
    Success,
    Error,
    Cancelled,
}

impl TaskState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Success | Self::Error | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStartedEmit {
    pub session_id: String,
    pub project_id: String,
    pub root_pid: Option<u32>,
    pub command_line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStateChangedEmit {
    pub session_id: String,
    pub project_id: String,
    pub state: TaskState,
    pub root_pid: Option<u32>,
    pub process_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTreeChangedEmit {
    pub session_id: String,
    pub project_id: String,
    pub root_pid: Option<u32>,
    pub process_ids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogChunkEmit {
    pub session_id: String,
    pub project_id: String,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExitedEmit {
    pub session_id: String,
    pub project_id: String,
    pub state: TaskState,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskKilledEmit {
    pub session_id: String,
    pub project_id: String,
    pub root_pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecoveredEmit {
    pub session_id: String,
    pub project_id: String,
    pub root_pid: Option<u32>,
    pub process_ids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskErrorEmit {
    pub session_id: String,
    pub project_id: String,
    pub message: String,
}

#[derive(Debug)]
pub struct TaskRunHandle {
    pub session_id: String,
    pub project_id: String,
    pub cwd: PathBuf,
    pub command_line: String,
    pub root_pid: Arc<Mutex<Option<u32>>>,
    pub last_tree: Arc<Mutex<Vec<u32>>>,
    pub state: Arc<Mutex<TaskState>>,
    pub stop_requested: Arc<AtomicBool>,
    pub finished: Arc<AtomicBool>,
}

impl TaskRunHandle {
    fn new(
        session_id: String,
        project_id: String,
        cwd: PathBuf,
        command_line: String,
        root_pid: Option<u32>,
    ) -> Self {
        Self {
            session_id,
            project_id,
            cwd,
            command_line,
            root_pid: Arc::new(Mutex::new(root_pid)),
            last_tree: Arc::new(Mutex::new(Vec::new())),
            state: Arc::new(Mutex::new(TaskState::Starting)),
            stop_requested: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn current_root_pid(&self) -> Option<u32> {
        self.root_pid.lock().ok().and_then(|pid| *pid)
    }

    pub fn last_tree_snapshot(&self) -> Vec<u32> {
        self.last_tree.lock().map(|tree| tree.clone()).unwrap_or_default()
    }

    fn set_root_pid(&self, root_pid: Option<u32>) {
        if let Ok(mut guard) = self.root_pid.lock() {
            *guard = root_pid;
        }
    }

    fn set_last_tree(&self, tree: Vec<u32>) {
        if let Ok(mut guard) = self.last_tree.lock() {
            *guard = tree;
        }
    }

    fn update_state(&self, state: TaskState) {
        if let Ok(mut guard) = self.state.lock() {
            *guard = state;
        }
    }

    fn current_state(&self) -> TaskState {
        self.state.lock().map(|state| *state).unwrap_or(TaskState::Idle)
    }
}

#[derive(Clone, Default)]
pub struct TaskRuns(pub Arc<Mutex<HashMap<String, Arc<TaskRunHandle>>>>);

impl TaskRuns {
    pub fn insert(&self, handle: Arc<TaskRunHandle>) -> Result<(), StableError> {
        let mut guard = self
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        guard.insert(handle.session_id.clone(), handle);
        Ok(())
    }

    pub fn get(&self, session_id: &str) -> Result<Option<Arc<TaskRunHandle>>, StableError> {
        let guard = self
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        Ok(guard.get(session_id).cloned())
    }

    pub fn remove(&self, session_id: &str) -> Result<Option<Arc<TaskRunHandle>>, StableError> {
        let mut guard = self
            .0
            .lock()
            .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        Ok(guard.remove(session_id))
    }
}

fn emit<E: Serialize>(app: &AppHandle, event: &str, payload: E) {
    let _ = app.emit(event, payload);
}

fn refresh_processes(sys: &mut System) {
    sys.refresh_processes(ProcessesToUpdate::All, true);
}

fn pid_from_u32(pid: u32) -> Pid {
    Pid::from(pid as usize)
}

fn process_tree(sys: &System, root: Pid) -> Vec<u32> {
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, proc_) in sys.processes() {
        if let Some(parent) = proc_.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }

    let mut stack = vec![root];
    let mut visited = HashSet::new();
    let mut out = Vec::new();

    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        out.push(pid.as_u32());
        if let Some(kids) = children.get(&pid) {
            for kid in kids {
                stack.push(*kid);
            }
        }
    }

    out.sort_unstable();
    out
}

fn descendant_from_last_tree(sys: &System, last_tree: &[u32]) -> Option<u32> {
    let ancestors: HashSet<Pid> = last_tree.iter().map(|pid| pid_from_u32(*pid)).collect();
    let mut candidates: Vec<(u32, u64)> = Vec::new();

    for (pid, proc_) in sys.processes() {
        if ancestors.contains(pid) {
            continue;
        }

        let mut parent = proc_.parent();
        while let Some(ppid) = parent {
            if ancestors.contains(&ppid) {
                candidates.push((pid.as_u32(), proc_.start_time()));
                break;
            }
            parent = sys.process(ppid).and_then(|p| p.parent());
        }
    }

    candidates
        .into_iter()
        .max_by_key(|(_, start_time)| *start_time)
        .map(|(pid, _)| pid)
}

fn emit_state(app: &AppHandle, handle: &TaskRunHandle, state: TaskState, process_count: usize) {
    emit(
        app,
        TASK_STATE_CHANGED_EVENT,
        TaskStateChangedEmit {
            session_id: handle.session_id.clone(),
            project_id: handle.project_id.clone(),
            state,
            root_pid: handle.current_root_pid(),
            process_count,
        },
    );
}

fn emit_tree(app: &AppHandle, handle: &TaskRunHandle, tree: Vec<u32>) {
    emit(
        app,
        TASK_TREE_CHANGED_EVENT,
        TaskTreeChangedEmit {
            session_id: handle.session_id.clone(),
            project_id: handle.project_id.clone(),
            root_pid: handle.current_root_pid(),
            process_ids: tree,
        },
    );
}

fn emit_recovered(app: &AppHandle, handle: &TaskRunHandle, tree: Vec<u32>) {
    emit(
        app,
        TASK_RECOVERED_EVENT,
        TaskRecoveredEmit {
            session_id: handle.session_id.clone(),
            project_id: handle.project_id.clone(),
            root_pid: handle.current_root_pid(),
            process_ids: tree,
        },
    );
}

pub fn emit_log_chunk(app: &AppHandle, session_id: &str, project_id: &str, chunk: String) {
    emit(
        app,
        TASK_LOG_CHUNK_EVENT,
        TaskLogChunkEmit {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            chunk,
        },
    );
}

pub fn register_task(
    app: AppHandle,
    runs: &TaskRuns,
    session_id: String,
    project_id: String,
    cwd: PathBuf,
    command_line: String,
    root_pid: Option<u32>,
) -> Result<Arc<TaskRunHandle>, StableError> {
    let handle = Arc::new(TaskRunHandle::new(
        session_id.clone(),
        project_id.clone(),
        cwd,
        command_line.clone(),
        root_pid,
    ));

    runs.insert(handle.clone())?;
    emit(
        &app,
        TASK_STARTED_EVENT,
        TaskStartedEmit {
            session_id: session_id.clone(),
            project_id: project_id.clone(),
            root_pid,
            command_line,
        },
    );
    emit_state(&app, &handle, TaskState::Starting, 0);

    let app_h = app.clone();
    let runs_h = runs.clone();
    let handle_h = handle.clone();

    thread::spawn(move || {
        let mut sys = System::new_all();
        let mut last_tree = Vec::new();
        let mut last_state = TaskState::Starting;
        let mut rebind_emitted = false;

        loop {
            if handle_h.finished.load(Ordering::SeqCst) {
                break;
            }

            refresh_processes(&mut sys);

            let current_root = handle_h.current_root_pid().map(pid_from_u32);
            let mut tree = Vec::new();

            if let Some(root) = current_root {
                if sys.process(root).is_some() {
                    tree = process_tree(&sys, root);
                } else {
                    let fallback_tree = handle_h.last_tree_snapshot();
                    if !fallback_tree.is_empty() {
                        if let Some(new_root) = descendant_from_last_tree(&sys, &fallback_tree) {
                            handle_h.set_root_pid(Some(new_root));
                            tree = process_tree(&sys, pid_from_u32(new_root));
                            if !rebind_emitted {
                                rebind_emitted = true;
                                emit_recovered(&app_h, &handle_h, tree.clone());
                            }
                        }
                    }
                }
            } else {
                let fallback_tree = handle_h.last_tree_snapshot();
                if !fallback_tree.is_empty() {
                    if let Some(new_root) = descendant_from_last_tree(&sys, &fallback_tree) {
                        handle_h.set_root_pid(Some(new_root));
                        tree = process_tree(&sys, pid_from_u32(new_root));
                        if !rebind_emitted {
                            rebind_emitted = true;
                            emit_recovered(&app_h, &handle_h, tree.clone());
                        }
                    }
                }
            }

            if !tree.is_empty() {
                handle_h.set_last_tree(tree.clone());
                if tree != last_tree {
                    emit_tree(&app_h, &handle_h, tree.clone());
                    last_tree = tree.clone();
                }

                if last_state == TaskState::Starting {
                    last_state = TaskState::Running;
                    handle_h.update_state(TaskState::Running);
                    emit_state(&app_h, &handle_h, TaskState::Running, tree.len());
                }
            }

            if handle_h.stop_requested.load(Ordering::SeqCst) && handle_h.current_state().is_terminal() {
                break;
            }

            thread::sleep(Duration::from_millis(250));
        }

        let _ = runs_h.remove(&handle_h.session_id);
    });

    Ok(handle)
}

pub fn finish_task(
    app: &AppHandle,
    runs: &TaskRuns,
    session_id: &str,
    state: TaskState,
    exit_code: Option<i32>,
) -> Result<(), StableError> {
    let Some(handle) = runs.get(session_id)? else {
        return Ok(());
    };

    if handle.finished.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    handle.update_state(state);
    emit_state(app, &handle, state, handle.last_tree_snapshot().len());
    emit(
        app,
        TASK_EXITED_EVENT,
        TaskExitedEmit {
            session_id: handle.session_id.clone(),
            project_id: handle.project_id.clone(),
            state,
            exit_code,
        },
    );

    let _ = runs.remove(session_id)?;
    Ok(())
}

fn send_signal_to_pid(sys: &System, pid: Pid, signal: Signal) -> bool {
    if let Some(proc_) = sys.process(pid) {
        return proc_.kill_with(signal).unwrap_or(false);
    }
    false
}

fn kill_tree_once(sys: &System, root_pid: u32, signal: Signal) -> bool {
    let root = pid_from_u32(root_pid);
    let mut pids = if sys.process(root).is_some() {
        process_tree(sys, root)
    } else {
        vec![root_pid]
    };
    pids.sort_unstable_by(|a, b| b.cmp(a));

    let mut any = false;
    for pid in pids {
        any |= send_signal_to_pid(sys, pid_from_u32(pid), signal);
    }
    any
}

pub fn kill_task_tree(
    app: &AppHandle,
    runs: &TaskRuns,
    session_id: &str,
) -> Result<(), StableError> {
    let Some(handle) = runs.get(session_id)? else {
        return Ok(());
    };

    handle.stop_requested.store(true, Ordering::SeqCst);

    let root_pid = handle.current_root_pid();
    let snapshot = handle.last_tree_snapshot();
    let mut sys = System::new_all();
    refresh_processes(&mut sys);

    if let Some(pid) = root_pid {
        let _ = kill_tree_once(&sys, pid, Signal::Interrupt);
        let _ = kill_tree_once(&sys, pid, Signal::Term);
    } else if !snapshot.is_empty() {
        for pid in snapshot.iter().copied().rev() {
            let _ = send_signal_to_pid(&sys, pid_from_u32(pid), Signal::Interrupt);
            let _ = send_signal_to_pid(&sys, pid_from_u32(pid), Signal::Term);
        }
    } else {
        return Err(StableError::new(
            codes::NOT_FOUND,
            "task process tree not found",
        ));
    }

    handle.finished.store(true, Ordering::SeqCst);
    handle.update_state(TaskState::Cancelled);
    emit(
        app,
        TASK_KILLED_EVENT,
        TaskKilledEmit {
            session_id: handle.session_id.clone(),
            project_id: handle.project_id.clone(),
            root_pid,
        },
    );
    emit_state(app, &handle, TaskState::Cancelled, snapshot.len());
    let _ = runs.remove(session_id)?;
    Ok(())
}

pub fn mark_task_error(
    app: &AppHandle,
    runs: &TaskRuns,
    session_id: &str,
    message: String,
) {
    if let Ok(Some(handle)) = runs.get(session_id) {
        emit(
            app,
            TASK_ERROR_EVENT,
            TaskErrorEmit {
                session_id: handle.session_id.clone(),
                project_id: handle.project_id.clone(),
                message,
            },
        );
        handle.finished.store(true, Ordering::SeqCst);
        handle.update_state(TaskState::Error);
        let _ = runs.remove(session_id);
    }
}
*/