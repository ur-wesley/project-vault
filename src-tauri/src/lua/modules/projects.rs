use mlua::{Lua, LuaSerdeExt, Result, Table};
use super::ModuleContext;
use tauri::Manager;

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let projects = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_c = app.clone();
        projects.set(
            "list",
            lua.create_async_function(move |_, _: ()| {
                let app = app_c.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let list = crate::db::list_projects(&pool).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let json = serde_json::to_string(&list).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;

        let app_get = app.clone();
        projects.set(
            "get",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_get.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let p = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let json = serde_json::to_string(&p).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;

        let bridge_active = ctx.bridge.clone();
        projects.set(
            "get_active",
            lua.create_function(move |_, _: ()| {
                if let Some(ref b) = bridge_active {
                    Ok(b.get_active_project())
                } else {
                    Ok(None)
                }
            })?,
        )?;

        let app_run = app.clone();
        projects.set(
            "run_task",
            lua.create_async_function(move |_, (project_id, task_label): (String, String)| {
                let app = app_run.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let task = project.tasks.into_iter().find(|t| t.label == task_label)
                        .ok_or_else(|| mlua::Error::RuntimeError(format!("Task '{}' not found in project '{}'", task_label, project_id)))?;
                    
                    let payload = crate::commands::task_runner::SpawnProjectTaskPayload {
                        project_id: project_id.clone(),
                        argv: task.argv,
                        acknowledge_risk: true,
                        session_id: None,
                        cwd: task.cwd,
                        concurrent: task.concurrent,
                    };

                    let terms = app.state::<crate::spawn::EmbeddedTerminals>();
                    let monitor = app.state::<crate::spawn::TaskMonitors>();
                    #[cfg(not(any(target_os = "android", target_os = "ios")))]
                    let buffers = app.state::<crate::spawn::TerminalBuffers>();

                    crate::commands::task_runner::spawn_project_task(
                        app.clone(),
                        db,
                        terms,
                        monitor,
                        #[cfg(not(any(target_os = "android", target_os = "ios")))]
                        buffers,
                        payload
                    ).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;

                    Ok(())
                }
            })?,
        )?;

        let app_run_argv = app.clone();
        projects.set(
            "run_argv",
            lua.create_async_function(move |lua, (project_id, argv_val, cwd, concurrent_val): (String, mlua::Value, Option<String>, Option<mlua::Value>)| {
                let app = app_run_argv.clone();
                let argv: Vec<String> = lua.from_value(argv_val).unwrap_or_default();
                let concurrent: Option<Vec<crate::models::ConcurrentTask>> = concurrent_val.and_then(|v| lua.from_value(v).ok());
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let payload = crate::commands::task_runner::SpawnProjectTaskPayload {
                        project_id,
                        argv,
                        acknowledge_risk: true,
                        session_id: None,
                        cwd,
                        concurrent,
                    };

                    let terms = app.state::<crate::spawn::EmbeddedTerminals>();
                    let monitor = app.state::<crate::spawn::TaskMonitors>();
                    #[cfg(not(any(target_os = "android", target_os = "ios")))]
                    let buffers = app.state::<crate::spawn::TerminalBuffers>();

                    crate::commands::task_runner::spawn_project_task(
                        app.clone(),
                        db,
                        terms,
                        monitor,
                        #[cfg(not(any(target_os = "android", target_os = "ios")))]
                        buffers,
                        payload
                    ).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;

                    Ok(())
                }
            })?,
        )?;

        let app_stop = app.clone();
        projects.set(
            "stop_task",
            lua.create_async_function(move |_, session_id: String| {
                let app = app_stop.clone();
                async move {
                    let monitor = app.state::<crate::spawn::TaskMonitors>();
                    crate::commands::task_runner::stop_project_task(
                        app.clone(),
                        monitor,
                        session_id
                    ).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    Ok(())
                }
            })?,
        )?;

        let app_sessions = app.clone();
        projects.set(
            "get_active_sessions",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_sessions.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let list = crate::db::list_active_sessions_for_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let json = serde_json::to_string(&list).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;

        let app_git_stat = app.clone();
        projects.set(
            "get_git_status",
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

        let app_dev_time = app.clone();
        projects.set(
            "get_dev_time",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_dev_time.clone();
                async move {
                     let db = app.state::<tauri_plugin_sql::DbInstances>();
                     let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                     let sessions = crate::db::list_sessions_for_project(&pool, &project_id, 100, 0).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let json = serde_json::to_string(&sessions).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;

        let app_fav = app.clone();
        projects.set(
            "set_favorite",
            lua.create_async_function(move |_, (project_id, favorite): (String, bool)| {
                let app = app_fav.clone();
                async move {
                     let db = app.state::<tauri_plugin_sql::DbInstances>();
                     crate::commands::projects::set_project_favorite(
                         app.clone(),
                         db,
                         crate::commands::projects::SetFavoritePayload {
                             id: project_id,
                             favorite,
                         },
                     )
                     .await
                     .map_err(|e| mlua::Error::RuntimeError(e.message))?;
                     Ok(())
                }
            })?,
        )?;
    } else {
        projects.set("list", lua.create_function(|_, _: ()| Ok("[]".to_string()))?)?;
        projects.set("get", lua.create_function(|_, _: String| Ok("{}".to_string()))?)?;
        projects.set("get_active", lua.create_function(|_, _: ()| Ok(None::<String>))?)?;
        projects.set("run_task", lua.create_function(|_, _: (String, String)| Ok(()))?)?;
        projects.set("run_argv", lua.create_function(|_, _: (String, mlua::Value, Option<String>, Option<mlua::Value>)| Ok(()))?)?;
        projects.set("stop_task", lua.create_function(|_, _: String| Ok(()))?)?;
        projects.set("get_active_sessions", lua.create_function(|_, _: String| Ok("[]".to_string()))?)?;
        projects.set("get_git_status", lua.create_function(|_, _: String| Ok("{}".to_string()))?)?;
        projects.set("get_dev_time", lua.create_function(|_, _: String| Ok("[]".to_string()))?)?;
        projects.set("set_favorite", lua.create_function(|_, _: (String, bool)| Ok(()))?)?;
    }
    vault.set("projects", projects)?;
    Ok(())
}
