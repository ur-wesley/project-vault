use std::path::{Path, PathBuf};
use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use crate::lua::engine::LuaEngine;
use mlua::LuaSerdeExt;

pub struct LuaProjectDetector {
    pub scripts_dir: PathBuf,
}

impl LuaProjectDetector {
    pub fn new(scripts_dir: PathBuf) -> Self {
        Self { scripts_dir }
    }
}

impl ProjectDetector for LuaProjectDetector {
    fn id(&self) -> &'static str {
        "lua-detector"
    }

    fn priority(&self) -> i32 {
        50 // Default priority for Lua detectors
    }

    fn markers(&self) -> &'static [&'static str] {
        &[]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        if !self.scripts_dir.is_dir() {
            return None;
        }

        let entries = std::fs::read_dir(&self.scripts_dir).ok()?;
        for entry in entries.flatten() {
            let script_path = entry.path();
            if script_path.extension().and_then(|s| s.to_str()) != Some("lua") {
                continue;
            }

            let lua = LuaEngine::create_instance().ok()?;
            let content = std::fs::read_to_string(&script_path).ok()?;

            // Set global 'path' for the script
            lua.globals().set("path", path.to_string_lossy().to_string()).ok()?;

            // Load and execute the script
            // The script is expected to return a ProjectDraft-compatible table or nil
            let result: mlua::Value = lua.load(&content).eval().ok()?;
            
            if let mlua::Value::Table(table) = result {
                // Try to deserialize into ProjectDraft
                if let Ok(mut draft) = lua.from_value::<ProjectDraft>(mlua::Value::Table(table)) {
                    // Ensure root is correctly set to the scanned path
                    draft.root = path.to_path_buf();
                    return Some(draft);
                }
            }
        }

        None
    }
}
