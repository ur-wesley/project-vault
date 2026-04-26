use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StableError {
    pub code: String,
    pub message: String,
}

impl StableError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

pub mod codes {
    pub const INTERNAL: &str = "INTERNAL";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const INVALID_PATH: &str = "INVALID_PATH";
    pub const DB_ERROR: &str = "DB_ERROR";
    pub const SPAWN_FAILED: &str = "SPAWN_FAILED";
    pub const CONFIRM_REQUIRED: &str = "CONFIRM_REQUIRED";
    pub const ALREADY_EXISTS: &str = "ALREADY_EXISTS";
    pub const MOVE_FAILED: &str = "MOVE_FAILED";
    pub const GITHUB_DEVICE_NOT_CONFIGURED: &str = "GITHUB_DEVICE_NOT_CONFIGURED";
    pub const GITHUB_DEVICE_REQUEST: &str = "GITHUB_DEVICE_REQUEST";
    pub const GITHUB_DEVICE_TIMEOUT: &str = "GITHUB_DEVICE_TIMEOUT";
    pub const GITHUB_DEVICE_DENIED: &str = "GITHUB_DEVICE_DENIED";
}
