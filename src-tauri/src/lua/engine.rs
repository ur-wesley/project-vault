use mlua::{Lua, LuaSerdeExt, Result, StdLib};
use tauri::AppHandle;
use crate::lua::ui::{UiBridge, InputBoxOptions, QuickPickOptions};

pub struct LuaEngine;

impl LuaEngine {
    pub fn create_instance() -> Result<Lua> {
        Self::create_instance_with_context(None, None)
    }

    pub fn create_instance_with_context(
        app: Option<AppHandle>,
        bridge: Option<UiBridge>,
    ) -> Result<Lua> {
        let lua = Lua::new();
        // ...

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
        log.set(
            "info",
            lua.create_function(|_, msg: String| {
                println!("[PLUGIN:INFO] {}", msg);
                Ok(())
            })?,
        )?;
        log.set(
            "error",
            lua.create_function(|_, msg: String| {
                eprintln!("[PLUGIN:ERROR] {}", msg);
                Ok(())
            })?,
        )?;
        vault.set("log", log)?;

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
                lua.create_async_function(move |_, options: InputBoxOptions| {
                    let app = app_c.clone();
                    let bridge = bridge_c.clone();
                    async move {
                        crate::lua::ui::show_input_box(app, &bridge, options).await.map_err(mlua::Error::external)
                    }
                })?,
            )?;
            
            let app_c2 = app.clone();
            let bridge_c2 = bridge.clone();
            ui.set(
                "show_quick_pick",
                lua.create_async_function(move |_, options: QuickPickOptions| {
                    let app = app_c2.clone();
                    let bridge = bridge_c2.clone();
                    async move {
                        crate::lua::ui::show_quick_pick(app, &bridge, options).await.map_err(mlua::Error::external)
                    }
                })?,
            )?;
            vault.set("ui", ui)?;
        }

        lua.globals().set("vault", vault)?;

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
