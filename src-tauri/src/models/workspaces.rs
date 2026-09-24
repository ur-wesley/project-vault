use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub project_id: String,
    pub card_board: Option<String>,
    pub card_id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub worktree_path: String,
    pub branch: String,
    pub status: String,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// One coding-agent run inside a workspace (PTY-backed, like task sessions).

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDto {
    pub id: String,
    pub workspace_id: String,
    pub executor: String,
    pub pty_session_id: String,
    pub status: String,
    pub last_prompt: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}


