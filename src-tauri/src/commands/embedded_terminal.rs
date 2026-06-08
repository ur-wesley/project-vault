use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::error::StableError;
use crate::models::ShellCandidateDto;
use crate::spawn::EmbeddedTerminals;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::TerminalBuffers;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::db;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::shells;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::embedded;

#[tauri::command]
pub async fn global_terminal_spawn(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<String, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, db, terms, cwd, shell);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let pool = db::sqlite_pool(&*db).await?;

        let resolved_cwd = if let Some(c) = cwd.filter(|s| !s.trim().is_empty()) {
            PathBuf::from(c)
        } else {
            let setting = db::get_setting(&pool, "global_terminal_cwd")
                .await?
                .filter(|s| !s.trim().is_empty());
            if let Some(s) = setting {
                PathBuf::from(s)
            } else {
                #[cfg(windows)]
                { PathBuf::from(std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())) }
                #[cfg(not(windows))]
                { PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".to_string())) }
            }
        };

        let shell_pref = if let Some(s) = shell {
            Some(s)
        } else {
            let custom = db::get_setting(&pool, "shell_path")
                .await?
                .filter(|s| !s.trim().is_empty());
            if custom.is_some() {
                custom
            } else {
                db::get_setting(&pool, "default_shell_path")
                    .await?
                    .filter(|s| !s.trim().is_empty())
            }
        };

        embedded::spawn_session(app, &terms, &buffers, resolved_cwd, shell_pref)
    }
}

#[tauri::command]
pub fn list_available_shells() -> Result<Vec<ShellCandidateDto>, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(Vec::new())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Ok(shells::discover_shells())
    }
}

#[tauri::command]
pub async fn embedded_terminal_spawn(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    project_id: String,
    shell: Option<String>,
) -> Result<String, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, db, terms, project_id, shell);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let pool = db::sqlite_pool(&*db).await?;
        let project = db::get_project(&pool, &project_id).await?;
        let cwd = PathBuf::from(&project.path);

        let shell_pref = if let Some(s) = shell {
            Some(s)
        } else {
            let custom = db::get_setting(&pool, "shell_path")
                .await?
                .filter(|s| !s.trim().is_empty());
            if custom.is_some() {
                custom
            } else {
                db::get_setting(&pool, "default_shell_path")
                    .await?
                    .filter(|s| !s.trim().is_empty())
            }
        };

        embedded::spawn_session(app, &terms, &buffers, cwd, shell_pref)
    }
}

#[tauri::command]
pub async fn embedded_terminal_write(
    terms: State<'_, EmbeddedTerminals>,
    session_id: String,
    data: String,
) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (terms, session_id, data);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        embedded::write_session(&terms, &session_id, &data)
    }
}

#[tauri::command]
pub async fn embedded_terminal_resize(
    terms: State<'_, EmbeddedTerminals>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (terms, session_id, rows, cols);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        embedded::resize_session(&terms, &session_id, rows, cols)
    }
}

#[tauri::command]
pub async fn embedded_terminal_kill(
    terms: State<'_, EmbeddedTerminals>,
    session_id: String,
) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (terms, session_id);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "embedded terminal not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        embedded::kill_session(&terms, &session_id)
    }
}

#[tauri::command]
pub fn embedded_terminal_is_alive(
    terms: State<'_, EmbeddedTerminals>,
    session_id: String,
) -> bool {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (terms, session_id);
        false
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        embedded::is_session_alive(&terms, &session_id)
    }
}

#[tauri::command]
pub fn embedded_terminal_get_buffer(
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    session_id: String,
) -> Vec<String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = session_id;
        Vec::new()
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        embedded::get_terminal_buffer(&buffers, &session_id)
    }
}

#[tauri::command]
pub fn embedded_terminal_clear_buffer(
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    buffers: State<'_, TerminalBuffers>,
    session_id: String,
) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        buffers.clear(&session_id);
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = session_id;
    }
}

