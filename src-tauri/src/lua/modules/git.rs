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

        let app_log = app.clone();
        git_mod.set(
            "log",
            lua.create_async_function(move |_, (project_id, max_count): (String, Option<u32>)| {
                let app = app_log.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let cwd = std::path::Path::new(&project.path);
                    
                    if !crate::commands::git::utils::is_git_repo(cwd) {
                        return Ok("[]".to_string());
                    }

                    let limit = max_count.unwrap_or(20);
                    let mut cmd = std::process::Command::new("git");
                    cmd.args([
                        "log",
                        &format!("-n{}", limit),
                        "--pretty=format:%H|%an|%ae|%s|%ad|%ar",
                        "--date=iso"
                    ]).current_dir(cwd);
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        const CREATE_NO_WINDOW: u32 = 0x08000000;
                        cmd.creation_flags(CREATE_NO_WINDOW);
                    }
                    let out = cmd.output().map_err(mlua::Error::external)?;
                    let mut commits = Vec::new();
                    let stdout_str = String::from_utf8_lossy(&out.stdout);
                    for line in stdout_str.lines() {
                        if line.is_empty() { continue; }
                        let mut parts = line.splitn(6, '|');
                        let hash = parts.next().unwrap_or("").to_string();
                        let author = parts.next().unwrap_or("").to_string();
                        let email = parts.next().unwrap_or("").to_string();
                        let subject = parts.next().unwrap_or("").to_string();
                        let date = parts.next().unwrap_or("").to_string();
                        let relative_date = parts.next().unwrap_or("").to_string();
                        commits.push(serde_json::json!({
                            "hash": hash,
                            "author": author,
                            "email": email,
                            "subject": subject,
                            "date": date,
                            "relativeDate": relative_date
                        }));
                    }
                    let json = serde_json::to_string(&commits).unwrap_or_else(|_| "[]".to_string());
                    Ok(json)
                }
            })?,
        )?;

        let app_status = app.clone();
        git_mod.set(
            "status",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_status.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let cwd = std::path::Path::new(&project.path);
                    
                    if !crate::commands::git::utils::is_git_repo(cwd) {
                        return Ok(None::<String>);
                    }

                    let run_cmd = |args: &[&str]| -> Option<String> {
                        let mut cmd = std::process::Command::new("git");
                        cmd.args(args).current_dir(cwd);
                        #[cfg(windows)]
                        {
                            use std::os::windows::process::CommandExt;
                            const CREATE_NO_WINDOW: u32 = 0x08000000;
                            cmd.creation_flags(CREATE_NO_WINDOW);
                        }
                        let out = cmd.output().ok()?;
                        if out.status.success() {
                            Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
                        } else {
                            None
                        }
                    };

                    let branch = run_cmd(&["branch", "--show-current"]).unwrap_or_else(|| "HEAD".to_string());
                    
                    let mut ahead = 0;
                    let mut behind = 0;
                    let mut has_upstream = false;
                    if let Some(revs) = run_cmd(&["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
                        has_upstream = true;
                        let parts: Vec<&str> = revs.split_whitespace().collect();
                        if parts.len() == 2 {
                            ahead = parts[0].parse().unwrap_or(0);
                            behind = parts[1].parse().unwrap_or(0);
                        }
                    }

                    let is_dirty = run_cmd(&["status", "--porcelain"])
                        .map(|s| !s.is_empty())
                        .unwrap_or(false);

                    let version = run_cmd(&["describe", "--tags", "--abbrev=0"]);

                    let status_json = serde_json::json!({
                        "branch": branch,
                        "ahead": ahead,
                        "behind": behind,
                        "isDirty": is_dirty,
                        "hasUpstream": has_upstream,
                        "version": version
                    });

                    Ok(Some(serde_json::to_string(&status_json).unwrap_or_default()))
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
        git_mod.set("log", lua.create_function(|_, _: (String, Option<u32>)| Ok("[]".to_string()))?)?;
        git_mod.set("status", lua.create_function(|_, _: String| Ok(None::<String>))?)?;
    }
    vault.set("git", git_mod)?;
    Ok(())
}
