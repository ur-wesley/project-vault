use super::ModuleContext;
use crate::lua::plugin_logs;
use mlua::{Lua, Result, Table};
use tauri::Emitter;

fn current_plugin_id(lua: &Lua) -> String {
    lua.globals()
        .get::<Option<String>>("__current_plugin_id")
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string())
}

fn record(lua: &Lua, app: &Option<tauri::AppHandle>, level: &str, message: String) {
    let plugin_id = current_plugin_id(lua);
    if level == "error" {
        eprintln!("[PLUGIN:ERROR] {}", message);
    } else {
        println!("[PLUGIN:INFO] {}", message);
    }
    // Buffer first so the entry survives even if no webview is listening yet
    // (startup logs); the live event keeps open consoles updating.
    let entry = plugin_logs::push_log(&plugin_id, level, &message);
    if let Some(ref app) = app {
        // Serialized via the struct so field names stay in sync with
        // `get_plugin_logs` (camelCase: pluginId/level/message/timestampMs).
        if let Ok(payload) = serde_json::to_value(&entry) {
            let _ = app.emit("plugin:log", payload);
        }
    }
}

fn register_level(lua: &Lua, log: &Table, name: &str, level: &'static str, app: Option<tauri::AppHandle>) -> Result<()> {
    log.set(
        name,
        lua.create_function(move |lua, args: mlua::MultiValue| {
            // Accept any arg count/types (nil, numbers, tables, ...) and join
            // with spaces like `print` — logging must never raise a Lua error.
            let message = args
                .into_iter()
                .map(|v| plugin_logs::stringify_value(lua, v))
                .collect::<Vec<_>>()
                .join(" ");
            record(lua, &app, level, message);
            Ok(())
        })?,
    )?;
    Ok(())
}

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let log = lua.create_table()?;
    register_level(lua, &log, "info", "info", ctx.app.clone())?;
    register_level(lua, &log, "error", "error", ctx.app.clone())?;
    vault.set("log", log)?;
    Ok(())
}
