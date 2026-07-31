use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Emitter;
use tauri::Manager;

const DEFAULT_THEME_MODE: &str = "dark";
const THEME_SETTING_KEY: &str = "ui_theme";

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let theme = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_c = app.clone();
        theme.set(
            "get_mode",
            lua.create_async_function(move |_, _: ()| {
                let app = app_c.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let val = crate::db::get_setting(&pool, THEME_SETTING_KEY)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    Ok(val.unwrap_or_else(|| DEFAULT_THEME_MODE.to_string()))
                }
            })?,
        )?;

        let app_c2 = app.clone();
        theme.set(
            "inject_css",
            lua.create_function(move |lua, css: String| {
                let pid = lua.globals().get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let _ = app_c2.emit("plugin:inject-css", serde_json::json!({ "pluginId": pid, "css": css }));
                Ok(())
            })?,
        )?;
    } else {
        theme.set(
            "get_mode",
            lua.create_function(|_, _: ()| {
                Ok(DEFAULT_THEME_MODE.to_string())
            })?,
        )?;
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
