use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Emitter;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let theme = lua.create_table()?;
    theme.set(
        "get_mode",
        lua.create_function(|_, _: ()| {
            Ok("dark".to_string())
        })?,
    )?;
    if let Some(app) = ctx.app.clone() {
        let app_c = app.clone();
        let plugin_id_c = ctx.plugin_id.clone();
        theme.set(
            "inject_css",
            lua.create_function(move |_, css: String| {
                let pid = plugin_id_c.clone().unwrap_or_else(|| "unknown".to_string());
                let _ = app_c.emit("plugin:inject-css", serde_json::json!({ "pluginId": pid, "css": css }));
                Ok(())
            })?,
        )?;
    } else {
        theme.set(
            "inject_css",
            lua.create_function(|_, _css: String| {
                Ok(())
            })?,
        )?;
    }
    vault.set("theme", theme)?;
    Ok(())
}
