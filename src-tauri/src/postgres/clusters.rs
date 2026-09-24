use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::docker::*;
use super::extensions::*;
use super::records::*;
use super::settings::*;
use super::versions::*;


pub(crate) fn tcp_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}

pub(crate) fn postmaster_pid(data_dir: &Path) -> Option<u32> {
    let raw = std::fs::read_to_string(data_dir.join("postmaster.pid")).ok()?;
    raw.lines().next()?.trim().parse::<u32>().ok()
}

pub fn cluster_status(app_data: &Path, name: &str) -> Result<ClusterStatus, String> {
    let rec = read_record(app_data, name)?;
    if rec.backend() == "docker" {
        let running = docker_is_running(&rec.name) && tcp_open(rec.port);
        return Ok(ClusterStatus {
            name: rec.name,
            version: rec.version,
            port: rec.port,
            running,
            pid: None,
            data_dir: rec.data_dir,
            backend: rec.backend,
            image: rec.image,
            extensions: rec.extensions,
        });
    }
    let data_dir = PathBuf::from(&rec.data_dir);
    let pid = postmaster_pid(&data_dir);
    // pid file alone is stale-safe only with a live socket check.
    let running = pid.is_some() && tcp_open(rec.port);
    Ok(ClusterStatus {
        name: rec.name,
        version: rec.version,
        port: rec.port,
        running,
        pid: if running { pid } else { None },
        data_dir: rec.data_dir,
        backend: rec.backend,
        image: rec.image,
        extensions: rec.extensions,
    })
}

pub fn list_statuses(app_data: &Path) -> Vec<ClusterStatus> {
    list_records(app_data)
        .iter()
        .filter_map(|r| cluster_status(app_data, &r.name).ok())
        .collect()
}

/// Find a free 127.0.0.1 TCP port starting at `preferred`.
pub fn probe_free_port(preferred: u16) -> u16 {
    let mut port = preferred;
    for _ in 0..200 {
        if std::net::TcpListener::bind(format!("127.0.0.1:{port}")).is_ok() {
            return port;
        }
        port = port.saturating_add(1);
    }
    preferred
}


/// Options for `create_cluster_full` (new customizable path).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateClusterOptions {
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub backend: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub db_user: Option<String>,
    #[serde(default)]
    pub db_name: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub max_connections: Option<u32>,
}

pub(crate) fn normalize_extensions(list: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for e in list {
        let t = e.trim().to_lowercase();
        if t.is_empty() || out.contains(&t) {
            continue;
        }
        // Accept a few aliases.
        let norm = match t.as_str() {
            "timescaledb" => "timescale".to_string(),
            "vector" => "pgvector".to_string(),
            "trgm" => "pg_trgm".to_string(),
            "crypto" => "pgcrypto".to_string(),
            "uuid" | "uuid_ossp" => "uuid-ossp".to_string(),
            "stat_statements" => "pg_stat_statements".to_string(),
            _ => t,
        };
        if extension_by_id(&norm).is_some() || norm.starts_with("custom:") {
            out.push(norm);
        } else {
            out.push(norm);
        }
    }
    out
}

pub async fn create_cluster(
    app_data: &Path,
    name: &str,
    major: &str,
    port: Option<u16>,
) -> Result<ClusterRecord, String> {
    create_cluster_full(
        app_data,
        name,
        major,
        CreateClusterOptions {
            port,
            ..Default::default()
        },
    )
    .await
}

