use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::{LocationDto, ProjectDto};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingEntryDto {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSnapshotDto {
    pub exported_at_ms: i64,
    pub locations: Vec<LocationDto>,
    pub projects: Vec<ProjectDto>,
}

#[tauri::command]
pub async fn get_setting(
    db: State<'_, DbInstances>,
    key: String,
) -> Result<Option<String>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::get_setting(&pool, &key).await
}

#[tauri::command]
pub async fn set_setting(
    db: State<'_, DbInstances>,
    key: String,
    value: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::set_setting(&pool, &key, &value).await
}

#[tauri::command]
pub async fn list_settings(
    db: State<'_, DbInstances>,
) -> Result<Vec<SettingEntryDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let rows = db::list_settings(&pool).await?;
    Ok(rows
        .into_iter()
        .map(|(key, value)| SettingEntryDto { key, value })
        .collect())
}

#[tauri::command]
pub async fn get_app_data_dir(app: AppHandle) -> Result<String, StableError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("failed to resolve app data dir: {e}")))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn export_library_snapshot(
    db: State<'_, DbInstances>,
) -> Result<ExportSnapshotDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let locations = db::list_locations(&pool).await?;
    let projects = db::list_projects(&pool).await?;
    Ok(ExportSnapshotDto {
        exported_at_ms: db::now_ms(),
        locations,
        projects,
    })
}
