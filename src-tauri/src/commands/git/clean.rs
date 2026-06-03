use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::models::{CleanPreviewEntryDto, GitCleanPreviewDto};
use super::utils::{dir_size, run_git_async};

#[tauri::command]
pub async fn git_clean_preview(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<GitCleanPreviewDto, StableError> {
    eprintln!("[git_clean_preview] start, project_id={}", project_id);
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);
    eprintln!("[git_clean_preview] cwd={}", cwd.display());

    if !cwd.join(".git").exists() {
        eprintln!("[git_clean_preview] not a git repo");
        return Err(StableError::new(codes::INTERNAL, "not a git repository"));
    }

    // Use `git ls-files --ignored` instead of `git clean -fdX -n` — much faster on large repos
    eprintln!("[git_clean_preview] calling git ls-files...");
    let ignored_output = run_git_async(cwd, &["ls-files", "-o", "--ignored", "--exclude-standard", "--directory"]).await?;
    eprintln!("[git_clean_preview] ls-files done, output len={}", ignored_output.len());
    let mut entries = Vec::new();
    let mut total_bytes = 0u64;

    for line in ignored_output.lines() {
        let rel = line.trim();
        if rel.is_empty() {
            continue;
        }
        let full = cwd.join(rel);
        let is_dir = rel.ends_with('/');
        let clean_path = if is_dir { &rel[..rel.len() - 1] } else { rel };
        let size = if is_dir {
            dir_size(&full)
        } else {
            full.metadata().map(|m| m.len()).unwrap_or(0)
        };
        total_bytes += size;
        entries.push(CleanPreviewEntryDto {
            path: clean_path.to_string(),
            size_bytes: size,
            is_dir,
        });
    }
    eprintln!("[git_clean_preview] entries={}, total_bytes={}", entries.len(), total_bytes);

    eprintln!("[git_clean_preview] calling git status...");
    let status = run_git_async(cwd, &["status", "--porcelain"]).await?;
    eprintln!("[git_clean_preview] status done, len={}", status.len());
    let has_tracked_changes = status.lines().any(|line| {
        let b = line.as_bytes();
        b.len() >= 2
            && !(b[0] == b'?' && b[1] == b'?')
            && !(b[0] == b'!' && b[1] == b'!')
            && !(b[0] == b' ' && b[1] == b' ')
    });

    eprintln!("[git_clean_preview] done, has_tracked_changes={}", has_tracked_changes);
    Ok(GitCleanPreviewDto {
        entries,
        total_bytes,
        has_tracked_changes,
    })
}

#[tauri::command]
pub async fn git_clean_execute(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    reset_tracked: bool,
    selected_paths: Vec<String>,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
        return Err(StableError::new(codes::INTERNAL, "not a git repository"));
    }

    if !selected_paths.is_empty() {
        let mut args = vec!["clean", "-fdX", "--"];
        let path_args: Vec<&str> = selected_paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_args);
        run_git_async(cwd, &args).await?;
    }

    if reset_tracked {
        run_git_async(cwd, &["checkout", "--", "."]).await?;
    }

    let pool = db::sqlite_pool(&*db).await?;
    crate::commands::projects::update_project_size(&app, &pool, &project_id, &project.path).await;

    crate::models::emit_project_changed(&app, &project_id, "git-clean");
    Ok(())
}
