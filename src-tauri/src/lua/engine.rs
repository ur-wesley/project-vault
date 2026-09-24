use crate::lua::modules::{self, ModuleContext};
use crate::lua::ui::UiBridge;
use mlua::{Lua, Result, StdLib};
use tauri::AppHandle;

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

        let ctx = ModuleContext {
            app,
            bridge,
            plugin_id,
        };

        // Register all modular namespaces
        modules::log::register(&lua, &vault, &ctx)?;
        modules::notification::register(&lua, &vault, &ctx)?;
        modules::settings::register(&lua, &vault, &ctx)?;
        modules::theme::register(&lua, &vault, &ctx)?;
        modules::i18n::register(&lua, &vault, &ctx)?;
        modules::projects::register(&lua, &vault, &ctx)?;
        modules::mise::register(&lua, &vault, &ctx)?;
        modules::postgres::register(&lua, &vault, &ctx)?;
        modules::fs::register(&lua, &vault, &ctx)?;
        modules::serialization::register(&lua, &vault, &ctx)?;
        modules::ui_ext::register(&lua, &vault, &ctx)?;
        modules::git::register(&lua, &vault, &ctx)?;
        modules::github::register(&lua, &vault, &ctx)?;
        modules::process::register(&lua, &vault, &ctx)?;
        modules::event::register(&lua, &vault, &ctx)?;
        modules::shell::register(&lua, &vault, &ctx)?;
        modules::plugin_api::register(&lua, &vault, &ctx)?;
        modules::external_api::register(&lua, &vault, &ctx)?;
        modules::store::register(&lua, &vault, &ctx)?;
        modules::system::register(&lua, &vault, &ctx)?;
        // Install Solid-style signals runtime as vault.* helpers.
        let signals_src = crate::lua::ui::SIGNALS_LUAU;
        let signals_mod: mlua::Table = lua.load(signals_src).eval()?;
        let make_bound = |name: &str| -> mlua::Result<mlua::Function> {
            let tbl = signals_mod.clone();
            let method = name.to_string();
            // NOTE: must return MultiValue — a plain Value return would drop
            // all but the first Luau return (e.g. createSignal's setter).
            lua.create_function(move |lua, v: mlua::Value| {
                let pid = lua
                    .globals()
                    .get::<Option<String>>("__current_plugin_id")
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "unknown".to_string());
                let res: mlua::MultiValue = match method.as_str() {
                    "createSignal" => {
                        let initial = v;
                        let f: mlua::Function = tbl.get("createSignal")?;
                        f.call((pid, initial))?
                    }
                    "createEffect" => {
                        let f: mlua::Function = tbl.get("createEffect")?;
                        f.call((pid, v))?
                    }
                    "createMemo" => {
                        let f: mlua::Function = tbl.get("createMemo")?;
                        f.call((pid, v))?
                    }
                    _ => {
                        let mut mv = mlua::MultiValue::new();
                        mv.push_back(v);
                        mv
                    }
                };
                Ok(res)
            })
        };
        vault.set("createSignal", make_bound("createSignal")?)?;
        vault.set("createEffect", make_bound("createEffect")?)?;
        vault.set("createMemo", make_bound("createMemo")?)?;
        {
            let tbl = signals_mod.clone();
            vault.set(
                "batch",
                lua.create_function(move |_, f: mlua::Function| {
                    let b: mlua::Function = tbl.get("batch")?;
                    b.call::<()>(f)
                })?,
            )?;
        }

        lua.globals().set("vault", vault.clone())?;
        let _ = crate::lua::require::register_searcher(&lua);
        let _ = lua.globals().set("__loaded_externals", lua.create_table()?);

        if let Ok(package) = lua.globals().get::<mlua::Table>("package") {
            if let Ok(loaded) = package.get::<mlua::Table>("loaded") {
                let _ = loaded.set("vault", vault);
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
        lua.load(r#"vault.log.info("hello from lua")"#)
            .exec()
            .unwrap();
    }

    #[test]
    fn test_vault_fs() {
        let lua = LuaEngine::create_instance().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        let path_str = file_path.display().to_string();

        lua.globals().set("test_path", path_str.clone()).unwrap();
        lua.load(r#"vault.fs.write_file(test_path, "lua data")"#)
            .exec()
            .unwrap();

        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "lua data");

        let read_back: String = lua
            .load(r#"return vault.fs.read_file(test_path)"#)
            .eval()
            .unwrap();
        assert_eq!(read_back, "lua data");
    }

    #[test]
    fn test_vault_parsers() {
        let lua = LuaEngine::create_instance().unwrap();

        // JSON
        let _json_val: mlua::Value = lua
            .load(r#"return vault.json.parse('{"a": 1, "b": [true, null]}')"#)
            .eval()
            .unwrap();
        let json_str: String = lua
            .load(r#"return vault.json.stringify({x = 10, y = "abc"})"#)
            .eval()
            .unwrap();
        assert!(json_str.contains(r#""x":10"#));
        assert!(json_str.contains(r#""y":"abc""#));

        // TOML
        let _toml_val: mlua::Value = lua
            .load(r#"return vault.toml.parse('name = "vault"\nversion = 1')"#)
            .eval()
            .unwrap();
        let toml_str: String = lua
            .load(r#"return vault.toml.stringify({p = { q = 1 }})"#)
            .eval()
            .unwrap();
        assert!(toml_str.contains("q = 1"));
    }

    #[test]
    fn test_signals_multi_return_and_reactivity() {
        let lua = LuaEngine::create_instance().unwrap();
        // createSignal must return BOTH getter and setter (MultiValue, not Value).
        let doubled: i64 = lua
            .load(
                r#"
                local count, setCount = vault.createSignal(2)
                assert(type(count) == "function", "getter must be a function")
                assert(type(setCount) == "function", "setter must be a function (multi-return)")
                setCount(21)
                local d = vault.createMemo(function() return count() * 2 end)
                local seen = {}
                vault.createEffect(function() table.insert(seen, count()) end)
                setCount(22)
                vault.batch(function() setCount(23) setCount(24) end)
                assert(seen[#seen] == 24, "effect must re-run with latest value")
                return d()
                "#,
            )
            .eval()
            .unwrap();
        assert_eq!(doubled, 48);
    }

    #[test]
    fn test_vault_store_binding_exists() {
        let lua = LuaEngine::create_instance().unwrap();
        let has_store: bool = lua
            .load(r#"return vault.store ~= nil and type(vault.store.set) == "function""#)
            .eval()
            .unwrap();
        assert!(has_store);
    }

    #[test]
    fn test_vault_notification_show() {
        let lua = LuaEngine::create_instance().unwrap();
        lua.load(
            r#"vault.notification.show({
                severity = "success",
                title = "Hello",
                message = "World",
                actions = { { id = "a1", label = "View", command = "do_thing" } },
                persist = true,
            })"#,
        )
        .exec()
        .unwrap();
    }
}
