use std::path::Path;
use std::process::Command;
use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub is_dirty: bool,
    pub has_upstream: bool,
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, StableError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to execute git: {e}")))?;

    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(StableError::new(codes::INTERNAL, format!("git error: {msg}")));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_git_status(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<GitStatusDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
        return Ok(None);
    }

    // 1. Current branch
    let branch = run_git(cwd, &["branch", "--show-current"]).unwrap_or_else(|_| "HEAD".to_string());
    if branch.is_empty() {
        return Ok(None);
    }

    // 2. Ahead/Behind
    let mut ahead = 0;
    let mut behind = 0;
    let mut has_upstream = false;

    if let Ok(revs) = run_git(cwd, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
        has_upstream = true;
        let parts: Vec<&str> = revs.split_whitespace().collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    // 3. Dirty state
    let status = run_git(cwd, &["status", "--porcelain"])?;
    let is_dirty = !status.is_empty();

    Ok(Some(GitStatusDto {
        branch,
        ahead,
        behind,
        is_dirty,
        has_upstream,
    }))
}

#[tauri::command]
pub async fn git_pull(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["pull"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["push"])?;
    Ok(())
}
