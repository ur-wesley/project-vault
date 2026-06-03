use mlua::{Lua, Result, Table};
use super::ModuleContext;
use tauri::{Emitter, Manager};

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let mise = lua.create_table()?;
    if let Some(app) = ctx.app.clone() {
        let app_get = app.clone();
        mise.set(
            "get_tools",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_get.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let root = std::path::Path::new(&project.path);
                    
                    if !root.is_dir() {
                        return Ok("[]".to_string());
                    }

                    let mut cmd = std::process::Command::new("mise");
                    cmd.args(["ls", "--json"]).current_dir(root);
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        const CREATE_NO_WINDOW: u32 = 0x08000000;
                        cmd.creation_flags(CREATE_NO_WINDOW);
                    }
                    let out = cmd.output().map_err(mlua::Error::external)?;
                    if !out.status.success() {
                        return Ok("[]".to_string());
                    }

                    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or(serde_json::Value::Null);
                    let mut tools = Vec::new();
                    if let Some(obj) = v.as_object() {
                        for (name, versions) in obj {
                            if let Some(arr) = versions.as_array() {
                                for item in arr {
                                    let version = item.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    let active = item.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if active {
                                        tools.push(serde_json::json!({
                                            "name": name,
                                            "version": version,
                                            "active": true
                                        }));
                                    }
                                }
                            }
                        }
                    }
                    Ok(serde_json::to_string(&tools).unwrap_or_else(|_| "[]".to_string()))
                }
            })?,
        )?;

        let app_sug = app.clone();
        mise.set(
            "get_suggestions",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_sug.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let root = std::path::Path::new(&project.path);
                    
                    if !root.is_dir() {
                        return Ok("[]".to_string());
                    }

                    let suggestions = crate::mise_tools::suggest_tools_for_project(
                        root,
                        &project.stack,
                        project.runtime_hint.as_deref()
                    );
                    let json = serde_json::to_string(&suggestions).map_err(mlua::Error::external)?;
                    Ok(json)
                }
            })?,
        )?;

        let app_pin = app.clone();
        mise.set(
            "pin_tools",
            lua.create_async_function(move |_, (project_id, tools_json): (String, String)| {
                let app = app_pin.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let root = std::path::Path::new(&project.path);
                    
                    if !root.is_dir() {
                        return Err(mlua::Error::RuntimeError("project path is not a directory".to_string()));
                    }

                    let tools: Vec<crate::models::MiseToolSuggestionDto> = serde_json::from_str(&tools_json)
                        .map_err(mlua::Error::external)?;

                    crate::mise_tools::pin_tools_to_mise(root, &tools)
                        .map_err(|e| mlua::Error::RuntimeError(e))?;

                    Ok(())
                }
            })?,
        )?;

        let app_install = app.clone();
        mise.set(
            "install_tools",
            lua.create_async_function(move |_, project_id: String| {
                let app = app_install.clone();
                async move {
                    let db = app.state::<tauri_plugin_sql::DbInstances>();
                    let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let project = crate::db::get_project(&pool, &project_id).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                    let root = std::path::PathBuf::from(&project.path);
                    
                    if !root.is_dir() {
                        return Err(mlua::Error::RuntimeError("project path is not a directory".to_string()));
                    }

                    let _ = app.emit("plugin:notification", serde_json::json!({
                        "level": "info",
                        "message": format!("Starting 'mise install' for project: {}", project.name)
                    }));

                    let app_complete = app.clone();
                    let proj_name = project.name.clone();
                    tokio::task::spawn(async move {
                        let mut cmd = tokio::process::Command::new("mise");
                        cmd.arg("install").current_dir(&root);
                        #[cfg(windows)]
                        {
                            const CREATE_NO_WINDOW: u32 = 0x08000000;
                            cmd.creation_flags(CREATE_NO_WINDOW);
                        }
                        
                        match cmd.output().await {
                            Ok(out) => {
                                if out.status.success() {
                                    let _ = app_complete.emit("plugin:notification", serde_json::json!({
                                        "level": "success",
                                        "message": format!("Successfully installed all tools for project: {}!", proj_name)
                                    }));
                                } else {
                                    let err_msg = String::from_utf8_lossy(&out.stderr).into_owned();
                                    let _ = app_complete.emit("plugin:notification", serde_json::json!({
                                        "level": "error",
                                        "message": format!("Failed to install tools for project {}: {}", proj_name, err_msg)
                                    }));
                                }
                            }
                            Err(e) => {
                                let _ = app_complete.emit("plugin:notification", serde_json::json!({
                                    "level": "error",
                                    "message": format!("Failed to run 'mise' command for {}: {}", proj_name, e)
                                }));
                            }
                        }
                    });

                    Ok(())
                }
            })?,
        )?;
    } else {
        mise.set("get_tools", lua.create_function(|_, _: String| Ok("[]".to_string()))?)?;
        mise.set("get_suggestions", lua.create_function(|_, _: String| Ok("[]".to_string()))?)?;
        mise.set("pin_tools", lua.create_function(|_, _: (String, String)| Ok(()))?)?;
        mise.set("install_tools", lua.create_function(|_, _: String| Ok(()))?)?;
    }
    vault.set("mise", mise)?;
    Ok(())
}