pub async fn create_cluster_full(
    app_data: &Path,
    name: &str,
    major: &str,
    opts: CreateClusterOptions,
) -> Result<ClusterRecord, String> {
    let name = sanitize_name(name)?;
    if !is_version_supported(app_data, major) {
        return Err(format!("unsupported postgres version '{major}'"));
    }
    if cluster_file(app_data, &name).is_file() {
        return Err(format!("cluster '{name}' already exists"));
    }
    let backend = opts
        .backend
        .clone()
        .unwrap_or_else(|| load_settings(app_data).default_backend);
    let backend = if backend.trim().is_empty() {
        "portable".to_string()
    } else {
        backend.trim().to_lowercase()
    };
    if backend != "portable" && backend != "docker" {
        return Err("backend must be 'portable' or 'docker'".to_string());
    }
    let extensions = normalize_extensions(&opts.extensions);
    for e in &extensions {
        if e.starts_with("custom:") {
            continue;
        }
        if extension_by_id(e).is_none() {
            return Err(format!("unknown extension '{e}' (try pg_trgm, pgcrypto, uuid-ossp, pg_stat_statements, timescale, postgis, pgvector, pg_cron or custom:<sql>)"));
        }
    }

    // Port: explicit → validate with suggestion; auto (None/0) → allocate.
    let port = match opts.port {
        Some(0) | None => alloc_free_port(app_data, default_port(major)),
        Some(p) => validate_explicit_port(app_data, p)?,
    };

    if backend == "docker" {
        return create_docker_cluster(app_data, &name, major, port, &extensions, opts.image.as_deref()).await;
    }

    let bindir =
        resolve_bindir(app_data, major).ok_or_else(|| format!("postgres {major} not installed"))?;
    let data_dir = clusters_dir(app_data).join(&name).join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("mkdir data dir: {e}"))?;

    let db_user = opts.db_user.clone().unwrap_or_else(|| "postgres".to_string());
    let mut args: Vec<String> = vec![
        "-D".to_string(),
        data_dir.display().to_string(),
        "-E".to_string(),
        opts.encoding.clone().unwrap_or_else(|| "UTF8".to_string()),
        "--auth=trust".to_string(),
        "-U".to_string(),
        db_user,
    ];
    if let Some(loc) = &opts.locale {
        if !loc.trim().is_empty() {
            args.push("--locale".to_string());
            args.push(loc.trim().to_string());
        }
    }
    let initdb = bin_path(&bindir, "initdb");
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_tool(&initdb, &arg_refs, &[]).await?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(clusters_dir(app_data).join(&name));
        return Err(format!("initdb failed: {}", out_text(&out).trim()));
    }

    // Optional preload libs for requested extensions (e.g. timescaledb).
    let preloads: Vec<String> = extensions
        .iter()
        .filter_map(|e| extension_by_id(e))
        .filter(|s| s.needs_shared_preload)
        .filter_map(|s| s.preload_lib.clone())
        .collect();
    if !preloads.is_empty() {
        let _ = ensure_shared_preload(&data_dir.display().to_string(), &preloads);
    }
    if let Some(mc) = opts.max_connections {
        let conf = data_dir.join("postgresql.conf");
        if conf.is_file() {
            let raw = std::fs::read_to_string(&conf).unwrap_or_default();
            let mut found = false;
            let mut out = String::new();
            for line in raw.lines() {
                if !found && line.trim_start().starts_with("max_connections") {
                    out.push_str(&format!("max_connections = {mc}\n"));
                    found = true;
                } else {
                    out.push_str(line);
                    out.push('\n');
                }
            }
            if !found {
                out.push_str(&format!("max_connections = {mc}\n"));
            }
            let _ = std::fs::write(&conf, out);
        }
    }
    let _ = patch_postgresql_conf_port(&data_dir.display().to_string(), port);

    let rec = ClusterRecord {
        name: name.clone(),
        version: major.to_string(),
        port,
        data_dir: data_dir.display().to_string(),
        created_at_ms: now_ms(),
        backend: "portable".to_string(),
        image: None,
        extensions,
    };
    std::fs::create_dir_all(clusters_dir(app_data)).ok();
    write_record(app_data, &rec)?;
    Ok(rec)
}

pub(crate) async fn create_docker_cluster(
    app_data: &Path,
    name: &str,
    major: &str,
    port: u16,
    extensions: &[String],
    custom_image: Option<&str>,
) -> Result<ClusterRecord, String> {
    if !docker_available() {
        return Err("docker not found on PATH — install Docker Desktop or use portable backend".to_string());
    }
    let image = docker_image_for(major, extensions, custom_image);
    // Pull image (best effort with clear error).
    {
        let mut cmd = crate::process_util::hidden_tokio_command("docker");
        cmd.args(["pull", &image]);
        let out = cmd.output().await.map_err(|e| format!("docker pull failed: {e}"))?;
        if !out.status.success() {
            return Err(format!("docker pull {image} failed: {}", out_text(&out).trim()));
        }
    }
    let data_dir = clusters_dir(app_data).join(name).join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("mkdir data dir: {e}"))?;
    let cname = docker_name(name);
    // Remove stale container with same name if any.
    {
        let mut cmd = crate::process_util::hidden_tokio_command("docker");
        cmd.args(["rm", "-f", &cname]);
        let _ = cmd.output().await;
    }
    let port_map = format!("127.0.0.1:{port}:5432");
    let vol = format!("{}:/var/lib/postgresql/data", data_dir.display());
    let mut cmd = crate::process_util::hidden_tokio_command("docker");
    cmd.args([
        "run",
        "-d",
        "--name",
        &cname,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "-p",
        &port_map,
        "-v",
        &vol,
        &image,
    ]);
    let out = cmd.output().await.map_err(|e| format!("docker run failed: {e}"))?;
    if !out.status.success() {
        return Err(format!("docker run failed: {}", out_text(&out).trim()));
    }
    let rec = ClusterRecord {
        name: name.to_string(),
        version: major.to_string(),
        port,
        data_dir: data_dir.display().to_string(),
        created_at_ms: now_ms(),
        backend: "docker".to_string(),
        image: Some(image),
        extensions: extensions.to_vec(),
    };
    write_record(app_data, &rec)?;
    Ok(rec)
}

