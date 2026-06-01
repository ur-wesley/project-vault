use mlua::{Lua, LuaSerdeExt, Result, StdLib};
use tauri::{AppHandle, Emitter, Manager};
use crate::lua::ui::{UiBridge, InputBoxOptions, QuickPickOptions};

pub struct LuaEngine;

impl LuaEngine {
    pub fn create_instance() -> Result<Lua> {
        Self::create_instance_with_context(None, None, None)
    }

    pub fn create_instance_with_context(
        app: Option<AppHandle>,
        bridge: Option<UiBridge>,
        plugin_id: Option<String>,
    ) -> Result<Lua> {
        let lua = Lua::new();

        // Load a restricted set of standard libraries
        lua.load_std_libs(
            StdLib::TABLE
                | StdLib::STRING
                | StdLib::MATH
                | StdLib::COROUTINE
                | StdLib::BIT
                | StdLib::UTF8
                | StdLib::PACKAGE,
        )?;

        // Inject global 'vault' table
        let vault = lua.create_table()?;
        
        // vault.log module
        let log = lua.create_table()?;
        let app_log = app.clone();
        let plugin_id_log = plugin_id.clone();
        log.set(
            "info",
            lua.create_function(move |_, msg: String| {
                println!("[PLUGIN:INFO] {}", msg);
                if let Some(ref app) = app_log {
                    let pid = plugin_id_log.clone().unwrap_or_else(|| "unknown".to_string());
                    let _ = app.emit("plugin:log", serde_json::json!({
                        "pluginId": pid,
                        "level": "info",
                        "message": msg.clone()
                    }));
                }
                Ok(())
            })?,
        )?;
        
        let app_log2 = app.clone();
        let plugin_id_log2 = plugin_id.clone();
        log.set(
            "error",
            lua.create_function(move |_, msg: String| {
                eprintln!("[PLUGIN:ERROR] {}", msg);
                if let Some(ref app) = app_log2 {
                    let pid = plugin_id_log2.clone().unwrap_or_else(|| "unknown".to_string());
                    let _ = app.emit("plugin:log", serde_json::json!({
                        "pluginId": pid,
                        "level": "error",
                        "message": msg.clone()
                    }));
                }
                Ok(())
            })?,
        )?;
        vault.set("log", log)?;

        // vault.notification module
        let notification = lua.create_table()?;
        if let Some(app) = app.clone() {
            let app_success = app.clone();
            notification.set(
                "success",
                lua.create_function(move |_, msg: String| {
                    let _ = app_success.emit("plugin:notification", serde_json::json!({
                        "level": "success",
                        "message": msg
                    }));
                    Ok(())
                })?,
            )?;
            
            let app_info = app.clone();
            notification.set(
                "info",
                lua.create_function(move |_, msg: String| {
                    let _ = app_info.emit("plugin:notification", serde_json::json!({
                        "level": "info",
                        "message": msg
                    }));
                    Ok(())
                })?,
            )?;

            let app_error = app.clone();
            notification.set(
                "error",
                lua.create_function(move |_, msg: String| {
                    let _ = app_error.emit("plugin:notification", serde_json::json!({
                        "level": "error",
                        "message": msg
                    }));
                    Ok(())
                })?,
            )?;

            let app_warn = app.clone();
            notification.set(
                "warn",
                lua.create_function(move |_, msg: String| {
                    let _ = app_warn.emit("plugin:notification", serde_json::json!({
                        "level": "warn",
                        "message": msg
                    }));
                    Ok(())
                })?,
            )?;
        } else {
            notification.set("success", lua.create_function(|_, _: String| Ok(()))?)?;
            notification.set("info", lua.create_function(|_, _: String| Ok(()))?)?;
            notification.set("error", lua.create_function(|_, _: String| Ok(()))?)?;
            notification.set("warn", lua.create_function(|_, _: String| Ok(()))?)?;
        }
        vault.set("notification", notification)?;

        // vault.settings module
        let settings = lua.create_table()?;
        if let Some(app) = app.clone() {
            let app_c = app.clone();
            let plugin_id_c = plugin_id.clone();
            settings.set(
                "get",
                lua.create_async_function(move |_, key: String| {
                    let app = app_c.clone();
                    let plugin_id = plugin_id_c.clone();
                    async move {
                        let db = app.state::<tauri_plugin_sql::DbInstances>();
                        let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                        let scoped_key = match &plugin_id {
                            Some(pid) => format!("plugin:{}:{}", pid, key),
                            None => format!("plugin:unknown:{}", key),
                        };
                        crate::db::get_setting(&pool, &scoped_key).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                    }
                })?,
            )?;

            let app_c2 = app.clone();
            let plugin_id_c2 = plugin_id.clone();
            settings.set(
                "set",
                lua.create_async_function(move |_, (key, value): (String, String)| {
                    let app = app_c2.clone();
                    let plugin_id = plugin_id_c2.clone();
                    async move {
                        let db = app.state::<tauri_plugin_sql::DbInstances>();
                        let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                        let scoped_key = match &plugin_id {
                            Some(pid) => format!("plugin:{}:{}", pid, key),
                            None => format!("plugin:unknown:{}", key),
                        };
                        crate::db::set_setting(&pool, &scoped_key, &value).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                    }
                })?,
            )?;
        } else {
            settings.set(
                "get",
                lua.create_function(|_, _key: String| {
                    Ok(None::<String>)
                })?,
            )?;
            settings.set(
                "set",
                lua.create_function(|_, (_key, _value): (String, String)| {
                    Ok(())
                })?,
            )?;
        }
        vault.set("settings", settings)?;

        // vault.theme module
        let theme = lua.create_table()?;
        theme.set(
            "get_mode",
            lua.create_function(|_, _: ()| {
                Ok("dark".to_string())
            })?,
        )?;
        if let Some(app) = app.clone() {
            let app_c = app.clone();
            let plugin_id_c = plugin_id.clone();
            theme.set(
                "inject_css",
                lua.create_function(move |_, css: String| {
                    let pid = plugin_id_c.clone().unwrap_or_else(|| "unknown".to_string());
                    let _ = app_c.emit("plugin:inject-css", serde_json::json!({ "pluginId": pid, "css": css }));
                    Ok(())
                })?,
            )?;
        } else {
            theme.set(
                "inject_css",
                lua.create_function(|_, _css: String| {
                    Ok(())
                })?,
            )?;
        }
        vault.set("theme", theme)?;

        // vault.i18n module
        let i18n_mod = lua.create_table()?;
        if let Some(app) = app.clone() {
            let app_c = app.clone();
            i18n_mod.set(
                "get_locale",
                lua.create_async_function(move |_, _: ()| {
                    let app = app_c.clone();
                    async move {
                        let db = app.state::<tauri_plugin_sql::DbInstances>();
                        let pool = crate::db::sqlite_pool(&*db).await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                        let val = crate::db::get_setting(&pool, "ui_locale").await.map_err(|e| mlua::Error::RuntimeError(e.message))?;
                        Ok(val.unwrap_or_else(|| "en".to_string()))
                    }
                })?,
            )?;
        } else {
            i18n_mod.set(
                "get_locale",
                lua.create_function(|_, _: ()| {
                    Ok("en".to_string())
                })?,
            )?;
        }
        vault.set("i18n", i18n_mod)?;

        // vault.projects module
        let projects = lua.create_table()?;
        if let Some(app) = app.clone() {
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
        } else {
            projects.set(
                "list",
                lua.create_function(|_, _: ()| {
                    Ok("[]".to_string())
                })?,
            )?;
        }
        vault.set("projects", projects)?;

        // vault.mise module
        let mise = lua.create_table()?;
        if let Some(app) = app.clone() {
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

        // vault.fs module
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

        // vault.ui module
        if let (Some(app), Some(bridge)) = (app, bridge) {
            let ui = lua.create_table()?;
            let app_c = app.clone();
            let bridge_c = bridge.clone();
            ui.set(
                "show_input_box",
                lua.create_async_function(move |lua, options_val: mlua::Value| {
                    let app = app_c.clone();
                    let bridge = bridge_c.clone();
                    let options_res: mlua::Result<InputBoxOptions> = lua.from_value(options_val);
                    async move {
                        let options = options_res?;
                        crate::lua::ui::show_input_box(app, &bridge, options).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                    }
                })?,
            )?;
            
            let app_c2 = app.clone();
            let bridge_c2 = bridge.clone();
            ui.set(
                "show_quick_pick",
                lua.create_async_function(move |lua, options_val: mlua::Value| {
                    let app = app_c2.clone();
                    let bridge = bridge_c2.clone();
                    let options_res: mlua::Result<QuickPickOptions> = lua.from_value(options_val);
                    async move {
                        let options = options_res?;
                        crate::lua::ui::show_quick_pick(app, &bridge, options).await.map_err(|e| mlua::Error::RuntimeError(e.message))
                    }
                })?,
            )?;
            let app_c3 = app.clone();
            ui.set(
                "open_project_file",
                lua.create_function(move |_, (project_id, file_path, line): (String, String, Option<u32>)| {
                    let _ = app_c3.emit("plugin:open-project-file", serde_json::json!({
                        "projectId": project_id,
                        "filePath": file_path,
                        "line": line.unwrap_or(0)
                    }));
                    Ok(())
                })?,
            )?;

            // vault.ui.set_footer — display a persistent segment in the app footer/status bar
            let app_footer = app.clone();
            let plugin_id_footer = plugin_id.clone();
            ui.set(
                "set_footer",
                lua.create_function(move |lua, options_val: mlua::Value| {
                    #[derive(serde::Deserialize)]
                    struct FooterOptions {
                        id: String,
                        text: String,
                        icon: Option<String>,
                        tooltip: Option<String>,
                        command: Option<String>,
                        color: Option<String>,
                    }
                    let opts: FooterOptions = lua.from_value(options_val)?;
                    let pid = plugin_id_footer.clone().unwrap_or_else(|| "unknown".to_string());
                    let _ = app_footer.emit("plugin:set-footer", serde_json::json!({
                        "pluginId": pid,
                        "id": opts.id,
                        "text": opts.text,
                        "icon": opts.icon,
                        "tooltip": opts.tooltip,
                        "command": opts.command,
                        "color": opts.color.unwrap_or_else(|| "default".to_string()),
                    }));
                    Ok(())
                })?,
            )?;

            // vault.ui.clear_footer — remove a footer segment by id
            let app_footer_clear = app.clone();
            let plugin_id_footer_clear = plugin_id.clone();
            ui.set(
                "clear_footer",
                lua.create_function(move |_, id: String| {
                    let pid = plugin_id_footer_clear.clone().unwrap_or_else(|| "unknown".to_string());
                    let _ = app_footer_clear.emit("plugin:clear-footer", serde_json::json!({
                        "pluginId": pid,
                        "id": id,
                    }));
                    Ok(())
                })?,
            )?;

            vault.set("ui", ui)?;
        }

        lua.globals().set("vault", vault.clone())?;

        // Register vault in package.loaded under both keys:
        //   "vault"    — for plugins that call require("vault") directly
        //   "../vault" — for bundled plugins that call require("../vault") for full static typing
        //                (Lua checks package.loaded by literal key before any filesystem lookup,
        //                 so the real vault table is returned with no disk access)
        if let Ok(package) = lua.globals().get::<mlua::Table>("package") {
            if let Ok(loaded) = package.get::<mlua::Table>("loaded") {
                let _ = loaded.set("vault", vault.clone());
                let _ = loaded.set("../vault", vault);
            }
        }

        Ok(lua)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lua_isolation() {
        let lua1 = LuaEngine::create_instance().unwrap();
        let lua2 = LuaEngine::create_instance().unwrap();

        lua1.load("x = 10").exec().unwrap();
        let x_in_lua2: Option<i32> = lua2.globals().get("x").ok();
        
        assert_eq!(x_in_lua2, None);
    }

    #[test]
    fn test_vault_log() {
        let lua = LuaEngine::create_instance().unwrap();
        lua.load(r#"vault.log.info("hello from lua")"#).exec().unwrap();
    }

    #[test]
    fn test_vault_fs() {
        let lua = LuaEngine::create_instance().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let path_str = file_path.display().to_string();

        lua.globals().set("test_path", path_str.clone()).unwrap();
        lua.load(r#"vault.fs.write_file(test_path, "lua data")"#).exec().unwrap();

        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "lua data");

        let read_back: String = lua.load(r#"return vault.fs.read_file(test_path)"#).eval().unwrap();
        assert_eq!(read_back, "lua data");
    }

    #[test]
    fn test_vault_parsers() {
        let lua = LuaEngine::create_instance().unwrap();
        
        // JSON
        let json_val: mlua::Value = lua.load(r#"return vault.json.parse('{"a": 1, "b": [true, null]}')"#).eval().unwrap();
        let json_str: String = lua.load(r#"return vault.json.stringify({x = 10, y = "abc"})"#).eval().unwrap();
        assert!(json_str.contains(r#""x":10"#));
        assert!(json_str.contains(r#""y":"abc""#));

        // TOML
        let toml_val: mlua::Value = lua.load(r#"return vault.toml.parse('name = "vault"\nversion = 1')"#).eval().unwrap();
        let toml_str: String = lua.load(r#"return vault.toml.stringify({p = { q = 1 }})"#).eval().unwrap();
        assert!(toml_str.contains("q = 1"));
    }
}
