use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;
use tokio::sync::Semaphore;

use crate::commands::git::status::GitStatusDto;
use crate::commands::projects::DeleteProjectPayload;
use crate::db;
use crate::error::{codes, StableError};
use crate::models::{
    ProjectCleanerActionKind, ProjectCleanerCategory, ProjectCleanerExecutePayload,
    ProjectCleanerExecuteResult, ProjectCleanerFailure, ProjectCleanerRow,
    ProjectCleanerScanOptions, ProjectCleanerScanResult, ProjectCleanerSummary, ProjectDto,
};
use crate::spawn::TaskMonitors;

const MS_PER_DAY: i64 = 86_400_000;
const DEP_DIR_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".venv",
    "venv",
    "vendor",
    "Pods",
    "__pycache__",
    ".turbo",
    ".nuxt",
    ".cache",
    "coverage",
    "obj",
];

pub fn is_root_dep_dir(name: &str) -> bool {
    DEP_DIR_NAMES
        .iter()
        .any(|d| name.eq_ignore_ascii_case(d))
}

pub fn estimate_dep_dir_bytes(project_path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(project_path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if is_root_dep_dir(name) {
            total += crate::commands::git::utils::dir_size(&entry.path());
        }
    }
    total
}

pub fn clean_project_deps(project_path: &Path) -> Result<u64, StableError> {
    if !project_path.is_dir() {
        return Err(StableError::new(
            codes::INTERNAL,
            "project directory not found",
        ));
    }
    let mut reclaimed = 0u64;
    let entries: Vec<_> = std::fs::read_dir(project_path)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?
        .filter_map(|e| e.ok())
        .collect();
    for entry in entries {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_root_dep_dir(name) {
            continue;
        }
        let path = entry.path();
        reclaimed += crate::commands::git::utils::dir_size(&path);
        std::fs::remove_dir_all(&path).map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("failed to remove {}: {e}", path.display()),
            )
        })?;
    }
    Ok(reclaimed)
}

pub fn is_recently_opened(last_opened_at_ms: Option<i64>, protect_recent_days: u32, now_ms: i64) -> bool {
    match last_opened_at_ms {
        Some(ts) => now_ms.saturating_sub(ts) < (protect_recent_days as i64) * MS_PER_DAY,
        None => false,
    }
}

pub fn is_unused(project: &ProjectDto, opts: &ProjectCleanerScanOptions, now_ms: i64) -> bool {
    if opts.protect_favorites && project.favorite {
        return false;
    }
    let threshold = (opts.unused_days as i64) * MS_PER_DAY;
    let opened_old = project
        .last_opened_at_ms
        .map_or(true, |t| now_ms.saturating_sub(t) >= threshold);
    let edited_old = project
        .last_edited_at_ms
        .map_or(true, |t| now_ms.saturating_sub(t) >= threshold);
    let low_playtime = project.total_playtime_ms < opts.min_playtime_ms;
    opened_old && edited_old && low_playtime
}

pub fn classify_project(
    project: &ProjectDto,
    opts: &ProjectCleanerScanOptions,
    now_ms: i64,
    path_exists: bool,
    has_active_session: bool,
    git_status: Option<&GitStatusDto>,
) -> (ProjectCleanerCategory, ProjectCleanerActionKind) {
    if project.favorite
        || is_recently_opened(project.last_opened_at_ms, opts.protect_recent_days, now_ms)
        || !is_unused(project, opts, now_ms)
    {
        return (
            ProjectCleanerCategory::Protected,
            ProjectCleanerActionKind::Skip,
        );
    }
    if has_active_session {
        return (ProjectCleanerCategory::Active, ProjectCleanerActionKind::Skip);
    }
    if !path_exists {
        return (
            ProjectCleanerCategory::Missing,
            ProjectCleanerActionKind::Unvault,
        );
    }
    match git_status {
        Some(status) if status.is_dirty => (
            ProjectCleanerCategory::GitDirty,
            ProjectCleanerActionKind::Skip,
        ),
        Some(_) => (
            ProjectCleanerCategory::GitClean,
            ProjectCleanerActionKind::Clean,
        ),
        None => (ProjectCleanerCategory::NoGit, ProjectCleanerActionKind::Clean),
    }
}

