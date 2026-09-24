use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::settings::*;
use super::versions::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub installed: bool,
    pub path: Option<String>,
    pub bin_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterRecord {
    pub name: String,
    pub version: String,
    pub port: u16,
    pub data_dir: String,
    pub created_at_ms: i64,
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
}

impl ClusterRecord {
    pub fn backend(&self) -> &str {
        if self.backend.trim().is_empty() {
            "portable"
        } else {
            self.backend.as_str()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterStatus {
    pub name: String,
    pub version: String,
    pub port: u16,
    pub running: bool,
    pub pid: Option<u32>,
    pub data_dir: String,
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    pub truncated: bool,
}

/// Externally-managed Postgres instance (system service, Docker, remote dev).
/// The password is never persisted — callers pass it per query (memory-only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub created_at_ms: i64,
}

/// Unified query target: `cluster:<name>` (managed) or `ext:<id>` (external).
pub enum Target<'a> {
    Cluster(ClusterRecord),
    External(ExternalConnection, &'a str),
}

pub(crate) fn connections_file(app_data: &Path) -> PathBuf {
    base_dir(app_data).join("connections.json")
}

pub(crate) fn read_connections(app_data: &Path) -> Vec<ExternalConnection> {
    let raw = std::fs::read_to_string(connections_file(app_data)).unwrap_or_default();
    if raw.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

pub(crate) fn write_connections(app_data: &Path, list: &[ExternalConnection]) -> Result<(), String> {
    std::fs::create_dir_all(base_dir(app_data)).map_err(|e| format!("mkdir postgres: {e}"))?;
    std::fs::write(
        connections_file(app_data),
        serde_json::to_string_pretty(list).unwrap_or_default(),
    )
    .map_err(|e| format!("write connections: {e}"))
}

pub fn list_connections(app_data: &Path) -> Vec<ExternalConnection> {
    let mut list = read_connections(app_data);
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

pub fn add_connection(
    app_data: &Path,
    name: &str,
    host: &str,
    port: u16,
    database: &str,
    user: &str,
) -> Result<ExternalConnection, String> {
    let id = sanitize_name(name)?;
    let host = host.trim();
    if host.is_empty() {
        return Err("host must not be empty".to_string());
    }
    if port == 0 {
        return Err("port must be 1-65535".to_string());
    }
    let mut list = read_connections(app_data);
    if list.iter().any(|c| c.id == id) {
        return Err(format!("connection '{id}' already exists"));
    }
    // Ids must not collide with cluster names either (shared target namespace).
    if cluster_file(app_data, &id).is_file() {
        return Err(format!("a cluster named '{id}' already exists"));
    }
    let rec = ExternalConnection {
        id: id.clone(),
        name: id,
        host: host.to_string(),
        port,
        database: if database.trim().is_empty() {
            "postgres".to_string()
        } else {
            database.trim().to_string()
        },
        user: if user.trim().is_empty() {
            "postgres".to_string()
        } else {
            user.trim().to_string()
        },
        created_at_ms: now_ms(),
    };
    list.push(rec.clone());
    write_connections(app_data, &list)?;
    Ok(rec)
}

pub fn remove_connection(app_data: &Path, id: &str) -> Result<(), String> {
    let id = sanitize_name(id)?;
    let mut list = read_connections(app_data);
    let before = list.len();
    list.retain(|c| c.id != id);
    if list.len() == before {
        return Err(format!("unknown connection '{id}'"));
    }
    write_connections(app_data, &list)
}

/// Resolve a `cluster:<name>` / `ext:<id>` target string.
pub(crate) fn resolve_target<'a>(
    app_data: &Path,
    target: &str,
    password: Option<&'a str>,
) -> Result<Target<'a>, String> {
    if let Some(name) = target.strip_prefix("cluster:") {
        return Ok(Target::Cluster(read_record(app_data, name)?));
    }
    if let Some(id) = target.strip_prefix("ext:") {
        let id = sanitize_name(id)?;
        let rec = read_connections(app_data)
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("unknown connection '{id}'"))?;
        return Ok(Target::External(rec, password.unwrap_or("")));
    }
    // Back-compat: bare cluster name.
    Ok(Target::Cluster(read_record(app_data, target)?))
}

pub(crate) struct Endpoint {
    pub(crate) exe: PathBuf,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
    pub(crate) password: String,
}

pub(crate) fn sanitize_name(name: &str) -> Result<String, String> {
    let t = name.trim();
    if t.is_empty() {
        return Err("cluster name must not be empty".to_string());
    }
    if t.len() > 64 {
        return Err("cluster name too long (max 64)".to_string());
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("cluster name may only contain a-z 0-9 - _".to_string());
    }
    Ok(t.to_string())
}

pub(crate) fn cluster_file(app_data: &Path, name: &str) -> PathBuf {
    clusters_dir(app_data).join(format!("{name}.json"))
}

pub fn read_record(app_data: &Path, name: &str) -> Result<ClusterRecord, String> {
    let name = sanitize_name(name)?;
    let raw = std::fs::read_to_string(cluster_file(app_data, &name))
        .map_err(|_| format!("unknown cluster '{name}'"))?;
    serde_json::from_str(&raw).map_err(|e| format!("corrupt cluster record: {e}"))
}

pub fn list_records(app_data: &Path) -> Vec<ClusterRecord> {
    let dir = clusters_dir(app_data);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(rec) = serde_json::from_str::<ClusterRecord>(&raw) {
                out.push(rec);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// True when TCP 127.0.0.1:port accepts a connection.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_crud_roundtrip_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path();
        assert!(list_connections(app).is_empty());
        let rec = add_connection(app, "sys", "127.0.0.1", 5432, "postgres", "postgres").unwrap();
        assert_eq!(rec.id, "sys");
        assert_eq!(list_connections(app).len(), 1);
        assert!(add_connection(app, "sys", "h", 1, "d", "u").is_err());
        remove_connection(app, "sys").unwrap();
        assert!(list_connections(app).is_empty());
        assert!(remove_connection(app, "sys").is_err());
    }

    #[test]
    fn target_prefixes_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path();
        add_connection(app, "ext1", "db.local", 5433, "app", "bob").unwrap();
        assert!(matches!(
            resolve_target(app, "ext:ext1", None),
            Ok(Target::External(_, _))
        ));
        assert!(resolve_target(app, "ext:nope", None).is_err());
        assert!(resolve_target(app, "cluster:nope", None).is_err());
    }

}
