use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::files::{self, FileStat};
use crate::models::{FileStatDto, TextFileDto};

async fn resolve_project_root(
    db: &State<'_, DbInstances>,
    project_id: &str,
) -> Result<PathBuf, StableError> {
    let pool = db::sqlite_pool(&**db).await?;
    let project = db::get_project(&pool, project_id).await?;
    Ok(PathBuf::from(&project.path))
}

fn to_dto(stat: FileStat) -> FileStatDto {
    FileStatDto {
        size_bytes: stat.size_bytes,
        mtime_ms: stat.mtime_ms,
        is_dir: stat.is_dir,
    }
}

/// Re-index a single file after it changed on disk. Best-effort: a stale index
/// is self-healing via the scheduled rebuild, so failures must not fail the
/// user's save.
fn reindex_file(app: &AppHandle, project_id: &str, root: &Path, path: &Path) {
    let Ok(data_dir) = crate::common::app_data_dir(app) else {
        return;
    };
    let _ = crate::search::indexer::update_file_in_index(&data_dir, project_id, root, path);
}

/// Drop a file (and, for directories, every indexed descendant) from the index.
fn deindex_path(app: &AppHandle, project_id: &str, root: &Path, path: &Path) {
    let Ok(data_dir) = crate::common::app_data_dir(app) else {
        return;
    };
    let rel = files::relative_slash_path(root, path);
    let _ = crate::search::indexer::remove_file_from_index(&data_dir, project_id, &rel);
}

#[tauri::command]
pub async fn read_text_file(
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<TextFileDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let file = files::read_text(&root, Path::new(&path))?;
    Ok(TextFileDto {
        text: file.text,
        size_bytes: file.size_bytes,
        mtime_ms: file.mtime_ms,
        truncated: file.truncated,
    })
}

#[tauri::command]
pub async fn write_text_file(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
    content: String,
) -> Result<FileStatDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let target = PathBuf::from(&path);
    let stat = files::write_text(&root, &target, &content)?;
    reindex_file(&app, &project_id, &root, &target);
    Ok(to_dto(stat))
}

#[tauri::command]
pub async fn file_stat(
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<FileStatDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let stat = files::stat_path(&root, Path::new(&path))?;
    Ok(to_dto(stat))
}

#[tauri::command]
pub async fn create_project_file(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<FileStatDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let target = PathBuf::from(&path);
    let stat = files::create_file(&root, &target)?;
    reindex_file(&app, &project_id, &root, &target);
    Ok(to_dto(stat))
}

#[tauri::command]
pub async fn create_project_folder(
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<FileStatDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let stat = files::create_dir(&root, Path::new(&path))?;
    Ok(to_dto(stat))
}

#[tauri::command]
pub async fn rename_project_path(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    from: String,
    to: String,
) -> Result<FileStatDto, StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let from_path = PathBuf::from(&from);
    let to_path = PathBuf::from(&to);
    let stat = files::rename_path(&root, &from_path, &to_path)?;
    deindex_path(&app, &project_id, &root, &from_path);
    reindex_file(&app, &project_id, &root, &to_path);
    Ok(to_dto(stat))
}

#[tauri::command]
pub async fn delete_project_path(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    path: String,
) -> Result<(), StableError> {
    let root = resolve_project_root(&db, &project_id).await?;
    let target = PathBuf::from(&path);
    files::delete_path(&root, &target)?;
    deindex_path(&app, &project_id, &root, &target);
    Ok(())
}
