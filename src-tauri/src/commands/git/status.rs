use std::path::Path;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use super::utils::run_git;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub is_dirty: bool,
    pub has_upstream: bool,
    pub version: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitIncomingCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub relative_time: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitIncomingDto {
    pub commits: Vec<GitIncomingCommit>,
}

#[tauri::command]
pub async fn get_git_status(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<GitStatusDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !super::utils::is_git_repo(cwd) {
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

    // 4. Version (latest tag or from version files)
    let version = run_git(cwd, &["describe", "--tags", "--abbrev=0"]).ok();

    Ok(Some(GitStatusDto {
        branch,
        ahead,
        behind,
        is_dirty,
        has_upstream,
        version,
    }))
}

#[tauri::command]
pub async fn git_pull(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["pull"])?;
    crate::models::notify_git_status_changed(&app, &project_id, "git");
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["push"])?;
    crate::models::notify_git_status_changed(&app, &project_id, "git");
    Ok(())
}

#[tauri::command]
pub async fn git_fetch(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["fetch"])?;
    crate::models::notify_git_status_changed(&app, &project_id, "git");
    Ok(())
}

#[tauri::command]
pub async fn git_incoming(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<GitIncomingDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    let log = run_git(
        cwd,
        &["log", "HEAD..@{u}", "--format=%H|%an|%ae|%s|%ar"],
    )
    .unwrap_or_default();

    let commits = log
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(5, '|');
            let hash = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let author_email = parts.next()?.to_string();
            let message = parts.next()?.to_string();
            let relative_time = parts.next()?.to_string();
            Some(GitIncomingCommit {
                hash,
                message,
                author,
                author_email,
                relative_time,
            })
        })
        .collect();

    Ok(GitIncomingDto { commits })
}

#[tauri::command]
pub async fn git_init(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["init"])?;
    run_git(cwd, &["checkout", "-b", "main"])?;
    crate::models::notify_git_status_changed(&app, &project_id, "git");
    Ok(())
}

#[tauri::command]
pub async fn start_git_watcher(
    git_watcher: State<'_, crate::git_watcher::GitWatcher>,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    git_watcher.start(&project_id, &project.path).await
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))
}

#[tauri::command]
pub async fn stop_git_watcher(
    git_watcher: State<'_, crate::git_watcher::GitWatcher>,
    project_id: String,
) -> Result<(), StableError> {
    git_watcher.stop(&project_id).await;
    Ok(())
}
