use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    if let Some(app) = ctx.app.clone() {
        let shell = lua.create_table()?;
        shell.set(
            "list_ides",
            lua.create_function(|_, _: ()| {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    let ides = crate::ide::discover_ides();
                    let json = serde_json::to_string(&ides).unwrap_or_else(|_| "[]".to_string());
                    Ok(json)
                }
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    Ok("[]".to_string())
                }
            })?,
        )?;

        let app_c = app.clone();
        shell.set(
            "open_ide",
            lua.create_async_function(move |_, (project_id, executable): (String, String)| {
                let app = app_c.clone();
                async move {
                    #[cfg(not(any(target_os = "android", target_os = "ios")))]
                    {
                        let sessions = app.state::<crate::spawn::ProjectIdeSessions>();
                        crate::spawn::ide_session::start_ide_session(app.clone(), &sessions, project_id, executable)
                            .await
                            .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    }
                    #[cfg(any(target_os = "android", target_os = "ios"))]
                    {
                        let _ = (project_id, executable);
                    }
                    Ok(())
                }
            })?,
        )?;

        let app_c = app.clone();
        shell.set(
            "open_terminal",
            lua.create_async_function(move |_, (project_id, cwd_rel): (String, Option<String>)| {
                let app = app_c.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project_path = std::path::PathBuf::from(&project.path);
                    if !project_path.is_dir() {
                        return Err(mlua::Error::RuntimeError("project path not a directory".to_string()));
                    }

                    let cwd = if let Some(ref rel) = cwd_rel {
                        let resolved = project_path.join(rel);
                        if resolved.is_dir() { resolved } else { project_path.clone() }
                    } else {
                        project_path.clone()
                    };

                    let shell_pref = crate::db::get_setting(&pool, "shell_path")
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))?
                        .filter(|s| !s.trim().is_empty());
                    
                    #[cfg(not(any(target_os = "android", target_os = "ios")))]
                    {
                        crate::spawn::open_interactive_shell(&cwd, shell_pref.as_deref())
                            .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    }
                    #[cfg(any(target_os = "android", target_os = "ios"))]
                    {
                        let _ = shell_pref;
                    }
                    
                    let _ = crate::db::touch_project_opened(&pool, &project_id).await;
                    Ok(())
                }
            })?,
        )?;

        // vault.shell.spawn_process(command, args, cwd) -> child_pid
        shell.set(
            "spawn_process",
            lua.create_function(|_, (command, args, cwd): (String, Option<Vec<String>>, Option<String>)| {
                let mut cmd = std::process::Command::new(command);
                if let Some(a) = args {
                    cmd.args(a);
                }
                if let Some(c) = cwd {
                    cmd.current_dir(c);
                }
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let child = cmd.spawn().map_err(mlua::Error::external)?;
                Ok(child.id())
            })?,
        )?;

        let app_c = app.clone();
        shell.set(
            "spawn_task",
            lua.create_async_function(move |_, (project_id, argv, cwd_rel): (String, Vec<String>, Option<String>)| {
                let app = app_c.clone();
                async move {
                    let db_state = app.state::<tauri_plugin_sql::DbInstances>();
                    let terms = app.state::<crate::spawn::EmbeddedTerminals>();
                    let monitor = app.state::<crate::spawn::TaskMonitors>();

                    let pool = crate::db::sqlite_pool(&*db_state).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project_path = std::path::PathBuf::from(&project.path);
                    if !project_path.is_dir() {
                        return Err(mlua::Error::RuntimeError("project path not a directory".to_string()));
                    }

                    let cwd = if let Some(ref rel) = cwd_rel {
                        let resolved = project_path.join(rel);
                        if resolved.is_dir() { resolved } else { project_path.clone() }
                    } else {
                        project_path.clone()
                    };

                    let use_mise = crate::spawn::use_mise_for_project(&cwd);
                    let cmd_line = argv.join(" ");

                    let shell_pref = {
                        let custom = crate::db::get_setting(&pool, "shell_path")
                            .await
                            .map_err(|e| mlua::Error::RuntimeError(e.message))?
                            .filter(|s| !s.trim().is_empty());
                        if custom.is_some() {
                            custom
                        } else {
                            crate::db::get_setting(&pool, "default_shell_path")
                                .await
                                .map_err(|e| mlua::Error::RuntimeError(e.message))?
                                .filter(|s| !s.trim().is_empty())
                        }
                    };

                    let session = crate::db::start_session(&pool, &project_id, Some(cmd_line.clone()), None)
                        .await
                        .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let session_id = session.id.clone();

                    #[cfg(not(any(target_os = "android", target_os = "ios")))]
                    {
                        let buffers = app.state::<crate::spawn::TerminalBuffers>();
                        if let Err(e) = crate::spawn::embedded::spawn_task_in_pty(
                            app.clone(),
                            &terms,
                            &buffers,
                            &monitor,
                            project_id.clone(),
                            Some(cmd_line.clone()),
                            session.started_at_ms,
                            &cwd,
                            &argv,
                            use_mise,
                            session_id.clone(),
                            project.runtime_hint.clone(),
                            project.stack.clone(),
                            shell_pref,
                        ) {
                            let _ = crate::db::update_session_runtime(
                                &pool,
                                &session_id,
                                crate::spawn::task_monitor::TASK_STATE_ERROR,
                                None,
                                &[],
                                None,
                                Some(e.message.as_str()),
                                crate::db::now_ms(),
                            )
                            .await;
                            let _ = crate::db::end_session(&pool, &session_id).await;
                            return Err(mlua::Error::RuntimeError(e.message));
                        }
                    }

                    Ok(session_id)
                }
            })?,
        )?;

        let app_c = app.clone();
        shell.set(
            "open_path",
            lua.create_function(move |_, path: String| {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    use tauri_plugin_opener::OpenerExt;
                    let _ = app_c.opener().open_path(&path, None::<&str>);
                }
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    let _ = path;
                }
                Ok(())
            })?,
        )?;

        shell.set(
            "execute",
            lua.create_function(|lua, (command, args, cwd): (String, Option<Vec<String>>, Option<String>)| {
                let mut cmd = std::process::Command::new(command);
                if let Some(a) = args {
                    cmd.args(a);
                }
                if let Some(c) = cwd {
                    cmd.current_dir(c);
                }
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let out = cmd.output().map_err(mlua::Error::external)?;
                let res = lua.create_table()?;
                res.set("success", out.status.success())?;
                res.set("stdout", String::from_utf8_lossy(&out.stdout).to_string())?;
                res.set("stderr", String::from_utf8_lossy(&out.stderr).to_string())?;
                Ok(res)
            })?,
        )?;
        vault.set("shell", shell)?;
    } else {
        let shell = lua.create_table()?;
        shell.set("list_ides", lua.create_function(|_, _: ()| Ok("[]".to_string()))?)?;
        shell.set("open_ide", lua.create_function(|_, _: (String, String)| Ok(()))?)?;
        shell.set("open_terminal", lua.create_function(|_, _: (String, Option<String>)| Ok(()))?)?;
        shell.set("spawn_task", lua.create_function(|_, _: (String, Vec<String>, Option<String>)| Ok("".to_string()))?)?;
        shell.set("spawn_process", lua.create_function(|_, _: (String, Option<Vec<String>>, Option<String>)| Ok(0u32))?)?;
        shell.set("open_path", lua.create_function(|_, _: String| Ok(()))?)?;
        shell.set("execute", lua.create_function(|lua, _: ()| {
            let res = lua.create_table()?;
            res.set("success", false)?;
            res.set("stdout", "".to_string())?;
            res.set("stderr", "".to_string())?;
            Ok(res)
        })?)?;
        vault.set("shell", shell)?;
    }
    Ok(())
}
