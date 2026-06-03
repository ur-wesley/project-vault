use mlua::{Lua, Result, Table, LuaSerdeExt};
use super::ModuleContext;
use tauri::Emitter;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let notification = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_success = app.clone();
        notification.set(
            "success",
            lua.create_function(move |_, msg: String| {
                let _ = app_success.emit("plugin:notification", serde_json::json!({
                    "level": "success",
                    "message": msg
                }));
                Ok(())
            })?,
        )?;

        let app_info = app.clone();
        notification.set(
            "info",
            lua.create_function(move |_, msg: String| {
                let _ = app_info.emit("plugin:notification", serde_json::json!({
                    "level": "info",
                    "message": msg
                }));
                Ok(())
            })?,
        )?;

        let app_error = app.clone();
        notification.set(
            "error",
            lua.create_function(move |_, msg: String| {
                let _ = app_error.emit("plugin:notification", serde_json::json!({
                    "level": "error",
                    "message": msg
                }));
                Ok(())
            })?,
        )?;

        let app_warn = app.clone();
        notification.set(
            "warn",
            lua.create_function(move |_, msg: String| {
                let _ = app_warn.emit("plugin:notification", serde_json::json!({
                    "level": "warn",
                    "message": msg
                }));
                Ok(())
            })?,
        )?;

        let app_show = app.clone();
        let plugin_id_show = ctx.plugin_id.clone();
        notification.set(
            "show",
            lua.create_function(move |lua, opts_val: mlua::Value| {
                #[derive(serde::Deserialize)]
                struct ActionOpts {
                    id: String,
                    label: String,
                    primary: Option<bool>,
                    command: Option<String>,
                }
                #[derive(serde::Deserialize)]
                struct ShowOpts {
                    severity: Option<String>,
                    title: String,
                    message: Option<String>,
                    source: Option<String>,
                    actions: Option<Vec<ActionOpts>>,
                    persist: Option<bool>,
                }
                let opts: ShowOpts = lua.from_value(opts_val)?;
                let pid = plugin_id_show.clone().unwrap_or_else(|| "unknown".to_string());
                let actions: Vec<serde_json::Value> = opts
                    .actions
                    .unwrap_or_default()
                    .into_iter()
                    .map(|a| {
                        let full_command = a
                            .command
                            .map(|c| format!("plugin:{}:{}", pid, c));
                        serde_json::json!({
                            "id": a.id,
                            "label": a.label,
                            "primary": a.primary.unwrap_or(false),
                            "command": full_command,
                        })
                    })
                    .collect();
                let _ = app_show.emit("plugin:notification-rich", serde_json::json!({
                    "pluginId": pid,
                    "severity": opts.severity.unwrap_or_else(|| "info".to_string()),
                    "title": opts.title,
                    "message": opts.message,
                    "source": opts.source,
                    "actions": actions,
                    "persist": opts.persist,
                }));
                Ok(())
            })?,
        )?;
    } else {
        notification.set("success", lua.create_function(|_, _: String| Ok(()))?)?;
        notification.set("info", lua.create_function(|_, _: String| Ok(()))?)?;
        notification.set("error", lua.create_function(|_, _: String| Ok(()))?)?;
        notification.set("warn", lua.create_function(|_, _: String| Ok(()))?)?;
        notification.set("show", lua.create_function(|_, _: mlua::Value| Ok(()))?)?;
    }
    vault.set("notification", notification)?;
    Ok(())
}
