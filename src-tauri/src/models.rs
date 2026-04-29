use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationDto {
    pub id: String,
    pub path: String,
    pub name: String,
    pub sort_index: i32,
    pub enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub label: String,
    pub argv: Vec<String>,
    pub kind: String,
    pub cwd: Option<String>,
    pub description: Option<String>,
    pub depends: Vec<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub location_id: String,
    pub name: String,
    pub path: String,
    pub stack: String,
    pub runtime_hint: Option<String>,
    pub favorite: bool,
    pub last_opened_at_ms: Option<i64>,
    pub total_playtime_ms: i64,
    pub tasks: Vec<TaskDto>,
    pub tags: Vec<String>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub file_count: u64,
    pub size_bytes: u64,
    pub last_edited_at_ms: Option<i64>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeCandidateDto {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCandidateDto {
    pub id: String,
    pub label: String,
    pub executable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCandidateDto {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProjectResultDto {
    pub project: ProjectDto,
    pub cleanup_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathDiskSpaceDto {
    pub path: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProjectProgress {
    pub project_id: String,
    pub phase: String,
    pub files_total: u64,
    pub bytes_total: u64,
    pub files_done: u64,
    pub bytes_done: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiseToolDto {
    pub name: String,
    pub version: String,
    pub source: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiseToolSuggestionDto {
    pub name: String,
    pub version: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultDto {
    pub projects_discovered: u64,
    pub projects_upserted: u64,
    pub projects_pruned: u64,
    pub dirs_skipped_errors: u64,
    pub monorepos_expanded: u64,
    pub workspace_warnings: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetaDto {
    pub indexed_files: u64,
    pub index_size_bytes: u64,
    pub last_updated_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    pub path: String,
    pub highlights: Vec<SearchSnippetDto>,
    pub line_numbers: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippetDto {
    pub line_number: usize,
    pub text: String,
}
