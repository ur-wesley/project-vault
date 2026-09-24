use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mlua::LuaSerdeExt;
use tauri::Emitter;

use crate::lua::engine::LuaEngine;
use crate::lua::plugin_logs;
use crate::lua::require::clear_relative_loaded;

use super::load::*;
use super::spec::*;

pub enum LuaTask {
    ExecuteCommand {
        plugins_dir: PathBuf,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        plugin_id: String,
        command_id: String,
        context: serde_json::Value,
        tx: tokio::sync::oneshot::Sender<Result<(), crate::error::StableError>>,
    },
    GetDecorations {
        plugins_dir: PathBuf,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        disabled_ids: HashSet<String>,
        project_id: String,
        tab_id: String,
        element_ids: Vec<String>,
        tx: tokio::sync::oneshot::Sender<HashMap<String, ElementDecorations>>,
    },
}

/// Buffer one lifecycle entry (`loaded in …`, `command … completed`, …)
/// and broadcast it live so the Plugins Log Console shows plugin activity
/// even when the plugin itself never calls `vault.log.*`.
pub(crate) fn emit_lifecycle_log(app: &tauri::AppHandle, plugin_id: &str, level: &str, message: String) {
    let entry = plugin_logs::push_log(plugin_id, level, &message);
    if let Ok(payload) = serde_json::to_value(&entry) {
        let _ = app.emit("plugin:log", payload);
    }
}

/// Log a fresh plugin load with its measured time (already recorded in
/// `load_times` by `ensure_plugin_loaded`).
pub(crate) fn emit_plugin_loaded(
    app: &tauri::AppHandle,
    plugin_id: &str,
    load_times: &Arc<Mutex<HashMap<String, f64>>>,
) {
    let ms = load_times
        .lock()
        .unwrap()
        .get(plugin_id)
        .copied()
        .unwrap_or(0.0);
    emit_lifecycle_log(
        app,
        plugin_id,
        "info",
        format!("loaded in {ms:.1}ms"),
    );
}

pub struct LuaRuntimeState {
    sender: std::sync::Mutex<std::sync::mpsc::Sender<LuaTask>>,
    pub active_plugins: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    pub load_times: std::sync::Arc<std::sync::Mutex<HashMap<String, f64>>>,
}

