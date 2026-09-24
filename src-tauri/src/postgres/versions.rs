use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::clusters::*;
use super::docker::*;
use super::records::*;
use super::settings::*;

/// User-added version with a custom download URL (e.g. newer PG, fork).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomVersion {
    pub major: String,
    pub download_url: String,
    #[serde(default)]
    pub label: Option<String>,
}

pub(crate) fn custom_versions_file(app_data: &Path) -> PathBuf {
    base_dir(app_data).join("custom_versions.json")
}

pub fn list_custom_versions(app_data: &Path) -> Vec<CustomVersion> {
    let raw = std::fs::read_to_string(custom_versions_file(app_data)).unwrap_or_default();
    if raw.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

pub(crate) fn write_custom_versions(app_data: &Path, list: &[CustomVersion]) -> Result<(), String> {
    std::fs::create_dir_all(base_dir(app_data)).map_err(|e| format!("mkdir postgres: {e}"))?;
    std::fs::write(
        custom_versions_file(app_data),
        serde_json::to_string_pretty(list).unwrap_or_default(),
    )
    .map_err(|e| format!("write custom versions: {e}"))
}

pub fn add_custom_version(app_data: &Path, major: &str, url: &str) -> Result<CustomVersion, String> {
    let major = major.trim().to_string();
    if major.is_empty() || major.len() > 16 || !major.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') {
        return Err("invalid version label (use e.g. 18 or 16-perf)".to_string());
    }
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) || !url.ends_with(".zip") {
        return Err("download URL must be http(s) and end with .zip".to_string());
    }
    let mut list = list_custom_versions(app_data);
    if SUPPORTED_VERSIONS.contains(&major.as_str()) || list.iter().any(|c| c.major == major) {
        return Err(format!("version '{major}' already known"));
    }
    let rec = CustomVersion { major: major.clone(), download_url: url, label: None };
    list.push(rec.clone());
    write_custom_versions(app_data, &list)?;
    Ok(rec)
}

pub fn remove_custom_version(app_data: &Path, major: &str) -> Result<(), String> {
    let mut list = list_custom_versions(app_data);
    let before = list.len();
    list.retain(|c| c.major != major);
    if list.len() == before {
        return Err(format!("unknown custom version '{major}'"));
    }
    for rec in list_records(app_data) {
        if rec.version == major {
            return Err(format!("version {major} still used by cluster '{}'", rec.name));
        }
    }
    write_custom_versions(app_data, &list)
}

pub(crate) fn resolve_download_url(app_data: &Path, major: &str) -> Option<String> {
    if let Some(c) = list_custom_versions(app_data).into_iter().find(|c| c.major == major) {
        return Some(c.download_url);
    }
    edb_download_url(major)
}

pub fn is_version_supported(app_data: &Path, major: &str) -> bool {
    SUPPORTED_VERSIONS.contains(&major)
        || list_custom_versions(app_data).iter().any(|c| c.major == major)
}

/// Newest installed portable version's bindir (external instances reuse it).
pub(crate) fn newest_bindir(app_data: &Path) -> Option<PathBuf> {
    SUPPORTED_VERSIONS
        .iter()
        .rev()
        .find_map(|v| resolve_bindir(app_data, v))
}

/// System `psql` on PATH (fallback when no portable version is installed).
pub(crate) fn system_psql() -> Option<PathBuf> {
    let mut cmd = crate::process_util::hidden_command("psql");
    cmd.arg("--version");
    match cmd.output() {
        Ok(out) if out.status.success() => Some(PathBuf::from("psql")),
        _ => None,
    }
}

pub fn query_tool_available(app_data: &Path) -> bool {
    newest_bindir(app_data).is_some() || system_psql().is_some()
}

