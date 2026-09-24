use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonorepoEntryDto {
    pub id: String,
    pub dir: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonorepoDiscoveryDto {
    pub repo: String,
    pub slug: String,
    pub branch: Option<String>,
    pub tag: Option<String>,
    pub commit: Option<String>,
    pub kind: String, // "monorepo" | "single"
    pub entries: Vec<MonorepoEntryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPluginDto {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepoDto {
    pub repo: String,
    pub slug: String,
    pub entries: Vec<DiscoveredPluginDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFolderEntryDto {
    pub id: String,
    pub dir: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFolderDiscoveryDto {
    pub src_path: String,
    pub kind: String, // "single" | "monorepo"
    pub entries: Vec<LocalFolderEntryDto>,
}