impl LuaRuntimeState {
    pub fn new() -> Self {
        let (sender, receiver) = std::sync::mpsc::channel::<LuaTask>();
        let active_plugins = std::sync::Arc::new(std::sync::Mutex::new(HashSet::new()));
        let load_times = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        let active_plugins_c = active_plugins.clone();
        let load_times_c = load_times.clone();

        std::thread::Builder::new()
            .name("lua-worker".to_string())
            .spawn(move || {
                let mut shared_lua: Option<mlua::Lua> = None;

                while let Ok(task) = receiver.recv() {
                    match task {
                        LuaTask::ExecuteCommand { plugins_dir, app, bridge, plugin_id, command_id, context, tx } => {
                            // `command_id` moves into the xpcall below; keep a
                            // copy for the completion lifecycle log.
                            let command_id_log = command_id.clone();
                            let res = (|| {
                                let lua = match shared_lua.as_ref() {
                                    Some(l) => l,
                                    None => {
                                        let l = LuaEngine::create_instance_with_context(
                                            Some(app.clone()),
                                            Some(bridge.clone()),
                                            None,
                                        ).map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua engine setup: {}", e))
                                        })?;
                                        
                                        let loaded_tbl = l.create_table().map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("create loaded table: {}", e))
                                        })?;
                                        l.globals().set("__loaded_plugins", loaded_tbl).map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set loaded table: {}", e))
                                        })?;
                                        setup_runtime_helpers(
                                            &l,
                                            plugins_dir.clone(),
                                            active_plugins_c.clone(),
                                            load_times_c.clone(),
                                            &app,
                                        )?;

                                        shared_lua = Some(l);
                                        shared_lua.as_ref().unwrap()
                                    }
                                };

                                let specs = load_specs(&plugins_dir);
                                register_declared_graph(lua, &plugins_dir, &specs)?;

                                let is_loaded = active_plugins_c.lock().unwrap().contains(&plugin_id);
                                if !is_loaded {
                                    let mut stack = HashSet::new();
                                    ensure_plugin_loaded(
                                        lua,
                                        &plugins_dir,
                                        &plugin_id,
                                        &active_plugins_c,
                                        &load_times_c,
                                        &mut stack,
                                    )?;
                                    emit_plugin_loaded(&app, &plugin_id, &load_times_c);
                                }

                                lua.globals().set("__current_plugin_id", plugin_id.clone()).map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set current plugin: {}", e))
                                })?;
                                // Point relative requires at this plugin and drop the
                                // previous plugin's relative entries so `./x`
                                // re-resolves against the incoming plugin root
                                // (see require::clear_relative_loaded).
                                if let Some(spec) = spec_for_plugin_id(&plugins_dir, &plugin_id, &specs) {
                                    let root = resolve_plugin_root(&plugins_dir, spec);
                                    lua.globals().set("__current_plugin_root", root.to_string_lossy().to_string()).map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set current plugin root: {}", e))
                                    })?;
                                }
                                let _ = clear_relative_loaded(lua);

                                let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins").map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get loaded table: {}", e))
                                })?;
                                let plugin_table: mlua::Table = loaded_tbl.get(plugin_id.as_str()).map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get plugin table: {}", e))
                                })?;

                                if let Ok(execute_fn) = plugin_table.get::<mlua::Function>("execute") {
                                    let context_lua = lua.to_value(&context).map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("serialize context: {}", e))
                                    })?;
                                    
                                    let xpcall_fn: mlua::Function = lua.globals().get("xpcall").map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get xpcall: {}", e))
                                    })?;

                                    let error_handler = lua.create_function(|lua, err: mlua::Value| {
                                        Ok(plugin_logs::stringify_value(lua, err))
                                    }).map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("create err handler: {}", e))
                                    })?;

                                    let res_val = tauri::async_runtime::block_on(async move {
                                        xpcall_fn.call_async::<mlua::Value>((execute_fn, error_handler, command_id, context_lua)).await
                                    });

                                    match res_val {
                                        Ok(val) => {
                                            if let Ok((success, err_msg)) = lua.from_value::<(bool, Option<String>)>(val) {
                                                if !success {
                                                    let err_str = err_msg.unwrap_or_else(|| "unknown Lua error".to_string());
                                                    return Err(crate::error::StableError::new(
                                                        crate::error::codes::INTERNAL,
                                                        format!("Lua execution error: {}", err_str),
                                                    ));
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            return Err(crate::error::StableError::new(
                                                crate::error::codes::INTERNAL,
                                                format!("Lua execution panic: {}", e),
                                            ));
                                        }
                                    }
                                    Ok(())
                                } else {
                                    // Some plugins (like themes) don't have execute functions, they just return config.
                                    // That is valid. Let's return Ok.
                                    Ok(())
                                }
                            })();
                            // Single reporting point: every failure above (load errors,
                            // missing specs, Lua execution errors) lands here and is
                            // made visible in both the dev terminal and the Plugins
                            // Log Console. Previously only xpcall-body errors were
                            // reported and everything else failed silently.
                            if let Err(e) = &res {
                                eprintln!("[PLUGIN:ERROR] '{}': {}", plugin_id, e.message);
                                // Buffer so the Log Console shows command
                                // failures even if it (re)connects later.
                                let entry = plugin_logs::push_log(
                                    &plugin_id,
                                    "error",
                                    &e.message,
                                );
                                if let Ok(payload) = serde_json::to_value(&entry) {
                                    let _ = app.emit("plugin:log", payload);
                                }
                            } else {
                                // Success otherwise leaves no trace: without
                                // this the console stays empty unless a plugin
                                // calls `vault.log.*` itself.
                                emit_lifecycle_log(
                                    &app,
                                    &plugin_id,
                                    "info",
                                    format!("command '{command_id_log}' completed"),
                                );
                            }
                            let _ = tx.send(res);
                        }
                        LuaTask::GetDecorations { plugins_dir, app, bridge, disabled_ids, project_id, tab_id, element_ids, tx } => {
                            let mut merged = HashMap::new();
                            let _ = (|| {
                                let lua = match shared_lua.as_ref() {
                                    Some(l) => l,
                                    None => {
                                        let l = LuaEngine::create_instance_with_context(
                                            Some(app.clone()),
                                            Some(bridge.clone()),
                                            None,
                                        ).ok()?;
                                        let loaded_tbl = l.create_table().ok()?;
                                        l.globals().set("__loaded_plugins", loaded_tbl).ok()?;
                                        let _ = setup_runtime_helpers(
                                            &l,
                                            plugins_dir.clone(),
                                            active_plugins_c.clone(),
                                            load_times_c.clone(),
                                            &app,
                                        );
                                        shared_lua = Some(l);
                                        shared_lua.as_ref().unwrap()
                                    }
                                };

                                let specs = load_specs(&plugins_dir);
                                let _ = register_declared_graph(lua, &plugins_dir, &specs);

                                for spec in &specs {
                                    let plugin_id = spec.id.clone();
                                    if disabled_ids.contains(&plugin_id) || !spec.enabled {
                                        continue;
                                    }

                                    let is_loaded = active_plugins_c.lock().unwrap().contains(&plugin_id);
                                    if !is_loaded {
                                        let mut stack = HashSet::new();
                                        if let Err(e) = ensure_plugin_loaded(
                                            lua,
                                            &plugins_dir,
                                            &plugin_id,
                                            &active_plugins_c,
                                            &load_times_c,
                                            &mut stack,
                                        ) {
                                            // Previously silent: broken plugins
                                            // never surfaced in the console.
                                            emit_lifecycle_log(
                                                &app,
                                                &plugin_id,
                                                "error",
                                                format!("load failed: {}", e.message),
                                            );
                                            continue;
                                        }
                                        emit_plugin_loaded(&app, &plugin_id, &load_times_c);
                                    }

                                    let _ = lua.globals().set("__current_plugin_id", plugin_id.clone());
                                    if let Some(spec) = spec_for_plugin_id(&plugins_dir, &plugin_id, &specs) {
                                        let root = resolve_plugin_root(&plugins_dir, spec);
                                        let _ = lua.globals().set(
                                            "__current_plugin_root",
                                            root.to_string_lossy().to_string(),
                                        );
                                    }
                                    let _ = clear_relative_loaded(lua);

                                    let loaded_tbl: mlua::Table = match lua.globals().get("__loaded_plugins") {
                                        Ok(t) => t,
                                        Err(_) => continue,
                                    };
                                    let plugin_table: mlua::Table = match loaded_tbl.get(plugin_id.as_str()) {
                                        Ok(t) => t,
                                        Err(_) => continue,
                                    };

                                    if let Ok(get_decs_fn) = plugin_table.get::<mlua::Function>("get_decorations") {
                                        let ids_lua = match lua.to_value(&element_ids) {
                                            Ok(v) => v,
                                            Err(_) => continue,
                                        };
                                        let project_id_c = project_id.clone();
                                        let tab_id_c = tab_id.clone();
                                        
                                        let res_lua: Option<mlua::Value> = tauri::async_runtime::block_on(async {
                                            get_decs_fn.call_async::<mlua::Value>((project_id_c, tab_id_c, ids_lua)).await.ok()
                                        });

                                        if let Some(res_val) = res_lua {
                                            if let Ok(decs_map) = lua.from_value::<HashMap<String, ElementDecorations>>(res_val) {
                                                for (el_id, mut dec) in decs_map {
                                                    if let Some(ref mut before) = dec.before {
                                                        for item in before {
                                                            item.plugin_id = plugin_id.clone();
                                                        }
                                                    }
                                                    if let Some(ref mut after) = dec.after {
                                                        for item in after {
                                                            item.plugin_id = plugin_id.clone();
                                                        }
                                                    }

                                                    let entry = merged.entry(el_id).or_insert_with(ElementDecorations::default);
                                                    if let Some(mut b) = dec.before {
                                                        if let Some(ref mut eb) = entry.before {
                                                            eb.append(&mut b);
                                                        } else {
                                                            entry.before = Some(b);
                                                        }
                                                    }
                                                    if let Some(mut a) = dec.after {
                                                        if let Some(ref mut ea) = entry.after {
                                                            ea.append(&mut a);
                                                        } else {
                                                            entry.after = Some(a);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Some(())
                            })();
                            let _ = tx.send(merged);
                        }
                    }
                }
            })
            .expect("Failed to spawn lua-worker thread");

        Self {
            sender: std::sync::Mutex::new(sender),
            active_plugins,
            load_times,
        }
    }

    pub fn send(&self, task: LuaTask) -> Result<(), std::sync::mpsc::SendError<LuaTask>> {
        let guard = self.sender.lock().unwrap();
        guard.send(task)
    }
}
