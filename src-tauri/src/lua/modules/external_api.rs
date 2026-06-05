use mlua::{Lua, Table, Value};

use crate::lua::modules::ModuleContext;

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> mlua::Result<()> {
    let external_tbl = lua.create_table()?;

    let require_fn = lua.create_function(|lua, external_id: String| -> mlua::Result<mlua::Value> {
        let caller_id: String = lua.globals().get("__current_plugin_id").map_err(|_| {
            mlua::Error::RuntimeError(
                "vault.external.require called outside plugin context".into(),
            )
        })?;

        let declared: Table = lua
            .globals()
            .get("__plugin_declared_externals")
            .unwrap_or_else(|_| lua.create_table().expect("table"));
        let caller_exts: Table = declared
            .get(caller_id.as_str())
            .unwrap_or_else(|_| lua.create_table().expect("table"));

        let mut allowed = false;
        for ext in caller_exts.sequence_values::<Value>() {
            if let Ok(Value::String(s)) = ext {
                if s.to_str()? == external_id {
                    allowed = true;
                    break;
                }
            }
        }
        if !allowed {
            return Err(mlua::Error::RuntimeError(format!(
                "plugin '{}' did not declare external '{}'",
                caller_id, external_id
            )));
        }

        let ensure: mlua::Function = lua.globals().get("__ensure_external_loaded")?;
        ensure.call::<Value>(external_id)
    })?;

    external_tbl.set("require", require_fn)?;
    vault.set("external", external_tbl)?;
    Ok(())
}
