use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::lua::engine::LuaEngine;
use mlua::LuaSerdeExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandMetadata {
    pub id: String,
    pub title: String,
    pub scope: String, // "global" or "project"
    #[serde(default)]
    pub plugin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locales: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub enabled: bool,
    pub commands: Vec<PluginCommandMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locales: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_option: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecorationItem {
    pub icon: Option<String>,
    pub label: Option<String>,
    pub color: Option<String>,
    pub tooltip: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ElementDecorations {
    pub before: Option<Vec<DecorationItem>>,
    pub after: Option<Vec<DecorationItem>>,
}

pub struct PluginManager {
    pub plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    pub fn list_plugin_commands(&self, disabled_ids: &std::collections::HashSet<String>) -> Vec<PluginCommandMetadata> {
        let mut commands = Vec::new();
        if !self.plugins_dir.is_dir() {
            return commands;
        }

        let entries = match std::fs::read_dir(&self.plugins_dir) {
            Ok(e) => e,
            Err(_) => return commands,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let plugin_id = match path.file_name().and_then(|s| s.to_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };

            if disabled_ids.contains(&plugin_id) {
                continue;
            }

            let init_path = path.join("init.luau");
            if !init_path.is_file() {
                continue;
            }

            if let Ok(lua) = LuaEngine::create_instance() {
                if let Ok(content) = std::fs::read_to_string(&init_path) {
                    if let Ok(mlua::Value::Table(table)) = lua.load(&content).eval() {
                        let locales = table.get::<mlua::Value>("locales").ok()
                            .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
                        if let Ok(cmds_val) = table.get::<mlua::Value>("commands") {
                            if let Ok(mut cmds) = lua.from_value::<Vec<PluginCommandMetadata>>(cmds_val) {
                                for cmd in &mut cmds {
                                    cmd.plugin_id = plugin_id.clone();
                                    cmd.locales = locales.clone();
                                }
                                commands.extend(cmds);
                            }
                        }
                    }
                }
            }
        }

        commands
    }

    pub fn list_plugins(&self, disabled_ids: &std::collections::HashSet<String>) -> Vec<PluginInfo> {
        let mut plugins = Vec::new();
        if !self.plugins_dir.is_dir() {
            return plugins;
        }

        let entries = match std::fs::read_dir(&self.plugins_dir) {
            Ok(e) => e,
            Err(_) => return plugins,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let plugin_id = match path.file_name().and_then(|s| s.to_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };

            let init_path = path.join("init.luau");
            if !init_path.is_file() {
                continue;
            }

            if let Ok(lua) = LuaEngine::create_instance() {
                if let Ok(content) = std::fs::read_to_string(&init_path) {
                    if let Ok(mlua::Value::Table(table)) = lua.load(&content).eval() {
                        let name = table.get::<String>("name").unwrap_or_else(|_| plugin_id.clone());
                        let description = table.get::<String>("description").ok();
                        let version = table.get::<String>("version").ok();
                        let category = table.get::<String>("category").ok();
                        let locales = table.get::<mlua::Value>("locales").ok()
                            .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
                        let options = table.get::<mlua::Value>("options").ok()
                            .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
                        let config = table.get::<mlua::Value>("config").ok()
                            .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
                        
                        let mut commands = Vec::new();
                        if let Ok(cmds_val) = table.get::<mlua::Value>("commands") {
                            if let Ok(mut cmds) = lua.from_value::<Vec<PluginCommandMetadata>>(cmds_val) {
                                for cmd in &mut cmds {
                                    cmd.plugin_id = plugin_id.clone();
                                    cmd.locales = locales.clone();
                                }
                                commands = cmds;
                            }
                        }

                        let enabled = !disabled_ids.contains(&plugin_id);
                        plugins.push(PluginInfo {
                            id: plugin_id,
                            name,
                            description,
                            version,
                            category,
                            enabled,
                            commands,
                            locales,
                            options,
                            active_option: None,
                            config,
                        });
                    }
                }
            }
        }

        plugins
    }

    pub async fn execute_plugin_command(
        &self,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        plugin_id: &str,
        command_id: &str,
        context: serde_json::Value,
    ) -> Result<(), crate::error::StableError> {
        let init_path = self.plugins_dir.join(plugin_id).join("init.luau");
        if !init_path.is_file() {
            return Err(crate::error::StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("plugin '{}' or its init.luau not found", plugin_id),
            ));
        }

        let (tx, rx) = tokio::sync::oneshot::channel();
        
        let app_c = app.clone();
        let bridge_c = bridge.clone();
        let plugin_id_c = plugin_id.to_string();
        let command_id_c = command_id.to_string();
        let context_c = context.clone();
        let init_path_c = init_path.clone();

        std::thread::spawn(move || {
            let res = (|| {
                let content = std::fs::read_to_string(&init_path_c).map_err(|e| {
                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("read init.luau: {}", e))
                })?;

                let lua = LuaEngine::create_instance_with_context(Some(app_c), Some(bridge_c), Some(plugin_id_c.clone())).map_err(|e| {
                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua engine setup: {}", e))
                })?;

                let plugin_val: mlua::Value = lua.load(&content).eval().map_err(|e| {
                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua init error: {}", e))
                })?;

                if let mlua::Value::Table(plugin_table) = plugin_val {
                    if let Ok(execute_fn) = plugin_table.get::<mlua::Function>("execute") {
                        let context_lua = lua.to_value(&context_c).map_err(|e| {
                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("serialize context: {}", e))
                        })?;
                        
                        tauri::async_runtime::block_on(async move {
                            execute_fn.call_async::<()>((command_id_c, context_lua)).await.map_err(|e| {
                                crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua execution error: {}", e))
                            })
                        })?;
                        
                        Ok(())
                    } else {
                        Err(crate::error::StableError::new(
                            crate::error::codes::NOT_FOUND,
                            format!("plugin '{}' does not define an 'execute' function", plugin_id_c),
                        ))
                    }
                } else {
                    Err(crate::error::StableError::new(
                        crate::error::codes::INVALID_PATH,
                        format!("plugin '{}' init.luau must return a table", plugin_id_c),
                    ))
                }
            })();
            let _ = tx.send(res);
        });

        rx.await.map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("oneshot channel error: {}", e))
        })?
    }

    pub async fn get_tab_decorations(
        &self,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        disabled_ids: &std::collections::HashSet<String>,
        project_id: String,
        tab_id: String,
        element_ids: Vec<String>,
    ) -> std::collections::HashMap<String, ElementDecorations> {
        let mut merged: std::collections::HashMap<String, ElementDecorations> = std::collections::HashMap::new();
        if !self.plugins_dir.is_dir() {
            return merged;
        }

        let entries = match std::fs::read_dir(&self.plugins_dir) {
            Ok(e) => e,
            Err(_) => return merged,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let plugin_id = match path.file_name().and_then(|s| s.to_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };

            if disabled_ids.contains(&plugin_id) {
                continue;
            }

            let init_path = path.join("init.luau");
            if !init_path.is_file() {
                continue;
            }

            let app_c = app.clone();
            let bridge_c = bridge.clone();
            let plugin_id_c = plugin_id.clone();
            let init_path_c = init_path.clone();
            let project_id_c = project_id.clone();
            let tab_id_c = tab_id.clone();
            let element_ids_c = element_ids.clone();

            let (tx, rx) = tokio::sync::oneshot::channel();

            std::thread::spawn(move || {
                let res = (|| {
                    let content = std::fs::read_to_string(&init_path_c).ok()?;
                    let lua = LuaEngine::create_instance_with_context(Some(app_c), Some(bridge_c), Some(plugin_id_c.clone())).ok()?;
                    let plugin_val: mlua::Value = lua.load(&content).eval().ok()?;
                    if let mlua::Value::Table(plugin_table) = plugin_val {
                        if let Ok(get_decs_fn) = plugin_table.get::<mlua::Function>("get_decorations") {
                            let ids_lua = lua.to_value(&element_ids_c).ok()?;
                            let res_lua: mlua::Value = tauri::async_runtime::block_on(async move {
                                get_decs_fn.call_async::<mlua::Value>((project_id_c, tab_id_c, ids_lua)).await.ok()
                            })?;
                            let decs_map: std::collections::HashMap<String, ElementDecorations> = lua.from_value(res_lua).ok()?;
                            return Some(decs_map);
                        }
                    }
                    None
                })();
                let _ = tx.send(res);
            });

            if let Ok(Some(decs_map)) = rx.await {
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

        merged
    }
}

#[cfg(test)]
mod tests {
    use crate::lua::engine::LuaEngine;

    #[test]
    fn test_bundled_plugins_parse() {
        for (name, content) in crate::BUNDLED_PLUGINS {
            let lua = LuaEngine::create_instance().unwrap();
            let res: mlua::Result<mlua::Value> = lua.load(*content).eval();
            assert!(
                res.is_ok(),
                "Failed to parse bundled plugin '{}': {:?}",
                name,
                res.err()
            );
            let val = res.unwrap();
            assert!(
                matches!(val, mlua::Value::Table(_)),
                "Bundled plugin '{}' must return a table",
                name
            );
        }
    }
}
