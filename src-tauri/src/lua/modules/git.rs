use mlua::{Lua, LuaSerdeExt, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let git_mod = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_git = app.clone();
        git_mod.set(
            "run",
            lua.create_async_function(move |lua, (project_id, args_val): (String, mlua::Value)| {
                let app = app_git.clone();
                let args: Vec<String> = lua.from_value(args_val).unwrap_or_default();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let root = std::path::Path::new(&project.path);
                    if !root.is_dir() {
                        return Err(mlua::Error::RuntimeError("project directory not found".to_string()));
                    }

                    let mut cmd = std::process::Command::new("git");
                    cmd.args(&args).current_dir(root);
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
                }
            })?,
        )?;

        let app_git_stat = app.clone();
        git_mod.set(
            "get_status",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_git_stat.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let res = crate::commands::git::get_git_status(db, project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let json = serde_json::to_string(&res).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;
    } else {
        git_mod.set("run", lua.create_function(|lua, _: (String, mlua::Value)| {
            let res = lua.create_table()?;
            res.set("success", false)?;
            res.set("stdout", "".to_string())?;
            res.set("stderr", "".to_string())?;
            Ok(res)
        })?)?;
        git_mod.set("get_status", lua.create_function(|_, _: String| Ok("{}".to_string()))?)?;
    }
    vault.set("git", git_mod)?;
    Ok(())
}
