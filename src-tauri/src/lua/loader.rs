use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::lua::engine::LuaEngine;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandMetadata {
    pub id: String,
    pub title: String,
    pub scope: String, // "global" or "project"
}

pub struct PluginManager {
    pub plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    pub fn list_plugin_commands(&self) -> Vec<PluginCommandMetadata> {
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

            let init_path = path.join("init.lua");
            if !init_path.is_file() {
                continue;
            }

            // In our ephemeral model, we might just load init.lua to get metadata
            // but we need a way for the script to "register" without executing full logic.
            // A common pattern is having init.lua return a table with metadata.
            
            if let Ok(lua) = LuaEngine::create_instance() {
                if let Ok(content) = std::fs::read_to_string(&init_path) {
                    if let Ok(mlua::Value::Table(table)) = lua.load(&content).eval() {
                        if let Ok(cmds) = table.get::<_, Vec<PluginCommandMetadata>>("commands") {
                            commands.extend(cmds);
                        }
                    }
                }
            }
        }

        commands
    }
}
