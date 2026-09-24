use serde::{Deserialize, Serialize};

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


