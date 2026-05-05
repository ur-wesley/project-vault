use std::path::Path;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::fs_scope_util;
use crate::location_watcher::LocationWatcher;
use crate::models::LocationDto;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLocationPayload {
    pub path: String,
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLocationPayload {
    pub id: String,
    pub path: Option<String>,
    pub name: Option<String>,
    pub sort_index: Option<i32>,
    pub enabled: Option<bool>,
    pub is_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationOrderEntry {
    pub id: String,
    pub sort_index: i32,
}

#[tauri::command]
pub async fn list_locations(db: State<'_, DbInstances>) -> Result<Vec<LocationDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_locations(&pool).await
}

#[tauri::command]
pub async fn add_location(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: AddLocationPayload,
) -> Result<LocationDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let name = payload.name.unwrap_or_else(|| {
        Path::new(&payload.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Library")
            .to_string()
    });
    let loc = db::add_location(&pool, payload.path, name).await?;
    let _ = fs_scope_util::allow_library_root(&app, &loc.path);
    if let Some(watcher) = app.try_state::<LocationWatcher>() {
        let _ = watcher.watch(loc.id.clone(), loc.path.clone()).await;
    }
    Ok(loc)
}

#[tauri::command]
pub async fn remove_location(
    app: AppHandle,
    db: State<'_, DbInstances>,
    id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    if let Some(watcher) = app.try_state::<LocationWatcher>() {
        watcher.unwatch(&id).await;
    }
    db::remove_location(&pool, &id).await
}

#[tauri::command]
pub async fn update_location(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: UpdateLocationPayload,
) -> Result<LocationDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let before = db::get_location(&pool, &payload.id).await?;
    let loc = db::update_location(
        &pool,
        &payload.id,
        payload.path,
        payload.name,
        payload.sort_index,
        payload.enabled,
        payload.is_default,
    )
    .await?;
    if before.path != loc.path {
        let _ = fs_scope_util::allow_library_root(&app, &loc.path);
    }
    if let Some(watcher) = app.try_state::<LocationWatcher>() {
        let path_changed = before.path != loc.path;
        let enabled_changed = before.enabled != loc.enabled;
        if path_changed || enabled_changed {
            watcher.unwatch(&loc.id).await;
            if loc.enabled {
                let _ = watcher.watch(loc.id.clone(), loc.path.clone()).await;
            }
        }
    }
    Ok(loc)
}

#[tauri::command]
pub async fn reorder_locations(
    db: State<'_, DbInstances>,
    order: Vec<LocationOrderEntry>,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let tuples: Vec<(String, i32)> = order.into_iter().map(|e| (e.id, e.sort_index)).collect();
    db::reorder_locations(&pool, &tuples).await
}

#[tauri::command]
pub async fn pick_library_folder(app: AppHandle) -> Result<Option<String>, StableError> {
    let folder = app
        .dialog()
        .file()
        .set_title("Choose library folder")
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_project_parent_folder(app: AppHandle) -> Result<Option<String>, StableError> {
    let folder = app
        .dialog()
        .file()
        .set_title("Choose folder for new project")
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}
