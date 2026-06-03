use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Emitter;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let log = lua.create_table()?;
    let app_log = ctx.app.clone();
    let plugin_id_log = ctx.plugin_id.clone();
    log.set(
        "info",
        lua.create_function(move |_, msg: String| {
            println!("[PLUGIN:INFO] {}", msg);
            if let Some(ref app) = app_log {
                let pid = plugin_id_log.clone().unwrap_or_else(|| "unknown".to_string());
                let _ = app.emit("plugin:log", serde_json::json!({
                    "pluginId": pid,
                    "level": "info",
                    "message": msg.clone()
                }));
            }
            Ok(())
        })?,
    )?;

    let app_log2 = ctx.app.clone();
    let plugin_id_log2 = ctx.plugin_id.clone();
    log.set(
        "error",
        lua.create_function(move |_, msg: String| {
            eprintln!("[PLUGIN:ERROR] {}", msg);
            if let Some(ref app) = app_log2 {
                let pid = plugin_id_log2.clone().unwrap_or_else(|| "unknown".to_string());
                let _ = app.emit("plugin:log", serde_json::json!({
                    "pluginId": pid,
                    "level": "error",
                    "message": msg.clone()
                }));
            }
            Ok(())
        })?,
    )?;

    vault.set("log", log)?;
    Ok(())
}
