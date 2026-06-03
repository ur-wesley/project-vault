use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Emitter;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let event = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_ev = app.clone();
        event.set(
            "publish",
            lua.create_function(move |_, (event_name, payload_json): (String, String)| {
                let val = serde_json::from_str::<serde_json::Value>(&payload_json).unwrap_or(serde_json::Value::Null);
                let _ = app_ev.emit(&event_name, val);
                Ok(())
            })?,
        )?;
    } else {
        event.set(
            "publish",
            lua.create_function(|_, _: (String, String)| Ok(()))?,
        )?;
    }
    vault.set("event", event)?;
    Ok(())
}
