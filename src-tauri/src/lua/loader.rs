use std::path::{Path, PathBuf};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub enabled: bool,
    pub commands: Vec<PluginCommandMetadata>,
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

            let init_path = path.join("init.lua");
            if !init_path.is_file() {
                continue;
            }

            if let Ok(lua) = LuaEngine::create_instance() {
                if let Ok(content) = std::fs::read_to_string(&init_path) {
                    if let Ok(mlua::Value::Table(table)) = lua.load(&content).eval() {
                        if let Ok(mut cmds) = table.get::<_, Vec<PluginCommandMetadata>>("commands") {
                            for cmd in &mut cmds {
                                cmd.plugin_id = plugin_id.clone();
                            }
                            commands.extend(cmds);
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

            let init_path = path.join("init.lua");
            if !init_path.is_file() {
                continue;
            }

            if let Ok(lua) = LuaEngine::create_instance() {
                if let Ok(content) = std::fs::read_to_string(&init_path) {
                    if let Ok(mlua::Value::Table(table)) = lua.load(&content).eval() {
                        let name = table.get::<_, String>("name").unwrap_or_else(|_| plugin_id.clone());
                        let description = table.get::<_, String>("description").ok();
                        let version = table.get::<_, String>("version").ok();
                        
                        let mut commands = table.get::<_, Vec<PluginCommandMetadata>>("commands").unwrap_or_default();
                        for cmd in &mut commands {
                            cmd.plugin_id = plugin_id.clone();
                        }

                        let enabled = !disabled_ids.contains(&plugin_id);
                        plugins.push(PluginInfo {
                            id: plugin_id,
                            name,
                            description,
                            version,
                            enabled,
                            commands,
                        });
                    }
                }
            }
        }

        plugins
    }

    pub fn execute_plugin_command(
        &self,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        plugin_id: &str,
        command_id: &str,
        context: serde_json::Value,
    ) -> Result<(), crate::error::StableError> {
        let init_path = self.plugins_dir.join(plugin_id).join("init.lua");
        if !init_path.is_file() {
            return Err(crate::error::StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("plugin '{}' or its init.lua not found", plugin_id),
            ));
        }

        let content = std::fs::read_to_string(&init_path).map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("read init.lua: {}", e))
        })?;

        let lua = LuaEngine::create_instance_with_context(Some(app), Some(bridge)).map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua engine setup: {}", e))
        })?;

        let plugin_val: mlua::Value = lua.load(&content).eval().map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua init error: {}", e))
        })?;

        if let mlua::Value::Table(plugin_table) = plugin_val {
            if let Ok(execute_fn) = plugin_table.get::<_, mlua::Function>("execute") {
                let context_lua = lua.to_value(&context).map_err(|e| {
                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("serialize context: {}", e))
                })?;
                
                let _: () = execute_fn.call((command_id, context_lua)).map_err(|e| {
                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua execution error: {}", e))
                })?;
                
                Ok(())
            } else {
                Err(crate::error::StableError::new(
                    crate::error::codes::NOT_FOUND,
                    format!("plugin '{}' does not define an 'execute' function", plugin_id),
                ))
            }
        } else {
            Err(crate::error::StableError::new(
                crate::error::codes::INVALID_PATH,
                format!("plugin '{}' init.lua must return a table", plugin_id),
            ))
        }
    }
}