pub(crate) fn endpoint_for(app_data: &Path, target: Target<'_>) -> Result<Endpoint, String> {
    match target {
        Target::Cluster(rec) => {
            if !cluster_status(app_data, &rec.name)?.running {
                return Err(format!("cluster '{}' is not running", rec.name));
            }
            // Docker clusters have no local bindir — reuse any psql.
            let exe = if rec.backend() == "docker" {
                newest_bindir(app_data)
                    .map(|b| bin_path(&b, "psql"))
                    .or_else(system_psql)
                    .ok_or_else(|| {
                        "no psql available — install a portable version or system postgres first"
                            .to_string()
                    })?
            } else {
                let bindir = resolve_bindir(app_data, &rec.version)
                    .ok_or_else(|| format!("postgres {} not installed", rec.version))?;
                bin_path(&bindir, "psql")
            };
            Ok(Endpoint {
                exe,
                host: "127.0.0.1".to_string(),
                port: rec.port,
                user: "postgres".to_string(),
                password: String::new(),
            })
        }
        Target::External(rec, password) => {
            let exe = newest_bindir(app_data)
                .map(|b| bin_path(&b, "psql"))
                .or_else(system_psql)
                .ok_or_else(|| {
                    "no psql available — install a portable version or system postgres first"
                        .to_string()
                })?;
            Ok(Endpoint {
                exe,
                host: rec.host.clone(),
                port: rec.port,
                user: rec.user.clone(),
                password: password.to_string(),
            })
        }
    }
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Candidate bindirs inside an unpacked EDB zip (layout differs per OS release).
pub(crate) fn bindir_candidates(version_dir: &Path) -> Vec<PathBuf> {
    vec![
        version_dir.join("pgsql").join("bin"),
        version_dir.join("bin"),
        version_dir.to_path_buf(),
    ]
}

/// Resolve the bindir holding pg_ctl for an installed version.
pub fn resolve_bindir(app_data: &Path, major: &str) -> Option<PathBuf> {
    let vdir = versions_dir(app_data).join(major);
    let exe = if cfg!(windows) {
        "pg_ctl.exe"
    } else {
        "pg_ctl"
    };
    bindir_candidates(&vdir)
        .into_iter()
        .find(|d| d.join(exe).is_file())
}

pub fn is_version_installed(app_data: &Path, major: &str) -> bool {
    resolve_bindir(app_data, major).is_some()
}

pub(crate) fn bin_path(bindir: &Path, name: &str) -> PathBuf {
    if cfg!(windows) {
        bindir.join(format!("{name}.exe"))
    } else {
        bindir.join(name)
    }
}

pub fn list_versions(app_data: &Path) -> Vec<VersionInfo> {
    let mut out: Vec<VersionInfo> = SUPPORTED_VERSIONS
        .iter()
        .map(|v| {
            let bindir = resolve_bindir(app_data, v);
            VersionInfo {
                version: v.to_string(),
                installed: bindir.is_some(),
                path: bindir.map(|b| b.display().to_string()),
                bin_version: None,
            }
        })
        .collect();
    for c in list_custom_versions(app_data) {
        let bindir = resolve_bindir(app_data, &c.major);
        out.push(VersionInfo {
            version: c.major,
            installed: bindir.is_some(),
            path: bindir.map(|b| b.display().to_string()),
            bin_version: None,
        });
    }
    out
}

pub(crate) async fn run_tool(
    tool: &Path,
    args: &[&str],
    env_extra: &[(&str, &str)],
) -> Result<std::process::Output, String> {
    let mut cmd = crate::process_util::hidden_tokio_command(&tool.display().to_string());
    cmd.args(args);
    for (k, v) in env_extra {
        cmd.env(k, v);
    }
    // Postgres tools refuse to run with an inherited port env; be explicit.
    cmd.env("PGHOST", "127.0.0.1");
    cmd.output()
        .await
        .map_err(|e| format!("failed to spawn {}: {e}", tool.display()))
}

pub(crate) fn out_text(out: &std::process::Output) -> String {
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    let e = String::from_utf8_lossy(&out.stderr).to_string();
    if !e.trim().is_empty() {
        s.push_str(&e);
    }
    s
}

/// Download + unpack EDB portable binaries for a major version.
///
/// Runs on the lua-worker-driven future: never `block_on` anywhere in this
/// path (the caller already drives it inside the global runtime — nesting
/// runtimes panics with "Cannot start a runtime from within a runtime").
/// The CPU-bound unzip runs on `spawn_blocking` with a sync-only closure.
/// On any failure the version dir is removed so a retry starts clean.
pub async fn install_version(app_data: &Path, major: &str) -> Result<(), String> {
    let res = install_version_inner(app_data, major).await;
    if res.is_err() {
        let _ = std::fs::remove_dir_all(versions_dir(app_data).join(major));
    }
    res
}

pub(crate) async fn install_version_inner(app_data: &Path, major: &str) -> Result<(), String> {
    if !is_version_supported(app_data, major) {
        return Err(format!("unsupported postgres version '{major}'"));
    }
    if is_version_installed(app_data, major) {
        return Ok(());
    }
    let url =
        resolve_download_url(app_data, major).ok_or_else(|| format!("no download known for postgres {major}"))?;
    let vdir = versions_dir(app_data).join(major);
    std::fs::create_dir_all(&vdir).map_err(|e| format!("mkdir versions: {e}"))?;

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("download failed ({url}): {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download body failed: {e}"))?;
    if bytes.len() < 1024 * 1024 {
        return Err("download too small — probably an error page, aborting".to_string());
    }

    let zip_path = vdir.join("binaries.zip");
    std::fs::write(&zip_path, &bytes).map_err(|e| format!("write zip: {e}"))?;

    // CPU-bound unzip off the async worker. Sync-only closure: no await,
    // no block_on inside — awaiting the JoinHandle is the async boundary.
    let vdir_owned = vdir.clone();
    let major_owned = major.to_string();
    tokio::task::spawn_blocking(move || unpack_version_dir(&vdir_owned, &major_owned))
        .await
        .map_err(|e| format!("unpack task failed: {e}"))??;

    if resolve_bindir(app_data, major).is_none() {
        return Err("unpack succeeded but pg_ctl not found — layout mismatch".to_string());
    }
    let meta = serde_json::json!({ "version": major, "installed_at_ms": now_ms(), "source": url });
    let _ = std::fs::write(
        vdir.join("version.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );
    Ok(())
}

/// Synchronous half of `install_version`: unzip + chmod. Must stay sync-only
/// (runs on a blocking-pool thread; never await or block_on in here).
pub(crate) fn unpack_version_dir(vdir: &Path, _major: &str) -> Result<(), String> {
    let zip_path = vdir.join("binaries.zip");
    let file = std::fs::File::open(&zip_path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("unzip: {e}"))?;
    archive
        .extract(vdir)
        .map_err(|e| format!("extract: {e}"))?;
    let _ = std::fs::remove_file(&zip_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for bin in ["initdb", "pg_ctl", "psql", "postgres", "pg_isready"] {
            for cand in bindir_candidates(vdir) {
                let p = cand.join(bin);
                if p.is_file() {
                    let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
                }
            }
        }
    }
    Ok(())
}

pub async fn remove_version(app_data: &Path, major: &str) -> Result<(), String> {
    for rec in list_records(app_data) {
        if rec.version == major {
            return Err(format!(
                "version {major} is still used by cluster '{}' — destroy it first",
                rec.name
            ));
        }
    }
    let vdir = versions_dir(app_data).join(major);
    if !vdir.is_dir() {
        return Ok(());
    }
    std::fs::remove_dir_all(&vdir).map_err(|e| format!("remove version dir: {e}"))
}

/// Report system postgres tools found on PATH (psql/pg_ctl/initdb + docker).
pub fn detect_system() -> serde_json::Value {
    fn probe(tool: &str) -> Option<String> {
        let mut cmd = crate::process_util::hidden_command(tool);
        cmd.arg("--version");
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
    serde_json::json!({
        "psql": probe("psql"),
        "pg_ctl": probe("pg_ctl"),
        "initdb": probe("initdb"),
        "docker": detect_docker(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_versions_cover_13_to_18() {
        assert_eq!(SUPPORTED_VERSIONS, &["13", "14", "15", "16", "17", "18"]);
    }

    #[test]
    fn default_ports_do_not_clash_with_system_postgres() {
        let mut ports: Vec<u16> = SUPPORTED_VERSIONS.iter().map(|v| default_port(v)).collect();
        assert!(!ports.contains(&5432));
        ports.sort_unstable();
        ports.dedup();
        assert_eq!(ports.len(), 6);
    }


    #[test]
    fn custom_version_crud_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path();
        assert!(add_custom_version(app, "bad!", "https://example.com/x.zip").is_err());
        add_custom_version(app, "18beta", "https://example.com/pg-18beta.zip").unwrap();
        assert!(is_version_supported(app, "18beta"));
        assert!(resolve_download_url(app, "18beta").unwrap().contains("example.com"));
        remove_custom_version(app, "18beta").unwrap();
        assert!(!is_version_supported(app, "18beta"));
    }
}
