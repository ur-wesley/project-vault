use std::path::{Path, PathBuf};

use mlua::{Lua, Result, Value};

use crate::error::StableError;

pub fn register_searcher(lua: &Lua) -> Result<()> {
    let package: mlua::Table = lua.globals().get("package")?;
    // Under Luau, mlua serves `require` from `package.loaders` (mirrored in
    // the `_LOADERS` registry); `package.searchers` only exists on PUC Lua.
    // Targeting `searchers` unconditionally meant this whole module silently
    // never ran under Luau, so every relative `require("./x")` failed with
    // "module not found" and every multi-file plugin was dead on arrival.
    let loaders: mlua::Table = package
        .get("loaders")
        .or_else(|_| package.get("searchers"))?;
    // lua_require protocol: a loader must return a LOADER FUNCTION (invoked
    // with the module name) or an error STRING — never the module itself.
    // Resolution stays lazy (at call time) so `__current_plugin_root`
    // always reflects the plugin being executed.
    let loader = lua.create_function(|lua, module_name: String| -> Result<Value> {
        let name = module_name.clone();
        let inner = lua.create_function(move |lua, _args: mlua::MultiValue| {
            resolve_module(lua, &name)
        })?;
        Ok(Value::Function(inner))
    })?;

    let len: i32 = loaders.len()?.try_into().unwrap_or(0);
    loaders.raw_set(len + 1, loader)?;
    Ok(())
}

/// Drop relative (`./`, `../`) entries from `package.loaded` (`_LOADED`).
///
/// lua_require caches modules under the raw required name, so two plugins
/// requiring `./settings` would otherwise share whichever module loaded
/// first. Call on every plugin switch (after pointing
/// `__current_plugin_root` at the incoming plugin): re-resolution is cheap
/// because file contents stay cached under their absolute `@file:` keys.
pub fn clear_relative_loaded(lua: &Lua) -> Result<()> {
    let package: mlua::Table = lua.globals().get("package")?;
    let loaded: mlua::Table = package.get("loaded")?;
    let mut drop_keys: Vec<String> = Vec::new();
    for pair in loaded.pairs::<String, Value>() {
        if let Ok((key, _)) = pair {
            if key.starts_with("./") || key.starts_with("../") {
                drop_keys.push(key);
            }
        }
    }
    for key in &drop_keys {
        loaded.set(key.as_str(), Value::Nil)?;
    }
    Ok(())
}

pub fn resolve_module(lua: &Lua, module_name: &str) -> Result<Value> {
    if module_name == "vault" {
        return lua.globals().get("vault");
    }

    if let Some(id) = module_name
        .strip_prefix("@plugin/")
        .or(module_name.strip_prefix("plugin:"))
    {
        return load_plugin_exports(lua, id);
    }

    if let Some(id) = module_name
        .strip_prefix("@external/")
        .or(module_name.strip_prefix("external:"))
    {
        return load_external_module(lua, id);
    }

    if let Ok(root) = lua.globals().get::<String>("__current_plugin_root") {
        if let Some(path) = resolve_local_module(&root, module_name) {
            return load_file_module(lua, &path);
        }
    }

    Err(mlua::Error::RuntimeError(format!(
        "module '{}' not found",
        module_name
    )))
}