pub(crate) async fn docker_cmd(args: &[&str]) -> Result<String, String> {
    let mut cmd = crate::process_util::hidden_tokio_command("docker");
    cmd.args(args);
    let out = cmd.output().await.map_err(|e| format!("docker failed: {e}"))?;
    if !out.status.success() {
        return Err(out_text(&out).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub(crate) fn docker_is_running(name: &str) -> bool {
    let mut cmd = crate::process_util::hidden_command("docker");
    cmd.args(["inspect", "-f", "{{.State.Running}}", &docker_name(name)]);
    match cmd.output() {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout).trim() == "true"
        }
        _ => false,
    }
}

pub(crate) fn log_path(app_data: &Path, name: &str) -> PathBuf {
    clusters_dir(app_data).join(name).join("logfile")
}

pub async fn start_cluster(app_data: &Path, name: &str) -> Result<ClusterStatus, String> {
    let mut rec = read_record(app_data, name)?;
    if cluster_status(app_data, &rec.name)?.running {
        return cluster_status(app_data, &rec.name);
    }
    if rec.backend() == "docker" {
        if !docker_available() {
            return Err("docker not found on PATH".to_string());
        }
        docker_cmd(&["start", &docker_name(&rec.name)]).await.map_err(|e| format!("docker start failed: {e}"))?;
        for _ in 0..30 {
            if tcp_open(rec.port) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        return cluster_status(app_data, &rec.name);
    }
    // Auto-repair: recorded port taken by something else → reassign.
    if tcp_open(rec.port) {
        let fresh = alloc_free_port(app_data, rec.port.saturating_add(1));
        if fresh != rec.port {
            rec.port = fresh;
            write_record(app_data, &rec)?;
            let _ = patch_postgresql_conf_port(&rec.data_dir, fresh);
        }
    }
    let bindir = resolve_bindir(app_data, &rec.version)
        .ok_or_else(|| format!("postgres {} not installed", rec.version))?;
    let log = log_path(app_data, &rec.name);
    let port_opt = format!("-p {}", rec.port);
    let out = run_tool(
        &bin_path(&bindir, "pg_ctl"),
        &[
            "-D",
            &rec.data_dir,
            "-l",
            &log.display().to_string(),
            "-w",
            "-t",
            "30",
            "-o",
            &port_opt,
            "start",
        ],
        &[],
    )
    .await?;
    if !out.status.success() {
        return Err(format!("pg_ctl start failed: {}", out_text(&out).trim()));
    }
    // Wait for the socket even though -w was given (Windows can lag).
    for _ in 0..30 {
        if tcp_open(rec.port) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    cluster_status(app_data, &rec.name)
}

pub async fn stop_cluster(app_data: &Path, name: &str) -> Result<ClusterStatus, String> {
    let rec = read_record(app_data, name)?;
    if rec.backend() == "docker" {
        let _ = docker_cmd(&["stop", "-t", "30", &docker_name(&rec.name)]).await;
        return cluster_status(app_data, &rec.name);
    }
    let bindir = resolve_bindir(app_data, &rec.version)
        .ok_or_else(|| format!("postgres {} not installed", rec.version))?;
    let out = run_tool(
        &bin_path(&bindir, "pg_ctl"),
        &["-D", &rec.data_dir, "-w", "-t", "30", "-m", "fast", "stop"],
        &[],
    )
    .await?;
    if !out.status.success() {
        let txt = out_text(&out);
        // "no server running" is fine — treat as stopped.
        if !txt.to_lowercase().contains("no server") && !txt.to_lowercase().contains("not running")
        {
            return Err(format!("pg_ctl stop failed: {}", txt.trim()));
        }
    }
    cluster_status(app_data, &rec.name)
}

pub async fn destroy_cluster(app_data: &Path, name: &str) -> Result<(), String> {
    let rec = read_record(app_data, name)?;
    if rec.backend() == "docker" {
        let _ = docker_cmd(&["rm", "-f", &docker_name(&rec.name)]).await;
        let dir = clusters_dir(app_data).join(&rec.name);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("remove cluster dir: {e}"))?;
        }
        let _ = std::fs::remove_file(cluster_file(app_data, &rec.name));
        return Ok(());
    }
    let _ = stop_cluster(app_data, &rec.name).await;
    let dir = clusters_dir(app_data).join(&rec.name);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove cluster dir: {e}"))?;
    }
    let _ = std::fs::remove_file(cluster_file(app_data, &rec.name));
    Ok(())
}

pub fn read_log_tail(app_data: &Path, name: &str, max_lines: usize) -> Result<String, String> {
    let rec = read_record(app_data, name)?;
    if rec.backend() == "docker" {
        let mut cmd = crate::process_util::hidden_command("docker");
        cmd.args(["logs", "--tail", &max_lines.max(1).to_string(), &docker_name(&rec.name)]);
        match cmd.output() {
            Ok(o) => {
                let mut s = String::from_utf8_lossy(&o.stdout).to_string();
                s.push_str(&String::from_utf8_lossy(&o.stderr));
                if s.trim().is_empty() {
                    return Ok("(empty log)".to_string());
                }
                return Ok(s);
            }
            Err(e) => return Err(format!("docker logs failed: {e}")),
        }
    }
    let raw = std::fs::read_to_string(log_path(app_data, name)).unwrap_or_default();
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(max_lines.max(1));
    Ok(lines[start..].join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cluster_name_sanitizer() {
        assert!(sanitize_name("pg16-dev").is_ok());
        assert!(sanitize_name("../evil").is_err());
        assert!(sanitize_name("").is_err());
    }

}
