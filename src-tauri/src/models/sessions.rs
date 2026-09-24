use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    pub project_id: String,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub command: Option<String>,
    pub state: String,
    pub root_pid: Option<u32>,
    pub tree_pids: Vec<u32>,
    pub exit_code: Option<i32>,
    pub stop_reason: Option<String>,
    pub last_event_at_ms: i64,
}