fn resolve_local_module(plugin_root: &str, module_name: &str) -> Option<PathBuf> {
    let root = Path::new(plugin_root);
    let rel = module_name
        .strip_prefix("./")
        .or_else(|| module_name.strip_prefix("lib/"))
        .unwrap_or(module_name);

    let candidates = [
        root.join(format!("{}.luau", rel)),
        root.join(rel).join("init.luau"),
        root.join("lib").join(format!("{}.luau", rel)),
        root.join("lib").join(rel).join("init.luau"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

pub fn load_file_module(lua: &Lua, path: &Path) -> Result<Value> {
    let cache_key = format!("@file:{}", path.display());
    let package: mlua::Table = lua.globals().get("package")?;
    let loaded: mlua::Table = package.get("loaded")?;
    if let Ok(cached) = loaded.get::<Value>(cache_key.as_str()) {
        if !matches!(cached, Value::Nil) {
            return Ok(cached);
        }
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| mlua::Error::RuntimeError(format!("read {}: {}", path.display(), e)))?;
    let chunk = format!("@{}", path.display());
    let val: Value = lua.load(&content).set_name(chunk).eval()?;
    loaded.set(cache_key.as_str(), val.clone())?;
    Ok(val)
}

fn load_plugin_exports(lua: &Lua, plugin_id: &str) -> Result<Value> {
    let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins")?;
    let plugin_table: mlua::Table = loaded_tbl
        .get(plugin_id)
        .map_err(|_| mlua::Error::RuntimeError(format!("plugin '{}' is not loaded", plugin_id)))?;
    plugin_table.get("exports").or_else(|_| {
        Err(mlua::Error::RuntimeError(format!(
            "plugin '{}' does not export a table",
            plugin_id
        )))
    })
}

fn load_external_module(lua: &Lua, external_id: &str) -> Result<Value> {
    let cache_key = format!("@external/{}", external_id);
    let package: mlua::Table = lua.globals().get("package")?;
    let loaded: mlua::Table = package.get("loaded")?;
    if let Ok(cached) = loaded.get::<Value>(cache_key.as_str()) {
        if !matches!(cached, Value::Nil) {
            return Ok(cached);
        }
    }

    let externals_loaded: mlua::Table = lua
        .globals()
        .get("__loaded_externals")
        .unwrap_or_else(|_| lua.create_table().expect("table"));

    if let Ok(cached) = externals_loaded.get::<Value>(external_id) {
        if !matches!(cached, Value::Nil) {
            loaded.set(cache_key.as_str(), cached.clone())?;
            return Ok(cached);
        }
    }

    Err(mlua::Error::RuntimeError(format!(
        "external '{}' is not loaded; use vault.external.require",
        external_id
    )))
}

pub fn cache_external_module(lua: &Lua, external_id: &str, module: Value) -> Result<()> {
    let cache_key = format!("@external/{}", external_id);
    let package: mlua::Table = lua.globals().get("package")?;
    let loaded: mlua::Table = package.get("loaded")?;
    loaded.set(cache_key.as_str(), module.clone())?;

    let externals_loaded: mlua::Table =
        lua.globals().get("__loaded_externals").unwrap_or_else(|_| {
            let t = lua.create_table().expect("table");
            lua.globals().set("__loaded_externals", t.clone()).ok();
            t
        });
    externals_loaded.set(external_id, module)?;
    Ok(())
}

pub fn invalidate_plugin_modules(lua: &Lua, plugin_id: &str, plugin_root: &Path) -> Result<()> {
    let package: mlua::Table = lua.globals().get("package")?;
    let loaded: mlua::Table = package.get("loaded")?;
    let prefix = format!("@file:{}", plugin_root.display());
    for pair in loaded.pairs::<String, Value>() {
        if let Ok((key, _)) = pair {
            if key.starts_with(&prefix) || key == format!("@plugin/{}", plugin_id) {
                loaded.set(key, Value::Nil)?;
            }
        }
    }
    Ok(())
}

pub fn stable_error_message(err: &StableError) -> String {
    err.message.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lua::engine::LuaEngine;

    fn state_with_root(root: &Path) -> Lua {
        let lua = LuaEngine::create_instance().expect("lua state");
        lua.globals()
            .set("__current_plugin_root", root.to_string_lossy().to_string())
            .expect("set root");
        lua
    }

    fn write_plugin(dir: &Path, name: &str, body: &str) {
        std::fs::create_dir_all(dir).expect("mkdir");
        std::fs::write(dir.join(format!("{name}.luau")), body).expect("write");
    }

    #[test]
    fn loader_is_registered_in_package_loaders() {
        let lua = LuaEngine::create_instance().expect("lua state");
        let package: mlua::Table = lua.globals().get("package").expect("package");
        let loaders: mlua::Table = package.get("loaders").expect("loaders table");
        let before: i32 = loaders.len().expect("len") as i32;
        register_searcher(&lua).expect("register");
        let after: i32 = loaders.len().expect("len") as i32;
        assert_eq!(after, before + 1, "custom loader must be appended");
    }

    #[test]
    fn relative_require_resolves_against_plugin_root() {
        let dir = std::env::temp_dir().join("pv-req-test-a");
        write_plugin(&dir, "helper", "return { answer = 42 }");
        let lua = state_with_root(&dir);
        register_searcher(&lua).expect("register");
        let v: Value = lua.load(r#"return require("./helper")"#).eval().expect("require");
        let t = v.as_table().cloned().expect("module table");
        let answer: i64 = t.get("answer").expect("answer field");
        assert_eq!(answer, 42);
    }

    #[test]
    fn missing_relative_require_errors() {
        let dir = std::env::temp_dir().join("pv-req-test-b");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let lua = state_with_root(&dir);
        register_searcher(&lua).expect("register");
        let err = lua
            .load(r#"return require("./does_not_exist")"#)
            .eval::<Value>()
            .expect_err("must fail");
        assert!(
            err.to_string().contains("does_not_exist"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn clear_relative_loaded_drops_only_relative_keys() {
        let lua = LuaEngine::create_instance().expect("lua state");
        let package: mlua::Table = lua.globals().get("package").expect("package");
        let loaded: mlua::Table = package.get("loaded").expect("loaded");
        loaded.set("./settings", "pg").expect("set");
        loaded.set("../shared", "x").expect("set");
        loaded.set("other", "y").expect("set");
        loaded.set("@file:/abs/mod.luau", "z").expect("set");
        clear_relative_loaded(&lua).expect("clear");
        assert!(matches!(
            loaded.get::<Value>("./settings"),
            Ok(Value::Nil)
        ));
        assert!(matches!(
            loaded.get::<Value>("../shared"),
            Ok(Value::Nil)
        ));
        assert_eq!(
            loaded.get::<String>("other").expect("other stays"),
            "y"
        );
        assert_eq!(
            loaded
                .get::<String>("@file:/abs/mod.luau")
                .expect("abs stays"),
            "z"
        );
    }
}
