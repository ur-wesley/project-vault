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
pub struct PathDiskSpaceDto {
    pub path: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}


