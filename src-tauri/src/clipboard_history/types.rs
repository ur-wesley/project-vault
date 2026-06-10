use serde::{Deserialize, Serialize};

pub const MAX_TEXT_BYTES: usize = 64 * 1024;
pub const DEFAULT_MAX_ENTRIES: u32 = 200;
pub const DEFAULT_MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
pub const DEFAULT_DEDUP_SECONDS: u64 = 2;

pub const SETTING_ENABLED: &str = "clipboard_history_enabled";
pub const SETTING_MAX_ENTRIES: &str = "clipboard_history_max_entries";
pub const SETTING_MAX_IMAGE_BYTES: &str = "clipboard_history_max_image_bytes";
pub const SETTING_DEDUP_SECONDS: &str = "clipboard_history_dedup_seconds";
pub const SETTING_SHOW_SOURCE: &str = "clipboard_history_show_source";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardEntryKind {
    Text,
    Html,
    Image,
    Files,
}

impl ClipboardEntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Html => "html",
            Self::Image => "image",
            Self::Files => "files",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "text" => Some(Self::Text),
            "html" => Some(Self::Html),
            "image" => Some(Self::Image),
            "files" => Some(Self::Files),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntryMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
}

impl Default for ClipboardEntryMeta {
    fn default() -> Self {
        Self {
            file_paths: Vec::new(),
            width: None,
            height: None,
            byte_size: None,
            mime: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntryDto {
    pub id: String,
    pub kind: String,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_text: Option<String>,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_path: Option<String>,
    pub meta: ClipboardEntryMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_app: Option<String>,
    pub pinned: bool,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistorySettingsDto {
    pub enabled: bool,
    pub max_entries: u32,
    pub max_image_bytes: u64,
    pub dedup_seconds: u64,
    pub show_source: bool,
}

impl Default for ClipboardHistorySettingsDto {
    fn default() -> Self {
        Self {
            enabled: true,
            max_entries: DEFAULT_MAX_ENTRIES,
            max_image_bytes: DEFAULT_MAX_IMAGE_BYTES,
            dedup_seconds: DEFAULT_DEDUP_SECONDS,
            show_source: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListClipboardHistoryArgs {
    pub query: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClipboardEntryArgs {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearClipboardHistoryArgs {
    pub keep_pinned: Option<bool>,
}

pub fn truncate_preview(s: &str, max_chars: usize) -> String {
    let trimmed: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

pub fn preview_for_files(paths: &[String]) -> String {
    if paths.is_empty() {
        return "(empty files)".to_string();
    }
    if paths.len() == 1 {
        let name = std::path::Path::new(&paths[0])
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&paths[0]);
        return name.to_string();
    }
    let first = std::path::Path::new(&paths[0])
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&paths[0]);
    format!("{} + {} more", first, paths.len() - 1)
}
