use mlua::{Lua, Result, Table};
use super::ModuleContext;

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> Result<()> {
    let fs = lua.create_table()?;
    fs.set(
        "read_file",
        lua.create_function(|_, path: String| {
            std::fs::read_to_string(path).map_err(mlua::Error::external)
        })?,
    )?;
    fs.set(
        "write_file",
        lua.create_function(|_, (path, content): (String, String)| {
            std::fs::write(path, content).map_err(mlua::Error::external)
        })?,
    )?;
    fs.set(
        "exists",
        lua.create_function(|_, path: String| Ok(std::path::Path::new(&path).exists()))?,
    )?;
    fs.set(
        "is_dir",
        lua.create_function(|_, path: String| Ok(std::path::Path::new(&path).is_dir()))?,
    )?;
    fs.set(
        "is_file",
        lua.create_function(|_, path: String| Ok(std::path::Path::new(&path).is_file()))?,
    )?;
    fs.set(
        "list_dir",
        lua.create_function(|_, path: String| {
            let entries = std::fs::read_dir(path)
                .map_err(mlua::Error::external)?
                .filter_map(|e| e.ok())
                .map(|e| e.path().display().to_string())
                .collect::<Vec<String>>();
            Ok(entries)
        })?,
    )?;
    vault.set("fs", fs)?;
    Ok(())
}
