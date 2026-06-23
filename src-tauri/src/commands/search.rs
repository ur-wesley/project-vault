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
        Err(e) => {
            // Schema mismatch → auto-rebuild and retry. This is the migration
            // path for users upgrading from a pre-v2 schema.
            let is_schema_mismatch = e.message.to_lowercase().contains("schema");
            if !is_schema_mismatch {
                return Err(e);
            }

            // Need the project path to rebuild.
            let pool = db::sqlite_pool(&*db).await?;
            let project = db::get_project(&pool, &project_id).await?;
            let project_path = PathBuf::from(&project.path);

            let _ = delete_project_index(&app_data_dir, &project_id);
            build_project_index(&app_data_dir, &project_id, project_path.as_path())?;
            let _ = app.emit("index:built", serde_json::json!({ "projectId": project_id }));

            search_project_index(&app_data_dir, &project_id, &query, 50)
        }
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

    let meta = build_project_index(&app_data_dir, &project_id, PathBuf::from(&project.path).as_path())?;
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
