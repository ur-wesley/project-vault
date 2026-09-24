//! Per-plugin reactive store state (memory core + optional persistence helpers).
//!
//! Isolation rule: every key is namespaced `plugin:<plugin_id>:<key>` before
//! touching memory or SQLite. Cross-plugin reads are impossible by construction.
//!
//! The in-memory map is the reactive source of truth (version counter per key).
//! Persistence is opt-in per key (`persist=true`): write-through to the
//! `settings` table via `db::get_setting` / `db::set_setting`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::types::{MAX_STORE_KEYS_PER_PLUGIN, MAX_STORE_VALUE_BYTES};

#[derive(Debug, Clone, PartialEq)]
pub struct StoreEntry {
    pub value: serde_json::Value,
    pub version: u64,
    pub persist: bool,
}

impl StoreEntry {
    pub fn new(value: serde_json::Value, persist: bool) -> Self {
        Self {
            value,
            version: 1,
            persist,
        }
    }
}

/// Namespaced key: `plugin:<plugin_id>:store:<key>`.
pub fn scoped_store_key(plugin_id: &str, key: &str) -> String {
    format!("plugin:{plugin_id}:store:{key}")
}

/// SQLite persistence key (distinct from settings keys).
pub fn persist_key(plugin_id: &str, key: &str) -> String {
    scoped_store_key(plugin_id, key)
}

pub fn validate_store_key(key: &str) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() {
        return Err("store key must not be empty".into());
    }
    if k.len() > 256 {
        return Err("store key too long (max 256 chars)".into());
    }
    if k.starts_with("__") {
        return Err("store key must not start with __".into());
    }
    Ok(())
}

pub fn validate_store_value(value: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_string(value)
        .map_err(|e| e.to_string())?
        .len();
    if bytes > MAX_STORE_VALUE_BYTES {
        return Err(format!(
            "store value too large ({bytes} bytes, max {MAX_STORE_VALUE_BYTES})"
        ));
    }
    Ok(())
}

#[derive(Clone, Default)]
pub struct PluginStoreState {
    inner: Arc<Mutex<HashMap<String, StoreEntry>>>,
}

impl PluginStoreState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn define(
        &self,
        plugin_id: &str,
        key: &str,
        initial: serde_json::Value,
        persist: bool,
    ) -> Result<StoreEntry, String> {
        validate_store_key(key)?;
        validate_store_value(&initial)?;
        let scoped = scoped_store_key(plugin_id, key);
        let mut guard = self.inner.lock().unwrap();
        if let Some(existing) = guard.get(&scoped) {
            return Ok(existing.clone());
        }
        if self.plugin_key_count_locked(plugin_id, &guard) >= MAX_STORE_KEYS_PER_PLUGIN {
            return Err(format!(
                "too many store keys (max {MAX_STORE_KEYS_PER_PLUGIN})"
            ));
        }
        let entry = StoreEntry::new(initial, persist);
        guard.insert(scoped, entry.clone());
        Ok(entry)
    }

    pub fn set(
        &self,
        plugin_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> Result<StoreEntry, String> {
        validate_store_key(key)?;
        validate_store_value(&value)?;
        let scoped = scoped_store_key(plugin_id, key);
        let mut guard = self.inner.lock().unwrap();
        if !guard.contains_key(&scoped)
            && self.plugin_key_count_locked(plugin_id, &guard) >= MAX_STORE_KEYS_PER_PLUGIN
        {
            return Err(format!(
                "too many store keys (max {MAX_STORE_KEYS_PER_PLUGIN})"
            ));
        }
        let version = guard.get(&scoped).map(|e| e.version + 1).unwrap_or(1);
        let persist = guard.get(&scoped).map(|e| e.persist).unwrap_or(false);
        let entry = StoreEntry {
            value,
            version,
            persist,
        };
        guard.insert(scoped, entry.clone());
        Ok(entry)
    }

    pub fn get(&self, plugin_id: &str, key: &str) -> Option<StoreEntry> {
        let scoped = scoped_store_key(plugin_id, key);
        self.inner.lock().unwrap().get(&scoped).cloned()
    }

    pub fn remove(&self, plugin_id: &str, key: &str) -> bool {
        let scoped = scoped_store_key(plugin_id, key);
        self.inner.lock().unwrap().remove(&scoped).is_some()
    }

    pub fn set_persist(&self, plugin_id: &str, key: &str, persist: bool) -> bool {
        let scoped = scoped_store_key(plugin_id, key);
        let mut guard = self.inner.lock().unwrap();
        if let Some(e) = guard.get_mut(&scoped) {
            e.persist = persist;
            return true;
        }
        false
    }

    pub fn clear_plugin(&self, plugin_id: &str) {
        let prefix = format!("plugin:{plugin_id}:store:");
        self.inner
            .lock()
            .unwrap()
            .retain(|k, _| !k.starts_with(&prefix));
    }

    pub fn list_keys(&self, plugin_id: &str) -> Vec<String> {
        let prefix = format!("plugin:{plugin_id}:store:");
        self.inner
            .lock()
            .unwrap()
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix).map(|s| s.to_string()))
            .collect()
    }

    fn plugin_key_count_locked(
        &self,
        plugin_id: &str,
        guard: &HashMap<String, StoreEntry>,
    ) -> usize {
        let prefix = format!("plugin:{plugin_id}:store:");
        guard.keys().filter(|k| k.starts_with(&prefix)).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scoped_keys_are_isolated() {
        assert_eq!(scoped_store_key("a", "k"), "plugin:a:store:k");
        assert_ne!(scoped_store_key("a", "k"), scoped_store_key("b", "k"));
    }

    #[test]
    fn rejects_bad_keys() {
        assert!(validate_store_key("").is_err());
        assert!(validate_store_key("  ").is_err());
        assert!(validate_store_key("__internal").is_err());
        assert!(validate_store_key("ok/key-1").is_ok());
    }

    #[test]
    fn set_get_versioning() {
        let s = PluginStoreState::new();
        let e1 = s.set("p1", "count", json!(1)).unwrap();
        assert_eq!(e1.version, 1);
        let e2 = s.set("p1", "count", json!(2)).unwrap();
        assert_eq!(e2.version, 2);
        assert_eq!(s.get("p1", "count").unwrap().value, json!(2));
        // other plugin cannot see it
        assert!(s.get("p2", "count").is_none());
    }

    #[test]
    fn define_is_idempotent_and_respects_persist() {
        let s = PluginStoreState::new();
        let a = s.define("p", "k", json!({"n": 1}), true).unwrap();
        assert!(a.persist);
        let b = s.define("p", "k", json!({"n": 2}), false).unwrap();
        assert_eq!(b.value, json!({"n": 1}), "define must not overwrite");
        assert!(b.persist, "original persist flag wins");
    }

    #[test]
    fn remove_and_clear_plugin() {
        let s = PluginStoreState::new();
        s.set("p", "a", json!(1)).unwrap();
        s.set("p", "b", json!(2)).unwrap();
        s.set("other", "a", json!(9)).unwrap();
        assert!(s.remove("p", "a"));
        assert!(s.get("p", "a").is_none());
        s.clear_plugin("p");
        assert!(s.get("p", "b").is_none());
        assert!(s.get("other", "a").is_some());
    }

    #[test]
    fn rejects_oversize_value() {
        let s = PluginStoreState::new();
        let big = "x".repeat(MAX_STORE_VALUE_BYTES + 1);
        assert!(s.set("p", "big", json!(big)).is_err());
    }
}
