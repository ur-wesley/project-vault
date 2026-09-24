use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::clusters::*;
use super::records::*;

pub const SUPPORTED_VERSIONS: &[&str] = &["13", "14", "15", "16", "17", "18"];

/// Pinned EDB minor releases used for portable-binary downloads.
pub(crate) fn pinned_minor(major: &str) -> Option<&'static str> {
    match major {
        "13" => Some("13.16-1"),
        "14" => Some("14.13-1"),
        "15" => Some("15.8-1"),
        "16" => Some("16.4-1"),
        "17" => Some("17.2-1"),
        "18" => Some("18.0-1"),
        _ => None,
    }
}

/// Default dev port per major version (5432 + offset, avoids system postgres).
pub fn default_port(major: &str) -> u16 {
    let offset: u16 = match major {
        "13" => 1,
        "14" => 2,
        "15" => 3,
        "16" => 4,
        "17" => 5,
        "18" => 6,
        _ => 9,
    };
    5432 + offset
}

// ─── Settings (auto port pool, defaults) ──────────────────────────────────

/// Persisted plugin settings for port handling + defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSettings {
    #[serde(default = "default_true")]
    pub auto_port: bool,
    #[serde(default = "default_range_start")]
    pub port_range_start: u16,
    #[serde(default = "default_range_end")]
    pub port_range_end: u16,
    #[serde(default = "default_version")]
    pub default_version: String,
    #[serde(default = "default_backend")]
    pub default_backend: String,
}

pub(crate) fn default_true() -> bool {
    true
}
pub(crate) fn default_range_start() -> u16 {
    5433
}
pub(crate) fn default_range_end() -> u16 {
    5499
}
pub(crate) fn default_version() -> String {
    "16".to_string()
}
pub(crate) fn default_backend() -> String {
    "portable".to_string()
}

impl Default for PgSettings {
    fn default() -> Self {
        Self {
            auto_port: true,
            port_range_start: 5433,
            port_range_end: 5499,
            default_version: "16".to_string(),
            default_backend: "portable".to_string(),
        }
    }
}

pub(crate) fn settings_file(app_data: &Path) -> PathBuf {
    base_dir(app_data).join("settings.json")
}

