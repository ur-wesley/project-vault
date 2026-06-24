use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::{IndexMetaDto, SearchHitDto};
use crate::search::indexer::{
    build_project_index, delete_project_index, index_exists, index_meta, update_file_in_index,
};
use crate::search::query::search_project_index;

/// On a `SCHEMA_INCOMPATIBLE` error from the search-side `open_index`, wipe
/// the index directory and rebuild it from disk. Returns the project path
/// pulled from the DB so the caller can also re-run its primary operation.
async fn rebuild_on_schema_mismatch(
    app: &AppHandle,
    db: &State<'_, DbInstances>,
    app_data_dir: &std::path::Path,
    project_id: &str,
) -> Result<PathBuf, StableError> {
    let pool = db::sqlite_pool(&**db).await?;
    let project = db::get_project(&pool, project_id).await?;
    let project_path = PathBuf::from(&project.path);

    let _ = delete_project_index(app_data_dir, project_id);
    build_project_index(app_data_dir, project_id, project_path.as_path())?;
    let _ = app.emit("index:built", serde_json::json!({ "projectId": project_id }));
    Ok(project_path)
}

#[tauri::command]
pub async fn search_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    query: String,
) -> Result<Vec<SearchHitDto>, StableError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;

    match search_project_index(&app_data_dir, &project_id, &query, 50) {
        Ok(hits) => Ok(hits),
        Err(e) if e.code == crate::error::codes::SCHEMA_INCOMPATIBLE => {
            // Auto-rebuild on schema mismatch. This is the migration path for
            // users upgrading from a pre-v2 schema.
            rebuild_on_schema_mismatch(&app, &db, &app_data_dir, &project_id).await?;
            search_project_index(&app_data_dir, &project_id, &query, 50)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn index_project(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<IndexMetaDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;
    let project_path = PathBuf::from(&project.path);

    let meta = match build_project_index(&app_data_dir, &project_id, project_path.as_path()) {
        Ok(meta) => meta,
        Err(e) if e.code == crate::error::codes::SCHEMA_INCOMPATIBLE => {
            // Auto-rebuild on schema mismatch, same as search_project.
            rebuild_on_schema_mismatch(&app, &db, &app_data_dir, &project_id).await?;
            build_project_index(&app_data_dir, &project_id, project_path.as_path())?
        }
        Err(e) => return Err(e),
    };

    let _ = app.emit("index:built", serde_json::json!({ "projectId": project_id }));
    Ok(IndexMetaDto {
        indexed_files: meta.indexed_files,
        index_size_bytes: meta.index_size_bytes,
        last_updated_ms: meta.last_updated_ms,
    })
}

#[tauri::command]
pub async fn rebuild_index(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<IndexMetaDto, StableError> {
    // rebuild is the same as build (build clears existing docs first)
    index_project(app, db, project_id).await
}

#[tauri::command]
pub async fn get_index_meta(
    app: AppHandle,
    project_id: String,
) -> Result<Option<IndexMetaDto>, StableError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;

    if !index_exists(&app_data_dir, &project_id) {
        return Ok(None);
    }

    let meta = index_meta(&app_data_dir, &project_id)?;
    Ok(Some(IndexMetaDto {
        indexed_files: meta.indexed_files,
        index_size_bytes: meta.index_size_bytes,
        last_updated_ms: meta.last_updated_ms,
    }))
}

#[tauri::command]
pub async fn delete_index(
    app: AppHandle,
    project_id: String,
) -> Result<(), StableError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;

    delete_project_index(&app_data_dir, &project_id)
}

#[tauri::command]
pub async fn delete_all_indices(app: AppHandle) -> Result<(), StableError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;

    let indices_dir = app_data_dir.join("indices");
    if indices_dir.exists() {
        std::fs::remove_dir_all(&indices_dir).map_err(|e| {
            StableError::new(crate::error::codes::INTERNAL, format!("failed to remove indices: {e}"))
        })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_index_for_file(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    file_path: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("app data dir: {e}")))?;

    update_file_in_index(
        &app_data_dir,
        &project_id,
        PathBuf::from(&project.path).as_path(),
        PathBuf::from(&file_path).as_path(),
    )
}
