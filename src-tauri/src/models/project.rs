use serde::{Deserialize, Serialize};

use super::tasks::TaskDto;
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
    pub last_viewed_at_ms: Option<i64>,
    pub total_playtime_ms: i64,
    pub tasks: Vec<TaskDto>,
    pub tags: Vec<String>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub file_count: u64,
    pub size_bytes: u64,
    pub last_edited_at_ms: Option<i64>,
    pub icon_path: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeCandidateDto {
    pub id: String,
    pub label: String,
    pub executable: String,
    /// Iconify class fallback (e.g. "devicon-plain--vscode").
    pub icon: Option<String>,
    /// Real OS icon as a data URL ("data:image/png;base64,...", or the svg
    /// variant on Linux). None when extraction failed; the frontend then
    /// falls back to `icon`.
    pub icon_data: Option<String>,
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
pub struct MoveProjectProgress {
    pub project_id: String,
    pub phase: String,
    pub files_total: u64,
    pub bytes_total: u64,
    pub files_done: u64,
    pub bytes_done: u64,
}


