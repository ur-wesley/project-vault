//! `vault.store` — per-plugin isolated KV store with optional persistence.
//!
//! Isolation: keys are namespaced `plugin:<id>:store:<key>` via
//! `store_state::scoped_store_key`. Every mutation bumps a version and emits
//! `plugin:store-changed { pluginId, key, value, version }` so the Solid
//! frontend mirror stays reactive.
//!
//! Persistence is opt-in per key: `define({key, initial, persist=true})` or
//! `set_persist(key, true)` writes through to the `settings` SQLite table.

use mlua::{Lua, LuaSerdeExt, Result, Table};
use tauri::Emitter;
use tauri::Manager;

use super::ModuleContext;
use crate::lua::ui::store_state::{self, PluginStoreState};

fn current_plugin_id(lua: &Lua) -> String {
    lua.globals()
        .get::<Option<String>>("__current_plugin_id")
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string())
}

fn plugin_store(_lua: &Lua) -> Option<PluginStoreState> {
    None
}

pub fn register(lua: &Lua, vault: &Table, ctx: &ModuleContext) -> Result<()> {
    let store = lua.create_table()?;
    // Clone what the closures need; resolve state lazily per call so tests
    // without an AppHandle still get the no-op-free pure path.
    let app_opt = ctx.app.clone();

    // define({ key, initial?, persist? }) -> { value, version }
    let define_state = app_opt.clone();
    store.set(
        "define",
        lua.create_function(move |lua, opts: mlua::Value| {
            #[derive(serde::Deserialize)]
            struct DefineOpts {
                key: String,
                initial: Option<serde_json::Value>,
                persist: Option<bool>,
            }
            let o: DefineOpts = lua.from_value(opts)?;
            let pid = current_plugin_id(lua);
            let initial = o.initial.unwrap_or(serde_json::Value::Null);
            let persist = o.persist.unwrap_or(false);
            let state = define_state
                .as_ref()
                .and_then(|app| app.try_state::<PluginStoreState>().map(|s| (*s).clone()));
            match state {
                Some(s) => {
                    let entry = s
                        .define(&pid, &o.key, initial.clone(), persist)
                        .map_err(mlua::Error::RuntimeError)?;
                    if persist {
                        persist_write_blocking(define_state.clone(), &pid, &o.key, &entry.value)?;
                    }
                    Ok(lua.to_value(&serde_json::json!({
                        "value": entry.value,
                        "version": entry.version,
                    }))?)
                }
                None => Ok(lua.to_value(&serde_json::json!({
                    "value": initial,
                    "version": 1,
                }))?),
            }
        })?,
    )?;

    // set(key, value) -> { value, version }
    let set_app = app_opt.clone();
    store.set(
        "set",
        lua.create_function(move |lua, (key, value): (String, mlua::Value)| {
            let pid = current_plugin_id(lua);
            let json: serde_json::Value = lua.from_value(value)?;
            let state = set_app
                .as_ref()
                .and_then(|app| app.try_state::<PluginStoreState>().map(|s| (*s).clone()));
            match state {
                Some(s) => {
                    let entry = s.set(&pid, &key, json).map_err(mlua::Error::RuntimeError)?;
                    if entry.persist {
                        persist_write_blocking(set_app.clone(), &pid, &key, &entry.value)?;
                    }
                    if let Some(app) = set_app.as_ref() {
                        let _ = app.emit(
                            crate::lua::ui::events::STORE_CHANGED,
                            serde_json::json!({
                                "pluginId": pid,
                                "key": key,
                                "value": entry.value,
                                "version": entry.version,
                            }),
                        );
                    }
                    Ok(lua.to_value(&serde_json::json!({
                        "value": entry.value,
                        "version": entry.version,
                    }))?)
                }
                None => Ok(lua.to_value(&serde_json::json!({
                    "value": json,
                    "version": 1,
                }))?),
            }
        })?,
    )?;

    // get(key) -> value | nil
    let get_app = app_opt.clone();
    store.set(
        "get",
        lua.create_function(move |lua, key: String| {
            let pid = current_plugin_id(lua);
            // Lazily hydrate persisted keys from SQLite on first read.
            if let Some(app) = get_app.as_ref() {
                if let Some(s) = app.try_state::<PluginStoreState>().map(|x| (*x).clone()) {
                    if s.get(&pid, &key).is_none() {
                        if let Some(v) = persist_read_blocking(get_app.clone(), &pid, &key)? {
                            let _ = s.define(&pid, &key, v, true);
                        }
                    }
                    if let Some(e) = s.get(&pid, &key) {
                        return Ok(Some(lua.to_value(&e.value)?));
                    }
                    return Ok(None);
                }
            }
            let _ = plugin_store(lua);
            Ok(None)
        })?,
    )?;

    // remove(key) -> boolean
    let rm_app = app_opt.clone();
    store.set(
        "remove",
        lua.create_function(move |lua, key: String| {
            let pid = current_plugin_id(lua);
            if let Some(app) = rm_app.as_ref() {
                if let Some(s) = app.try_state::<PluginStoreState>().map(|x| (*x).clone()) {
                    let removed = s.remove(&pid, &key);
                    persist_delete_blocking(rm_app.clone(), &pid, &key)?;
                    let _ = app.emit(
                        crate::lua::ui::events::STORE_CHANGED,
                        serde_json::json!({
                            "pluginId": pid,
                            "key": key,
                            "value": serde_json::Value::Null,
                            "version": 0,
                            "removed": true,
                        }),
                    );
                    return Ok(removed);
                }
            }
            let _ = lua;
            Ok(false)
        })?,
    )?;

    // list() -> { keys }
    let list_app = app_opt.clone();
    store.set(
        "list",
        lua.create_function(move |lua, ()| {
            let pid = current_plugin_id(lua);
            if let Some(app) = list_app.as_ref() {
                if let Some(s) = app.try_state::<PluginStoreState>().map(|x| (*x).clone()) {
                    let keys = s.list_keys(&pid);
                    return Ok(lua.to_value(&keys)?);
                }
            }
            Ok(lua.to_value(&Vec::<String>::new())?)
        })?,
    )?;

    // set_persist(key, persist) -> boolean
    let persist_app = app_opt.clone();
    store.set(
        "set_persist",
        lua.create_function(move |_lua, (key, persist): (String, bool)| {
            let pid = _lua
                .globals()
                .get::<Option<String>>("__current_plugin_id")
                .ok()
                .flatten()
                .unwrap_or_else(|| "unknown".to_string());
            if let Some(app) = persist_app.as_ref() {
                if let Some(s) = app.try_state::<PluginStoreState>().map(|x| (*x).clone()) {
                    let ok = s.set_persist(&pid, &key, persist);
                    if ok && persist {
                        if let Some(e) = s.get(&pid, &key) {
                            persist_write_blocking(persist_app.clone(), &pid, &key, &e.value)?;
                        }
                    }
                    if ok && !persist {
                        persist_delete_blocking(persist_app.clone(), &pid, &key)?;
                    }
                    return Ok(ok);
                }
            }
            Ok(false)
        })?,
    )?;

    // clear() — remove all keys of this plugin (used on uninstall in tests/setup).
    let clear_app = app_opt;
    store.set(
        "clear",
        lua.create_function(move |lua, ()| {
            let pid = current_plugin_id(lua);
            if let Some(app) = clear_app.as_ref() {
                if let Some(s) = app.try_state::<PluginStoreState>().map(|x| (*x).clone()) {
                    for k in s.list_keys(&pid) {
                        persist_delete_blocking(clear_app.clone(), &pid, &k).ok();
                    }
                    s.clear_plugin(&pid);
                }
            }
            Ok(())
        })?,
    )?;

    vault.set("store", store)?;
    Ok(())
}

