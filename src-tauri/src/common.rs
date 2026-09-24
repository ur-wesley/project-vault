//! Cross-cutting backend helpers: single home for patterns duplicated
//! across command modules. Commands stay thin (validate, delegate, emit)
//! and call these instead of re-implementing them.

use std::path::PathBuf;

use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};

use crate::db;
use crate::error::{codes, StableError};

/// Resolve the app data dir with the stable `app data dir: {e}` mapping.
/// (Consolidates the `app.path().app_data_dir().map_err(...)` blocks
/// previously copy-pasted across search/files/clipboard/scan commands.)
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, StableError> {
    app.path()
        .app_data_dir()
        .map_err(|e| StableError::new(codes::INTERNAL, format!("app data dir: {e}")))
}

/// Resolve the preferred shell: explicit override first, then the
/// `shell_path` setting, then `default_shell_path` (blank values ignored).
/// (Consolidates the triple-nested setting lookup in task_runner +
/// embedded_terminal commands.)
pub async fn resolve_shell_pref(
    pool: &Pool<Sqlite>,
    shell_override: Option<String>,
) -> Result<Option<String>, StableError> {
    if let Some(s) = shell_override {
        return Ok(Some(s));
    }
    let custom = db::get_setting(pool, "shell_path")
        .await?
        .filter(|s| !s.trim().is_empty());
    if custom.is_some() {
        return Ok(custom);
    }
    Ok(db::get_setting(pool, "default_shell_path")
        .await?
        .filter(|s| !s.trim().is_empty()))
}

/// Single-quote a string for POSIX `sh` (used by console/terminal spawners).
/// (Consolidates the identical copies in spawn/runner + spawn/embedded.)
#[cfg(not(windows))]
pub fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}
