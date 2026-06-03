use mlua::{Lua, LuaSerdeExt, Result, Table};
use super::ModuleContext;

pub fn register(lua: &Lua, vault: &Table, _ctx: &ModuleContext) -> Result<()> {
    let process = lua.create_table()?;
    process.set(
        "spawn",
        lua.create_function(|lua, (command, args_val, cwd_val): (String, mlua::Value, Option<String>)| {
            let args: Vec<String> = lua.from_value(args_val).unwrap_or_default();
            let mut cmd = std::process::Command::new(command);
            cmd.args(&args);
            if let Some(cwd) = cwd_val {
                cmd.current_dir(cwd);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            let out = cmd.output().map_err(mlua::Error::external)?;
            let success = out.status.success();
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();

            let res_table = lua.create_table()?;
            res_table.set("success", success)?;
            res_table.set("stdout", stdout)?;
            res_table.set("stderr", stderr)?;
            Ok(res_table)
        })?,
    )?;
    vault.set("process", process)?;
    Ok(())
}
