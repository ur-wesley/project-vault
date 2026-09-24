use std::collections::HashMap;

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use crate::lua::loader::{
    enrich_spec_from_repo_init, load_specs, write_specs_to_file, PluginCommandMetadata, PluginInfo,
    PluginManager, OFFICIAL_PLUGINS_REPO,
};
use crate::lua::plugin_install::resolve_plugin_deps;
use crate::lua::ui::UiBridge;

use super::paths::{get_disabled_plugins, plugins_dir, repo_checkout_path, save_disabled_plugins};

#[tauri::command]
pub fn get_official_plugins_repo() -> String {
    OFFICIAL_PLUGINS_REPO.to_string()
}

#[tauri::command]
pub async fn refresh_plugins_from_repos(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let mut specs = load_specs(&p_dir);
    for spec in &mut specs {
        if let Some(ref repo) = spec.repo {
            let repo_root = repo_checkout_path(&p_dir, repo);
            if repo_root.is_dir() {
                enrich_spec_from_repo_init(&repo_root, spec);
            }
        }
    }
    let lazy_config_path = p_dir.join("lazy-config.luau");
    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;
    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[tauri::command]
pub async fn open_plugins_dir(app: AppHandle) -> Result<(), StableError> {
    use tauri_plugin_opener::OpenerExt;

    let dir = plugins_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to create plugins directory: {}", e),
        )
    })?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("Failed to open plugins directory: {}", e),
            )
        })?;
    Ok(())
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
    db: State<'_, DbInstances>,
    bridge: State<'_, UiBridge>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
    plugin_id: String,
    command_id: String,
    context: serde_json::Value,
) -> Result<(), StableError> {
    let disabled = get_disabled_plugins(&*db).await?;
    if disabled.contains(&plugin_id) {
        return Err(StableError::new(
            codes::INTERNAL,
            format!(
                "Cannot execute command for deactivated plugin '{}'",
                plugin_id
            ),
        ));
    }
    let p_dir = plugins_dir(&app);
    let (tx, rx) = tokio::sync::oneshot::channel();
    runtime
        .send(crate::lua::LuaTask::ExecuteCommand {
            plugins_dir: p_dir,
            app,
            bridge: (*bridge).clone(),
            plugin_id,
            command_id,
            context,
            tx,
        })
        .map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("failed to send lua command: {}", e),
            )
        })?;

    rx.await.map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("oneshot channel recv: {}", e),
        )
    })?
}

/// Buffered `vault.log.*` history for hydrating the Log Console.
/// Live entries keep arriving via the `plugin:log` event; this covers
/// everything emitted before the webview subscribed (startup logs) or
/// before a frontend reload.
#[tauri::command]
pub fn get_plugin_logs() -> Vec<crate::lua::plugin_logs::PluginLogEntry> {
    crate::lua::plugin_logs::snapshot()
}

/// Emits one info + one error entry through the real pipeline
/// (buffer + `plugin:log` event) so users can verify the Log Console
/// end to end even when no plugin has logged anything yet.
#[tauri::command]
#[cfg_attr(not(debug_assertions), allow(unused_variables))]
pub fn emit_test_plugin_logs(app: AppHandle) {
    #[cfg(not(debug_assertions))]
    return;
    for (level, message) in [
        ("info", "Test log entry: console pipeline OK"),
        ("error", "Test error entry: console pipeline OK"),
    ] {
        let entry = crate::lua::plugin_logs::push_log("console-test", level, message);
        if let Ok(payload) = serde_json::to_value(&entry) {
            let _ = app.emit("plugin:log", payload);
        }
    }
}

#[tauri::command]
pub async fn list_plugins(
    app: AppHandle,
    db: State<'_, DbInstances>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
) -> Result<Vec<PluginInfo>, StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    let disabled = get_disabled_plugins(&*db).await?;

    let active = runtime.active_plugins.lock().unwrap().clone();
    let times = runtime.load_times.lock().unwrap().clone();
    let mut list = manager.list_plugins(&disabled, &active, &times);

    let pool = db::sqlite_pool(&*db).await?;
    for p in &mut list {
        let scoped_key = format!("plugin:{}:active_flavor", p.id);
        if let Ok(Some(val)) = db::get_setting(&pool, &scoped_key).await {
            p.active_option = Some(val);
        }
    }

    Ok(list)
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
        disabled.insert(plugin_id.clone());
    }
    save_disabled_plugins(&*db, &disabled).await?;

    if enabled {
        let p_dir = plugins_dir(&app);
        if let Err(e) = resolve_plugin_deps(&p_dir, &plugin_id) {
            eprintln!("[plugins] resolve deps for '{}': {}", plugin_id, e.message);
        }
    }

    let _ = app.emit(
        "plugin:status-changed",
        serde_json::json!({
            "pluginId": plugin_id,
            "enabled": enabled
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn get_tab_decorations(
    app: AppHandle,
    db: State<'_, DbInstances>,
    bridge: State<'_, UiBridge>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
    project_id: String,
    tab_id: String,
    element_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, crate::lua::loader::ElementDecorations>, StableError>
{
    let p_dir = plugins_dir(&app);
    let disabled = get_disabled_plugins(&*db).await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    runtime
        .send(crate::lua::LuaTask::GetDecorations {
            plugins_dir: p_dir,
            app,
            bridge: (*bridge).clone(),
            disabled_ids: disabled,
            project_id,
            tab_id,
            element_ids,
            tx,
        })
        .map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("failed to send lua get_decorations: {}", e),
            )
        })?;

    Ok(rx.await.map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("oneshot channel recv: {}", e),
        )
    })?)
}

#[tauri::command]
pub async fn get_plugin_load_stats(
    runtime: State<'_, crate::lua::LuaRuntimeState>,
) -> Result<HashMap<String, f64>, StableError> {
    let times = runtime.load_times.lock().unwrap().clone();
    Ok(times)
}

#[tauri::command]
pub async fn resolve_plugin_dependencies(
    app: AppHandle,
    plugin_id: String,
) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    resolve_plugin_deps(&p_dir, &plugin_id)?;
    let _ = app.emit("plugin:reload", ());
    Ok(())
}
