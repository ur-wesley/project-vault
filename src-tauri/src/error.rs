use serde::Serialize;
use thiserror::Error;

// ---------------------------------------------------------------------------
// 1. Stable frontend contract (unchanged public API)
// ---------------------------------------------------------------------------

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

impl std::fmt::Display for StableError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for StableError {}

pub type Result<T> = std::result::Result<T, StableError>;

// ---------------------------------------------------------------------------
// 2. String constants (kept for explicit code stability)
// ---------------------------------------------------------------------------

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
    pub const EMPTY_SELECTION: &str = "EMPTY_SELECTION";
    pub const SCHEMA_INCOMPATIBLE: &str = "SCHEMA_INCOMPATIBLE";
}

// ---------------------------------------------------------------------------
// 3. Typed internal error enum
// ---------------------------------------------------------------------------

#[derive(Error, Debug, Clone)]
pub enum AppError {
    #[error("internal error: {0}")]
    Internal(String),

    #[error("resource not found: {0}")]
    NotFound(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("database error: {0}")]
    Db(String),

    #[error("spawn failed: {0}")]
    SpawnFailed(String),

    #[error("confirmation required")]
    ConfirmRequired,

    #[error("resource already exists: {0}")]
    AlreadyExists(String),

    #[error("move failed: {0}")]
    MoveFailed(String),

    #[error("GitHub device flow is not configured")]
    GithubDeviceNotConfigured,

    #[error("GitHub device request failed: {0}")]
    GithubDeviceRequest(String),

    #[error("GitHub device flow timed out")]
    GithubDeviceTimeout,

    #[error("GitHub device flow was denied")]
    GithubDeviceDenied,
}

// ---------------------------------------------------------------------------
// 4. Conversion bridge (ensures StableError compatibility)
// ---------------------------------------------------------------------------

impl From<AppError> for StableError {
    fn from(e: AppError) -> Self {
        let code = match &e {
            AppError::Internal(_) => codes::INTERNAL,
            AppError::NotFound(_) => codes::NOT_FOUND,
            AppError::InvalidPath(_) => codes::INVALID_PATH,
            AppError::Db(_) => codes::DB_ERROR,
            AppError::SpawnFailed(_) => codes::SPAWN_FAILED,
            AppError::ConfirmRequired => codes::CONFIRM_REQUIRED,
            AppError::AlreadyExists(_) => codes::ALREADY_EXISTS,
            AppError::MoveFailed(_) => codes::MOVE_FAILED,
            AppError::GithubDeviceNotConfigured => codes::GITHUB_DEVICE_NOT_CONFIGURED,
            AppError::GithubDeviceRequest(_) => codes::GITHUB_DEVICE_REQUEST,
            AppError::GithubDeviceTimeout => codes::GITHUB_DEVICE_TIMEOUT,
            AppError::GithubDeviceDenied => codes::GITHUB_DEVICE_DENIED,
        };
        StableError::new(code, e.to_string())
    }
}
