use mlua::{Lua, LuaSerdeExt, Result, Table};
use super::ModuleContext;

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> Result<()> {
    // vault.json module
    let json = lua.create_table()?;
    json.set(
        "parse",
        lua.create_function(|lua, s: String| {
            let v: serde_json::Value = serde_json::from_str(&s).map_err(mlua::Error::external)?;
            lua.to_value(&v)
        })?,
    )?;
    json.set(
        "stringify",
        lua.create_function(|lua, v: mlua::Value| {
            let v: serde_json::Value = lua.from_value(v)?;
            serde_json::to_string(&v).map_err(mlua::Error::external)
        })?,
    )?;
    vault.set("json", json)?;

    // vault.toml module
    let toml = lua.create_table()?;
    toml.set(
        "parse",
        lua.create_function(|lua, s: String| {
            let v: toml::Value = toml::from_str(&s).map_err(mlua::Error::external)?;
            lua.to_value(&v)
        })?,
    )?;
    toml.set(
        "stringify",
        lua.create_function(|lua, v: mlua::Value| {
            let v: toml::Value = lua.from_value(v)?;
            toml::to_string(&v).map_err(mlua::Error::external)
        })?,
    )?;
    vault.set("toml", toml)?;

    Ok(())
}