pub fn load_settings(app_data: &Path) -> PgSettings {
    let raw = std::fs::read_to_string(settings_file(app_data)).unwrap_or_default();
    if raw.trim().is_empty() {
        return PgSettings::default();
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save_settings(app_data: &Path, s: &PgSettings) -> Result<(), String> {
    std::fs::create_dir_all(base_dir(app_data)).map_err(|e| format!("mkdir postgres: {e}"))?;
    std::fs::write(
        settings_file(app_data),
        serde_json::to_string_pretty(s).unwrap_or_default(),
    )
    .map_err(|e| format!("write settings: {e}"))
}

// ─── Port handling (multi-cluster safe) ───────────────────────────────────

/// All ports currently reserved by managed clusters + saved externals.
pub fn used_ports(app_data: &Path) -> Vec<u16> {
    let mut out: Vec<u16> = list_records(app_data).iter().map(|r| r.port).collect();
    for c in read_connections(app_data) {
        out.push(c.port);
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// True when no local TCP listener is bound on 127.0.0.1:port.
pub fn is_os_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(format!("127.0.0.1:{port}")).is_ok()
}

/// Allocate a free port: skips reserved + OS-bound ports, stays in range.
pub fn alloc_free_port(app_data: &Path, preferred: u16) -> u16 {
    let settings = load_settings(app_data);
    let reserved = used_ports(app_data);
    let lo = settings.port_range_start.max(1024);
    let hi = settings.port_range_end.max(lo);
    // Try preferred first, then scan forward in range, then fall back to OS probe.
    let mut candidates: Vec<u16> = Vec::new();
    if preferred != 0 {
        candidates.push(preferred);
    }
    for p in lo..=hi {
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    }
    for p in candidates {
        if reserved.contains(&p) {
            continue;
        }
        if is_os_port_free(p) {
            return p;
        }
    }
    // Last resort: OS probe above the range.
    let mut p = hi.saturating_add(1);
    for _ in 0..500 {
        if !reserved.contains(&p) && is_os_port_free(p) {
            return p;
        }
        p = p.saturating_add(1);
    }
    preferred
}

/// Validate an explicit port request; on conflict suggest a free one.
pub fn validate_explicit_port(app_data: &Path, port: u16) -> Result<u16, String> {
    if port < 1024 {
        let suggest = alloc_free_port(app_data, default_port("16"));
        return Err(format!(
            "port {port} out of range (1024-65535) — try {suggest}"
        ));
    }
    let reserved = used_ports(app_data);
    if reserved.contains(&port) {
        let owner = list_records(app_data)
            .into_iter()
            .find(|r| r.port == port)
            .map(|r| format!("cluster '{}'", r.name))
            .or_else(|| {
                read_connections(app_data)
                    .into_iter()
                    .find(|c| c.port == port)
                    .map(|c| format!("connection '{}'", c.name))
            })
            .unwrap_or_else(|| "another instance".to_string());
        let suggest = alloc_free_port(app_data, port.saturating_add(1));
        return Err(format!(
            "port {port} already used by {owner} — try {suggest}"
        ));
    }
    if !is_os_port_free(port) {
        let suggest = alloc_free_port(app_data, port.saturating_add(1));
        return Err(format!(
            "port {port} is occupied by another process — try {suggest}"
        ));
    }
    Ok(port)
}

pub fn port_status(app_data: &Path) -> serde_json::Value {
    serde_json::json!({
        "used": used_ports(app_data),
        "settings": load_settings(app_data),
    })
}

pub async fn set_cluster_port(
    app_data: &Path,
    name: &str,
    port: Option<u16>,
) -> Result<ClusterStatus, String> {
    let mut rec = read_record(app_data, name)?;
    if rec.backend() == "docker" {
        return Err("port is managed via docker mapping — destroy + recreate to change it".to_string());
    }
    if cluster_status(app_data, &rec.name)?.running {
        return Err(format!(
            "stop cluster '{}' before changing its port",
            rec.name
        ));
    }
    let new_port = match port {
        None | Some(0) => alloc_free_port(app_data, rec.port),
        Some(p) if p == rec.port => return cluster_status(app_data, &rec.name),
        Some(p) => {
            // Allow keeping our own port out of the reserved set for the check.
            let mut reserved = used_ports(app_data);
            reserved.retain(|x| *x != rec.port);
            if reserved.contains(&p) {
                let suggest = alloc_free_port(app_data, p.saturating_add(1));
                return Err(format!("port {p} already reserved — try {suggest}"));
            }
            if !is_os_port_free(p) {
                let suggest = alloc_free_port(app_data, p.saturating_add(1));
                return Err(format!("port {p} occupied — try {suggest}"));
            }
            p
        }
    };
    rec.port = new_port;
    write_record(app_data, &rec)?;
    patch_postgresql_conf_port(&rec.data_dir, new_port)?;
    cluster_status(app_data, &rec.name)
}

pub(crate) fn write_record(app_data: &Path, rec: &ClusterRecord) -> Result<(), String> {
    std::fs::write(
        cluster_file(app_data, &rec.name),
        serde_json::to_string_pretty(rec).unwrap_or_default(),
    )
    .map_err(|e| format!("write cluster record: {e}"))
}

/// Update `port = N` inside postgresql.conf (best-effort, portable only).
pub(crate) fn patch_postgresql_conf_port(data_dir: &str, port: u16) -> Result<(), String> {
    let conf = PathBuf::from(data_dir).join("postgresql.conf");
    if !conf.is_file() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(&conf).unwrap_or_default();
    let mut out = String::new();
    let mut done = false;
    for line in raw.lines() {
        let t = line.trim_start();
        if !done && (t.starts_with("port") && t.contains('=')) && !t.starts_with('#') {
            out.push_str(&format!("port = {port}"));
            out.push('\n');
            done = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !done {
        out.push_str(&format!("port = {port}\n"));
    }
    std::fs::write(&conf, out).map_err(|e| format!("patch postgresql.conf: {e}"))?;
    Ok(())
}

/// Ensure `shared_preload_libraries` contains the given libs (portable only).
pub(crate) fn ensure_shared_preload(data_dir: &str, libs: &[String]) -> Result<bool, String> {
    if libs.is_empty() {
        return Ok(false);
    }
    let conf = PathBuf::from(data_dir).join("postgresql.conf");
    if !conf.is_file() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&conf).unwrap_or_default();
    // Collect existing libs.
    let mut existing: Vec<String> = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with("shared_preload_libraries") && t.contains('=') {
            let v = t.splitn(2, '=').nth(1).unwrap_or("").trim().trim_matches('\'').trim_matches('"');
            for part in v.split(',') {
                let p = part.trim().trim_matches('\'').trim_matches('"').to_string();
                if !p.is_empty() {
                    existing.push(p);
                }
            }
        }
    }
    let mut changed = false;
    for lib in libs {
        if !existing.iter().any(|e| e == lib) {
            existing.push(lib.clone());
            changed = true;
        }
    }
    if !changed {
        return Ok(false);
    }
    let joined = existing.join(",");
    let mut out = String::new();
    let mut done = false;
    for line in raw.lines() {
        let t = line.trim_start();
        if !done && t.starts_with("shared_preload_libraries") {
            out.push_str(&format!("shared_preload_libraries = '{joined}'"));
            out.push('\n');
            done = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !done {
        out.push_str(&format!("shared_preload_libraries = '{joined}'\n"));
    }
    std::fs::write(&conf, out).map_err(|e| format!("patch shared_preload: {e}"))?;
    Ok(true)
}

pub fn base_dir(app_data: &Path) -> PathBuf {
    app_data.join("postgres")
}

pub fn versions_dir(app_data: &Path) -> PathBuf {
    base_dir(app_data).join("versions")
}

pub fn clusters_dir(app_data: &Path) -> PathBuf {
    base_dir(app_data).join("clusters")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_allocator_skips_reserved() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path();
        add_connection(app, "ext1", "127.0.0.1", 5433, "postgres", "postgres").unwrap();
        let p = alloc_free_port(app, 5433);
        assert_ne!(p, 5433);
        assert!(validate_explicit_port(app, 5433).is_err());
    }

}
