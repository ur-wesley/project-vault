use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployServerEntry {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    // Accepts both `apiKey` (camelCase) and `api_key` (snake_case).
    #[serde(default, alias = "api_key")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployMatchDto {
    /// "application" | "compose"
    pub kind: String,
    pub id: String,
    pub name: String,
    pub project_name: String,
    pub status: Option<String>,
    pub domains: Vec<String>,
    pub repository: Option<String>,
    pub owner: Option<String>,
    pub branch: Option<String>,
    pub environment: Option<String>,
    pub server_id: String,
    pub server_name: String,
    /// "exact" | "owner_repo" | "name_only"
    pub match_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployDebugServiceDto {
    pub kind: String,
    pub name: String,
    pub source_type: Option<String>,
    pub owner: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub environment: Option<String>,
    pub project_name: String,
    pub server_id: String,
    pub server_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployDebugScanDto {
    pub project_count: usize,
    pub service_count: usize,
    pub local_host: Option<String>,
    pub local_owner: Option<String>,
    pub local_repo: Option<String>,
    pub services: Vec<DokployDebugServiceDto>,
    pub unreachable_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployDeploymentDto {
    pub id: String,
    pub title: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployServiceStatusDto {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub project_name: String,
    pub status: Option<String>,
    pub domains: Vec<String>,
    pub repository: Option<String>,
    pub owner: Option<String>,
    pub branch: Option<String>,
    pub environment: Option<String>,
    pub server_id: String,
    pub server_name: String,
    pub dashboard_url: String,
    pub deployments: Vec<DokployDeploymentDto>,
}

/// Normalized git identity: (host, owner, repo), all lowercase, no `.git`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitTriple {
    pub host: String,
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployGitProviderDto {
    /// The `github.githubId` — what saveGithubProvider expects.
    pub id: String,
    pub name: String,
    pub provider_type: Option<String>,
    pub git_provider_id: Option<String>,
    pub configured: bool,
    pub server_id: String,
    pub server_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DokployServiceCandidateDto {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub project_name: String,
    pub source_type: Option<String>,
    pub linked: bool,
    pub repository: Option<String>,
    pub owner: Option<String>,
    pub branch: Option<String>,
    pub environment: Option<String>,
    pub server_id: String,
    pub server_name: String,
}