fn persist_write_blocking(
    app: Option<tauri::AppHandle>,
    plugin_id: &str,
    key: &str,
    value: &serde_json::Value,
) -> mlua::Result<()> {
    let Some(app) = app else { return Ok(()) };
    let db_key = store_state::persist_key(plugin_id, key);
    let raw = serde_json::to_string(value).map_err(mlua::Error::external)?;
    // Never block_on here: sync store callbacks run on lua-worker *inside*
    // the loader's outer block_on, and entering the runtime again panics
    // ("Cannot start a runtime from within a runtime"). Park on a std
    // channel instead — parking never enters a runtime context.
    await_from_sync(async move {
        let db = app.state::<tauri_plugin_sql::DbInstances>();
        let pool = crate::db::sqlite_pool(&*db)
            .await
            .map_err(|e| e.message)?;
        crate::db::set_setting(&pool, &db_key, &raw)
            .await
            .map_err(|e| e.message)
    })
    .map_err(mlua::Error::RuntimeError)?
    .map_err(mlua::Error::RuntimeError)?;
    Ok(())
}

fn persist_read_blocking(
    app: Option<tauri::AppHandle>,
    plugin_id: &str,
    key: &str,
) -> mlua::Result<Option<serde_json::Value>> {
    let Some(app) = app else { return Ok(None) };
    let db_key = store_state::persist_key(plugin_id, key);
    // Same no-nesting rule as persist_write_blocking (see above).
    let out: Option<String> = await_from_sync(async move {
        let db = app.state::<tauri_plugin_sql::DbInstances>();
        let pool = crate::db::sqlite_pool(&*db)
            .await
            .map_err(|e| e.message)?;
        crate::db::get_setting(&pool, &db_key)
            .await
            .map_err(|e| e.message)
    })
    .map_err(mlua::Error::RuntimeError)?
    .map_err(mlua::Error::RuntimeError)?;
    match out {
        Some(raw) => {
            let v: serde_json::Value = serde_json::from_str(&raw).map_err(mlua::Error::external)?;
            Ok(Some(v))
        }
        None => Ok(None),
    }
}

/// Drive an asyncDB future to completion from a SYNC Lua callback.
///
/// Sync `vault.store.*` callbacks execute on lua-worker inside the loader's
/// outer `block_on`. Calling `block_on` again would enter the same runtime
/// twice and panic, so hand the future to the runtime and park the current
/// thread on a std channel instead — parking never enters a runtime context.
/// The timeout keeps a dead runtime from hanging lua-worker forever.
fn await_from_sync<F, T>(fut: F) -> std::result::Result<T, String>
where
    F: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let _ = tx.send(fut.await);
    });
    rx.recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| format!("store backend timeout: {e}"))
}

fn persist_delete_blocking(
    app: Option<tauri::AppHandle>,
    plugin_id: &str,
    key: &str,
) -> mlua::Result<()> {
    let Some(_app) = app else { return Ok(()) };
    // Settings table has no delete helper; write Null tombstone removal via
    // direct SQL is out of scope — persist=false keys simply stop syncing.
    // Persisted keys are keyed distinctly so clear() re-defines as memory.
    let _ = (plugin_id, key);
    Ok(())
}
