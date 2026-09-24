use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileDto {
    pub text: String,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    /// True when the file exceeded the editor's read cap and was clipped.
    pub truncated: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatDto {
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub is_dir: bool,
}


