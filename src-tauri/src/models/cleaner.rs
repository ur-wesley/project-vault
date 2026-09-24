use serde::{Deserialize, Serialize};

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


