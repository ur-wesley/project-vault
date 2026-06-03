use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use serde::Serialize;

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
pub struct TaskStartedEmit {
    pub session_id: String,
    pub project_id: String,
    pub command: Option<String>,
    pub root_pid: Option<u32>,
    pub state: String,
    pub stream_output: bool,
    pub started_at_ms: i64,
    pub last_event_at_ms: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStateEmit {
    pub session_id: String,
    pub project_id: String,
    pub command: Option<String>,
    pub root_pid: Option<u32>,
    pub tree_pids: Vec<u32>,
    pub state: String,
    pub stream_output: bool,
    pub started_at_ms: i64,
    pub last_event_at_ms: i64,
    pub exit_code: Option<i32>,
    pub stop_reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTreeEmit {
    pub session_id: String,
    pub project_id: String,
    pub root_pid: Option<u32>,
    pub tree_pids: Vec<u32>,
    pub last_event_at_ms: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExitEmit {
    pub session_id: String,
    pub project_id: String,
    pub state: String,
    pub exit_code: Option<i32>,
    pub stop_reason: Option<String>,
    pub success: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEndedEmit {
    pub session_id: String,
    pub project_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPortsEmit {
    pub session_id: String,
    pub project_id: String,
    pub ports: Vec<u16>,
    pub last_event_at_ms: i64,
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
