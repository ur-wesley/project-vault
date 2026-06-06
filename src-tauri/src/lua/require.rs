use std::path::{Path, PathBuf};

use mlua::{Lua, Result, Value};

use crate::error::StableError;

pub fn register_searcher(lua: &Lua) -> Result<()> {
    let package: mlua::Table = lua.globals().get("package")?;
    let searchers: mlua::Table = package.get("searchers")?;

    let searcher = lua.create_function(|lua, module_name: String| {
        resolve_module(lua, &module_name)
    })?;

    let len: i32 = searchers.len()?.try_into().unwrap_or(0);
    searchers.raw_set(len + 1, searcher)?;
    Ok(())
}

pub fn resolve_module(lua: &Lua, module_name: &str) -> Result<Value> {
    if module_name == "vault" {
        return lua.globals().get("vault");
    }

    if let Some(id) = module_name.strip_prefix("@plugin/").or(module_name.strip_prefix("plugin:")) {
        return load_plugin_exports(lua, id);
    }

    if let Some(id) = module_name.strip_prefix("@external/").or(module_name.strip_prefix("external:"))
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

    let content = std::fs::read_to_string(path).map_err(|e| {
        mlua::Error::RuntimeError(format!("read {}: {}", path.display(), e))
    })?;
    let chunk = format!("@{}", path.display());
    let val: Value = lua.load(&content).set_name(chunk).eval()?;
    loaded.set(cache_key.as_str(), val.clone())?;
    Ok(val)
}

fn load_plugin_exports(lua: &Lua, plugin_id: &str) -> Result<Value> {
    let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins")?;
    let plugin_table: mlua::Table = loaded_tbl.get(plugin_id).map_err(|_| {
        mlua::Error::RuntimeError(format!("plugin '{}' is not loaded", plugin_id))
    })?;
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

    let externals_loaded: mlua::Table = lua
        .globals()
        .get("__loaded_externals")
        .unwrap_or_else(|_| {
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
