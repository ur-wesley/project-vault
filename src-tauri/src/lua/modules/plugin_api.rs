use mlua::{Lua, Table, Value};

use crate::lua::modules::ModuleContext;

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> mlua::Result<()> {
    let plugin_tbl = lua.create_table()?;

    let require_fn = lua.create_function(|lua, plugin_id: String| -> mlua::Result<mlua::Value> {
        let caller_id: String = lua.globals().get("__current_plugin_id").map_err(|_| {
            mlua::Error::RuntimeError("vault.plugin.require called outside plugin context".into())
        })?;

        let declared: Table = lua
            .globals()
            .get("__plugin_declared_deps")
            .unwrap_or_else(|_| lua.create_table().expect("table"));
        let caller_deps: Table = declared
            .get(caller_id.as_str())
            .unwrap_or_else(|_| lua.create_table().expect("table"));

        let mut allowed = false;
        for dep in caller_deps.sequence_values::<Value>() {
            if let Ok(Value::String(s)) = dep {
                if s.to_str()? == plugin_id {
                    allowed = true;
                    break;
                }
            }
        }
        if !allowed {
            return Err(mlua::Error::RuntimeError(format!(
                "plugin '{}' did not declare dependency on '{}'",
                caller_id, plugin_id
            )));
        }

        let ensure: mlua::Function = lua.globals().get("__ensure_plugin_loaded")?;
        ensure.call::<()>(plugin_id.clone())?;

        let loaded_tbl: Table = lua.globals().get("__loaded_plugins")?;
        let plugin_table: Table = loaded_tbl.get(plugin_id.as_str())?;
        plugin_table.get("exports").map_err(|_| {
            mlua::Error::RuntimeError(format!("plugin '{}' has no exports table", plugin_id))
        })
    })?;

    plugin_tbl.set("require", require_fn)?;
    vault.set("plugin", plugin_tbl)?;
    Ok(())
}
