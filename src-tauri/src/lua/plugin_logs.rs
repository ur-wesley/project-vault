//! In-memory ring buffer for plugin log entries (`vault.log.*`).
//!
//! The frontend Log Console used to rely solely on live `plugin:log` Tauri
//! events. Anything emitted before the webview attached its listener (e.g.
//! startup `init` runs) or before a frontend reload was lost forever, so the
//! console looked permanently empty. Every log call now also lands here, and
//! the frontend hydrates via the `get_plugin_logs` command on mount.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

/// Mirror of the frontend cap (`plugin-log-store.ts` `MAX_LOGS`).
pub const MAX_PLUGIN_LOGS: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLogEntry {
    pub plugin_id: String,
    pub level: String,
    pub message: String,
    pub timestamp_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn buffer() -> &'static Mutex<VecDeque<PluginLogEntry>> {
    static BUFFER: OnceLock<Mutex<VecDeque<PluginLogEntry>>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_PLUGIN_LOGS + 8)))
}

/// Push one entry, evicting the oldest once the cap is exceeded.
/// Returns the stored entry (with timestamp) so callers can emit it.
pub fn push_log(plugin_id: &str, level: &str, message: &str) -> PluginLogEntry {
    let entry = PluginLogEntry {
        plugin_id: plugin_id.to_string(),
        level: level.to_string(),
        message: message.to_string(),
        timestamp_ms: now_ms(),
    };
    if let Ok(mut buf) = buffer().lock() {
        buf.push_back(entry.clone());
        while buf.len() > MAX_PLUGIN_LOGS {
            buf.pop_front();
        }
    }
    entry
}

/// Newest-last snapshot for `get_plugin_logs` hydration.
pub fn snapshot() -> Vec<PluginLogEntry> {
    buffer()
        .lock()
        .map(|buf| buf.iter().cloned().collect())
        .unwrap_or_default()
}

/// Best-effort Lua value → string coercion (mirrors Lua `tostring`).
/// `vault.log.info`/`error` accept any arg count/types and never raise.
pub fn stringify_value(lua: &mlua::Lua, value: mlua::Value) -> String {
    match value {
        mlua::Value::Nil => "nil".to_string(),
        mlua::Value::Boolean(b) => b.to_string(),
        mlua::Value::Integer(i) => i.to_string(),
        mlua::Value::Number(n) => {
            if n.is_finite() && n.fract() == 0.0 {
                // Avoid "3.0" for whole floats.
                format!("{}", n as i64)
            } else {
                n.to_string()
            }
        }
        mlua::Value::String(s) => s.to_string_lossy(),
        other => {
            // Honor __tostring metamethods via the real Lua `tostring`.
            if let Ok(tostring) = lua.globals().get::<mlua::Function>("tostring") {
                if let Ok(s) = tostring.call::<String>(other) {
                    return s;
                }
            }
            "<value>".to_string()
        }
    }
}

#[cfg(test)]
pub fn clear_for_tests() {
    if let Ok(mut buf) = buffer().lock() {
        buf.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot_roundtrip() {
        clear_for_tests();
        push_log("p1", "info", "hello");
        push_log("p2", "error", "boom");
        let all = snapshot();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].plugin_id, "p1");
        assert_eq!(all[0].level, "info");
        assert_eq!(all[0].message, "hello");
        assert_eq!(all[1].level, "error");
        assert!(all[1].timestamp_ms > 0);
    }

    #[test]
    fn buffer_evicts_oldest_beyond_cap() {
        clear_for_tests();
        for i in 0..(MAX_PLUGIN_LOGS + 50) {
            push_log("p", "info", &format!("msg-{i}"));
        }
        let all = snapshot();
        assert_eq!(all.len(), MAX_PLUGIN_LOGS);
        assert_eq!(all.first().unwrap().message, "msg-50");
        assert_eq!(all.last().unwrap().message, format!("msg-{}", MAX_PLUGIN_LOGS + 49));
    }

    #[test]
    fn stringify_covers_lua_types() {
        let lua = crate::lua::engine::LuaEngine::create_instance().unwrap();
        assert_eq!(stringify_value(&lua, mlua::Value::Nil), "nil");
        assert_eq!(
            stringify_value(&lua, mlua::Value::Boolean(true)),
            "true"
        );
        assert_eq!(
            stringify_value(&lua, mlua::Value::Integer(42)),
            "42"
        );
        // Whole floats render without a trailing ".0".
        assert_eq!(
            stringify_value(&lua, mlua::Value::Number(3.0)),
            "3"
        );
        // Tables fall back to Lua tostring ("table: 0x...").
        let tbl: mlua::Value = lua.load("return {}").eval().unwrap();
        assert!(stringify_value(&lua, tbl).starts_with("table:"));
    }
}