fn category_key(category: &ProjectCleanerCategory) -> String {
    serde_json::to_value(category)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

async fn git_status_for_path(path: &Path) -> Option<GitStatusDto> {
    if !crate::commands::git::utils::is_git_repo(path) {
        return None;
    }
    let branch = crate::commands::git::utils::run_git(path, &["branch", "--show-current"]).ok()?;
    if branch.is_empty() {
        return None;
    }
    let status = crate::commands::git::utils::run_git(path, &["status", "--porcelain"]).ok()?;
    let is_dirty = !status.is_empty();
    let version = crate::commands::git::utils::run_git(path, &["describe", "--tags", "--abbrev=0"]).ok();
    Some(GitStatusDto {
        branch,
        ahead: 0,
        behind: 0,
        is_dirty,
        has_upstream: false,
        version,
    })
}

async fn git_clean_reclaimable(path: &Path) -> u64 {
    if !crate::commands::git::utils::is_git_repo(path) {
        return 0;
    }
    let Ok(ignored_output) = crate::commands::git::utils::run_git_async(
        path,
        &[
            "ls-files",
            "-o",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    )
    .await
    else {
        return 0;
    };
    let mut total = 0u64;
    for line in ignored_output.lines() {
        let rel = line.trim();
        if rel.is_empty() {
            continue;
        }
        let is_dir = rel.ends_with('/');
        let clean_path = if is_dir {
            &rel[..rel.len() - 1]
        } else {
            rel
        };
        let full = path.join(clean_path);
        total += if is_dir {
            crate::commands::git::utils::dir_size(&full)
        } else {
            full.metadata().map(|m| m.len()).unwrap_or(0)
        };
    }
    total
}

async fn scan_single_project(
    project: ProjectDto,
    opts: &ProjectCleanerScanOptions,
    now_ms: i64,
    active_ids: &HashSet<String>,
) -> Result<ProjectCleanerRow, StableError> {
    let path = Path::new(&project.path);
    let path_exists = path.exists();
    let has_active_session = active_ids.contains(&project.id);

    let git_status = if path_exists {
        git_status_for_path(path).await
    } else {
        None
    };

    let (category, suggested_action) = classify_project(
        &project,
        opts,
        now_ms,
        path_exists,
        has_active_session,
        git_status.as_ref(),
    );

    let reclaimable_bytes = if !path_exists {
        0
    } else if git_status.is_some() {
        git_clean_reclaimable(path).await
    } else {
        estimate_dep_dir_bytes(path)
    };

    Ok(ProjectCleanerRow {
        project_id: project.id,
        name: project.name,
        path: project.path,
        stack: project.stack,
        category,
        size_bytes: project.size_bytes,
        last_opened_at_ms: project.last_opened_at_ms,
        reclaimable_bytes,
        suggested_action,
        git_branch: git_status.as_ref().map(|s| s.branch.clone()),
        is_dirty: git_status.map(|s| s.is_dirty),
    })
}

#[tauri::command]
pub async fn project_cleaner_scan(
    _app: AppHandle,
    db: State<'_, DbInstances>,
    options: ProjectCleanerScanOptions,
) -> Result<ProjectCleanerScanResult, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let all = db::list_projects(&pool).await?;
    let projects: Vec<ProjectDto> = all
        .into_iter()
        .filter(|p| p.location_id == options.location_id)
        .collect();

    let active_sessions = db::list_active_sessions_for_project_all(&pool).await?;
    let active_ids: HashSet<String> = active_sessions
        .into_iter()
        .map(|s| s.project_id)
        .collect();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let semaphore = Arc::new(Semaphore::new(4));
    let mut handles = Vec::with_capacity(projects.len());
    for project in projects {
        let permit = semaphore.clone().acquire_owned().await.map_err(|e| {
            StableError::new(codes::INTERNAL, e.to_string())
        })?;
        let opts = options.clone();
        let active_ids = active_ids.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            scan_single_project(project, &opts, now_ms, &active_ids).await
        }));
    }

    let mut rows = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(row)) => rows.push(row),
            Ok(Err(e)) => return Err(e),
            Err(e) => {
                return Err(StableError::new(
                    codes::INTERNAL,
                    format!("scan task failed: {e}"),
                ));
            }
        }
    }

    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut by_category: HashMap<String, u32> = HashMap::new();
    let mut total_reclaimable_bytes = 0u64;
    for row in &rows {
        *by_category
            .entry(category_key(&row.category))
            .or_insert(0) += 1;
        if row.suggested_action == ProjectCleanerActionKind::Clean {
            total_reclaimable_bytes += row.reclaimable_bytes;
        }
    }

    Ok(ProjectCleanerScanResult {
        rows,
        summary: ProjectCleanerSummary {
            by_category,
            total_reclaimable_bytes,
        },
    })
}

async fn execute_clean(
    app: &AppHandle,
    db: &State<'_, DbInstances>,
    project_id: &str,
    project_path: &Path,
) -> Result<u64, StableError> {
    let sessions = {
        let pool = db::sqlite_pool(&*db).await?;
        db::list_active_sessions_for_project(&pool, project_id).await?
    };
    if !sessions.is_empty() {
        return Err(StableError::new(
            codes::INTERNAL,
            "project has active sessions",
        ));
    }

    if crate::commands::git::utils::is_git_repo(project_path) {
        let preview =
            crate::commands::git::clean::git_clean_preview(db.clone(), project_id.to_string())
                .await?;
        let paths: Vec<String> = preview.entries.into_iter().map(|e| e.path).collect();
        if paths.is_empty() {
            return Ok(0);
        }
        let bytes = preview.total_bytes;
        crate::commands::git::clean::git_clean_execute(
            app.clone(),
            db.clone(),
            project_id.to_string(),
            false,
            paths,
        )
        .await?;
        Ok(bytes)
    } else {
        clean_project_deps(project_path)
    }
}

