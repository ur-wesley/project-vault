use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::models::TaskDto;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDraft {
    pub root: PathBuf,
    pub name: String,
    pub stack: String,
    pub runtime_hint: Option<String>,
    pub tasks: Vec<TaskDto>,
    pub tags: Vec<String>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub file_count: u64,
    pub size_bytes: u64,
    pub last_edited_at_ms: Option<i64>,
}
