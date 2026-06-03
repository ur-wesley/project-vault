use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let i18n_mod = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_c = app.clone();
        i18n_mod.set(
            "get_locale",
            lua.create_async_function(move |_, _: ()| {
                let app = app_c.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let val = crate::db::get_setting(&pool, "ui_locale").await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    Ok(val.unwrap_or_else(|| "en".to_string()))
                }
            })?,
        )?;
    } else {
        i18n_mod.set(
            "get_locale",
            lua.create_function(|_, _: ()| {
                Ok("en".to_string())
            })?,
        )?;
    }
    vault.set("i18n", i18n_mod)?;
    Ok(())
}