async fn execute_delete(
    app: &AppHandle,
    db: &State<'_, DbInstances>,
    monitors: &State<'_, TaskMonitors>,
    project_id: &str,
    delete_from_disk: bool,
) -> Result<(), StableError> {
    crate::commands::projects::delete_project(
        app.clone(),
        db.clone(),
        monitors.clone(),
        DeleteProjectPayload {
            id: project_id.to_string(),
            delete_from_disk,
        },
    )
    .await
}

#[tauri::command]
pub async fn project_cleaner_execute(
    app: AppHandle,
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    payload: ProjectCleanerExecutePayload,
) -> Result<ProjectCleanerExecuteResult, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let mut succeeded = 0u32;
    let mut failed = Vec::new();
    let mut bytes_reclaimed = 0u64;

    for action in payload.actions {
        if action.action == ProjectCleanerActionKind::Skip {
            continue;
        }

        let project = match db::get_project(&pool, &action.project_id).await {
            Ok(p) => p,
            Err(e) => {
                failed.push(ProjectCleanerFailure {
                    project_id: action.project_id,
                    error: e.message,
                });
                continue;
            }
        };

        let result = match action.action {
            ProjectCleanerActionKind::Skip => Ok(0u64),
            ProjectCleanerActionKind::Clean => {
                execute_clean(
                    &app,
                    &db,
                    &action.project_id,
                    Path::new(&project.path),
                )
                .await
            }
            ProjectCleanerActionKind::Delete => {
                execute_delete(&app, &db, &monitors, &action.project_id, true)
                    .await
                    .map(|_| 0)
            }
            ProjectCleanerActionKind::Unvault => {
                execute_delete(&app, &db, &monitors, &action.project_id, false)
                    .await
                    .map(|_| 0)
            }
        };

        match result {
            Ok(bytes) => {
                succeeded += 1;
                bytes_reclaimed += bytes;
                if action.action == ProjectCleanerActionKind::Clean {
                    crate::commands::projects::update_project_size(
                        &app,
                        &pool,
                        &action.project_id,
                        &project.path,
                    )
                    .await;
                }
            }
            Err(e) => {
                failed.push(ProjectCleanerFailure {
                    project_id: action.project_id,
                    error: e.message,
                });
            }
        }
    }

    Ok(ProjectCleanerExecuteResult {
        succeeded,
        failed,
        bytes_reclaimed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::git::status::GitStatusDto;

    fn sample_project() -> ProjectDto {
        ProjectDto {
            id: "p1".to_string(),
            location_id: "loc1".to_string(),
            name: "test".to_string(),
            path: "/tmp/test".to_string(),
            stack: "node".to_string(),
            runtime_hint: None,
            favorite: false,
            last_opened_at_ms: Some(0),
            last_viewed_at_ms: None,
            total_playtime_ms: 0,
            tasks: vec![],
            tags: vec![],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: Some(0),
            icon_path: None,
        }
    }

    fn default_opts() -> ProjectCleanerScanOptions {
        ProjectCleanerScanOptions {
            location_id: "loc1".to_string(),
            unused_days: 90,
            protect_recent_days: 30,
            protect_favorites: true,
            min_playtime_ms: 300_000,
        }
    }

    #[test]
    fn favorite_is_protected() {
        let mut p = sample_project();
        p.favorite = true;
        let now = 100_000_000_000_i64;
        let (cat, action) = classify_project(&p, &default_opts(), now, true, false, None);
        assert_eq!(cat, ProjectCleanerCategory::Protected);
        assert_eq!(action, ProjectCleanerActionKind::Skip);
    }

    #[test]
    fn unused_git_clean_suggests_clean() {
        let p = sample_project();
        let now = 200_000_000_000_i64;
        let git = GitStatusDto {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            is_dirty: false,
            has_upstream: false,
            version: None,
        };
        let (cat, action) = classify_project(&p, &default_opts(), now, true, false, Some(&git));
        assert_eq!(cat, ProjectCleanerCategory::GitClean);
        assert_eq!(action, ProjectCleanerActionKind::Clean);
    }

    #[test]
    fn unused_git_dirty_suggests_skip() {
        let p = sample_project();
        let now = 200_000_000_000_i64;
        let git = GitStatusDto {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            is_dirty: true,
            has_upstream: false,
            version: None,
        };
        let (cat, action) = classify_project(&p, &default_opts(), now, true, false, Some(&git));
        assert_eq!(cat, ProjectCleanerCategory::GitDirty);
        assert_eq!(action, ProjectCleanerActionKind::Skip);
    }

    #[test]
    fn missing_path_suggests_unvault() {
        let p = sample_project();
        let now = 200_000_000_000_i64;
        let (cat, action) = classify_project(&p, &default_opts(), now, false, false, None);
        assert_eq!(cat, ProjectCleanerCategory::Missing);
        assert_eq!(action, ProjectCleanerActionKind::Unvault);
    }

    #[test]
    fn is_root_dep_dir_matches_known_names() {
        assert!(is_root_dep_dir("node_modules"));
        assert!(is_root_dep_dir("TARGET"));
        assert!(!is_root_dep_dir("src"));
    }
}
