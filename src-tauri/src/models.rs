use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

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
pub struct ConcurrentTask {
    pub label: String,
    pub argv: Vec<String>,
    pub cwd: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub concurrent: Option<Vec<ConcurrentTask>>,
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
    pub available: bool,
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
pub struct CleanPreviewEntryDto {
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCleanPreviewDto {
    pub entries: Vec<CleanPreviewEntryDto>,
    pub total_bytes: u64,
    pub has_tracked_changes: bool,
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
pub struct ProjectCleanerScanOptions {
    pub location_id: String,
    pub unused_days: u32,
    pub protect_recent_days: u32,
    pub protect_favorites: bool,
    pub min_playtime_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCleanerCategory {
    Protected,
    Active,
    Missing,
    GitClean,
    GitDirty,
    NoGit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCleanerActionKind {
    Skip,
    Clean,
    Delete,
    Unvault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerRow {
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub stack: String,
    pub category: ProjectCleanerCategory,
    pub size_bytes: u64,
    pub last_opened_at_ms: Option<i64>,
    pub reclaimable_bytes: u64,
    pub suggested_action: ProjectCleanerActionKind,
    pub git_branch: Option<String>,
    pub is_dirty: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerSummary {
    pub by_category: std::collections::HashMap<String, u32>,
    pub total_reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerScanResult {
    pub rows: Vec<ProjectCleanerRow>,
    pub summary: ProjectCleanerSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerAction {
    pub project_id: String,
    pub action: ProjectCleanerActionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerExecutePayload {
    pub actions: Vec<ProjectCleanerAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerFailure {
    pub project_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCleanerExecuteResult {
    pub succeeded: u32,
    pub failed: Vec<ProjectCleanerFailure>,
    pub bytes_reclaimed: u64,
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
    /// Tantivy BM25 score for this hit. Used to sort results on the frontend
    /// and to dim low-relevance hits.
    pub score: f32,
    pub highlights: Vec<SearchSnippetDto>,
    pub line_numbers: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippetDto {
    pub line_number: usize,
    /// Plain-text line, suitable for fallback rendering.
    pub text: String,
    /// Tantivy-generated snippet HTML with `<mark class="pv-mark">` wrappers
    /// around the matched terms. User content is escaped by Tantivy; only the
    /// wrapper tag is HTML.
    pub html: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChangedEmit {
    pub project_id: String,
    pub change_type: String,
}

pub fn emit_project_changed(app: &AppHandle, project_id: &str, change_type: &str) {
    let _ = app.emit(
        "project:changed",
        ProjectChangedEmit {
            project_id: project_id.to_string(),
            change_type: change_type.to_string(),
        },
    );
}

pub fn notify_git_status_changed(app: &AppHandle, project_id: &str, change_type: &str) {
    let payload = ProjectChangedEmit {
        project_id: project_id.to_string(),
        change_type: change_type.to_string(),
    };
    let _ = app.emit("project:changed", &payload);
    let _ = app.emit("git:status-changed", payload);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfoDto {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfoDto {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}
