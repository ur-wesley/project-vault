use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::lua::loader::{PluginCommandMetadata, PluginInfo, PluginManager};
use crate::lua::ui::UiBridge;

pub fn plugins_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("plugins")
}

async fn get_disabled_plugins(db: &DbInstances) -> Result<HashSet<String>, StableError> {
    let pool = db::sqlite_pool(db).await?;
    let raw = db::get_setting(&pool, "disabled_plugins").await?;
    let set = match raw {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => HashSet::new(),
    };
    Ok(set)
}

async fn save_disabled_plugins(db: &DbInstances, set: &HashSet<String>) -> Result<(), StableError> {
    let pool = db::sqlite_pool(db).await?;
    let json = serde_json::to_string(set).unwrap_or_else(|_| "[]".to_string());
    db::set_setting(&pool, "disabled_plugins", &json).await
}

#[tauri::command]
pub async fn list_plugin_commands(
    app: AppHandle,
    db: State<'_, DbInstances>,
) -> Result<Vec<PluginCommandMetadata>, StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    let disabled = get_disabled_plugins(&*db).await?;
    Ok(manager.list_plugin_commands(&disabled))
}

#[tauri::command]
pub async fn execute_plugin_command(
    app: AppHandle,
    bridge: State<'_, UiBridge>,
    plugin_id: String,
    command_id: String,
    context: serde_json::Value,
) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    manager.execute_plugin_command(app, (*bridge).clone(), &plugin_id, &command_id, context)
}

#[tauri::command]
pub async fn list_plugins(
    app: AppHandle,
    db: State<'_, DbInstances>,
) -> Result<Vec<PluginInfo>, StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    let disabled = get_disabled_plugins(&*db).await?;
    Ok(manager.list_plugins(&disabled))
}

#[tauri::command]
pub async fn toggle_plugin(
    app: AppHandle,
    db: State<'_, DbInstances>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), StableError> {
    let mut disabled = get_disabled_plugins(&*db).await?;
    if enabled {
        disabled.remove(&plugin_id);
    } else {
        disabled.insert(plugin_id);
    }
    save_disabled_plugins(&*db, &disabled).await
}
