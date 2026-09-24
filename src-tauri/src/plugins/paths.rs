use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::lua::loader::repo_slug;

pub(crate) fn plugins_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("plugins")
}

pub(crate) fn repos_dir(plugins_dir: &Path) -> PathBuf {
    plugins_dir.join("repos")
}

pub(crate) fn repo_checkout_path(plugins_dir: &Path, repo: &str) -> PathBuf {
    repos_dir(plugins_dir).join(repo_slug(repo))
}

pub(crate) async fn get_disabled_plugins(db: &DbInstances) -> Result<HashSet<String>, StableError> {
    let pool = db::sqlite_pool(db).await?;
    let raw = db::get_setting(&pool, "disabled_plugins").await?;
    let set = match raw {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => HashSet::new(),
    };
    Ok(set)
}

pub(crate) async fn save_disabled_plugins(db: &DbInstances, set: &HashSet<String>) -> Result<(), StableError> {
    let pool = db::sqlite_pool(db).await?;
    let json = serde_json::to_string(set).unwrap_or_else(|_| "[]".to_string());
    db::set_setting(&pool, "disabled_plugins", &json).await
}

pub(crate) fn git_command() -> tokio::process::Command {
    crate::process_util::hidden_tokio_command("git")
}

pub(crate) async fn run_git(mut cmd: tokio::process::Command) -> Result<std::process::Output, StableError> {
    cmd.output().await.map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to spawn git: {}", e),
        )
    })
}

pub(crate) async fn repo_is_behind_upstream(path: &Path) -> bool {
    let mut fetch = git_command();
    fetch.current_dir(path).arg("fetch");
    let _ = run_git(fetch).await;

    let mut rev_head = git_command();
    rev_head.current_dir(path).arg("rev-parse").arg("HEAD");

    let mut rev_upstream = git_command();
    rev_upstream.current_dir(path).arg("rev-parse").arg("@{u}");

    if let (Ok(h_out), Ok(u_out)) = (run_git(rev_head).await, run_git(rev_upstream).await) {
        if h_out.status.success() && u_out.status.success() {
            let h_sha = String::from_utf8_lossy(&h_out.stdout).trim().to_string();
            let u_sha = String::from_utf8_lossy(&u_out.stdout).trim().to_string();
            return h_sha != u_sha;
        }
    }
    false
}
