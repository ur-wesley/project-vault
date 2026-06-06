use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let settings = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_c = app.clone();
        settings.set(
            "get",
            lua.create_async_function(move |lua, key: String| {
                let app = app_c.clone();
                let plugin_id = lua.globals().get::<Option<String>>("__current_plugin_id").ok().flatten();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let scoped_key = match &plugin_id {
                        Some(pid) => format!("plugin:{}:{}", pid, key),
                        None => format!("plugin:unknown:{}", key),
                    };
                    crate::db::get_setting(&pool, &scoped_key).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;

        let app_c2 = app.clone();
        settings.set(
            "set",
            lua.create_async_function(move |lua, (key, value): (String, String)| {
                let app = app_c2.clone();
                let plugin_id = lua.globals().get::<Option<String>>("__current_plugin_id").ok().flatten();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let scoped_key = match &plugin_id {
                        Some(pid) => format!("plugin:{}:{}", pid, key),
                        None => format!("plugin:unknown:{}", key),
                    };
                    crate::db::set_setting(&pool, &scoped_key, &value).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;
    } else {
        settings.set(
            "get",
            lua.create_function(|_, _key: String| {
                Ok(None::<String>)
            })?,
        )?;
        settings.set(
            "set",
            lua.create_function(|_, (_key, _value): (String, String)| {
                Ok(())
            })?,
        )?;
    }
    vault.set("settings", settings)?;
    Ok(())
}
