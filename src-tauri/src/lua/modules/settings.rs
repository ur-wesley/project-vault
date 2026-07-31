use mlua::{Lua, Result, Table};
use super::app_settings;
use super::ModuleContext;
use tauri::Manager;

pub(crate) fn plugin_scoped_key(plugin_id: Option<&str>, key: &str) -> String {
    match plugin_id {
        Some(pid) => format!("plugin:{pid}:{key}"),
        None => format!("plugin:unknown:{key}"),
    }
}

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
                    let scoped_key = plugin_scoped_key(plugin_id.as_deref(), &key);
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
                    let scoped_key = plugin_scoped_key(plugin_id.as_deref(), &key);
                    crate::db::set_setting(&pool, &scoped_key, &value).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                }
            })?,
        )?;

        let app_c3 = app.clone();
        settings.set(
            "get_app",
            lua.create_async_function(move |_, key: String| {
                let app = app_c3.clone();
                async move {
                    app_settings::validate_readable_app_setting(&key)
                        .map_err(mlua::Error::RuntimeError)?;
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    crate::db::get_setting(&pool, &key).await.map_err(|e| mlua::Error::RuntimeError(e.message))
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
        settings.set(
            "get_app",
            lua.create_function(|_, _key: String| {
                Ok(None::<String>)
            })?,
        )?;
    }
    vault.set("settings", settings)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_scoped_key_uses_plugin_id() {
        assert_eq!(
            plugin_scoped_key(Some("my-plugin"), "ui_locale"),
            "plugin:my-plugin:ui_locale"
        );
    }

    #[test]
    fn plugin_scoped_key_falls_back_to_unknown() {
        assert_eq!(
            plugin_scoped_key(None, "ui_locale"),
            "plugin:unknown:ui_locale"
        );
    }

    #[test]
    fn scoped_key_differs_from_app_key() {
        let scoped = plugin_scoped_key(Some("demo"), "ui_locale");
        assert_ne!(scoped, "ui_locale");
        assert!(scoped.starts_with("plugin:demo:"));
    }
}
