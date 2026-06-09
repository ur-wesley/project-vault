pub mod commands;

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;

fn portless_cmd() -> Command {
    crate::process_util::hidden_command("portless")
}

#[derive(Clone, Default)]
pub struct TunnelState(pub Arc<Mutex<TunnelStateInner>>);

#[derive(Clone, Default)]
pub struct TunnelStateInner {
    pub portless_available: bool,
    pub proxy_running: bool,
    pub routes: HashMap<String, TunnelRoute>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TunnelRoute {
    pub hostname: String,
    pub port: u16,
    pub session_id: String,
    pub url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatusDto {
    pub available: bool,
    pub proxy_running: bool,
    pub routes: Vec<TunnelRoute>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelChangedEmit {
    pub session_id: String,
    pub project_id: String,
    pub port: u16,
    pub hostname: Option<String>,
    pub url: Option<String>,
    pub active: bool,
}

pub fn check_portless_available() -> bool {
    let output = portless_cmd()
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

pub fn start_portless_proxy(port: u16, tls: bool) -> Result<(), String> {
    let _ = stop_portless_proxy_any();

    if let Some(state_dir) = portless_state_dir() {
        let _ = std::fs::remove_file(state_dir.join("proxy.port"));
        let _ = std::fs::remove_file(state_dir.join("proxy.pid"));
    }

    let port_str = port.to_string();
    let mut args = vec!["proxy", "start", "-p", &port_str];
    if !tls {
        args.push("--no-tls");
    }
    let output = portless_cmd()
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to start portless proxy: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Portless proxy failed: {stderr}"))
    }
}

fn portless_state_dir() -> Option<std::path::PathBuf> {
    if let Ok(custom) = std::env::var("PORTLESS_STATE_DIR") {
        return Some(std::path::PathBuf::from(custom));
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join(".portless"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join(".portless"))
    }
}

fn stop_portless_proxy_any() -> Result<(), String> {
    let output = portless_cmd()
        .args(["proxy", "stop"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to stop portless proxy: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Ok(())
    }
}

pub fn stop_portless_proxy(port: u16) -> Result<(), String> {
    let output = portless_cmd()
        .args(["proxy", "stop", "-p", &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to stop portless proxy: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Portless proxy stop failed: {stderr}"))
    }
}

pub fn portless_trust() -> Result<(), String> {
    let output = portless_cmd()
        .args(["trust"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to trust portless CA: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Portless trust failed: {stderr}"))
    }
}

pub fn portless_is_ca_trusted() -> bool {
    let output = portless_cmd()
        .args(["trust"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains("already trusted") || o.status.success()
        }
        Err(_) => false,
    }
}

pub fn portless_alias(subdomain: &str, port: u16) -> Result<(), String> {
    let hostname = format!("{subdomain}.localhost");
    let output = portless_cmd()
        .args(["alias", &hostname, &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to create portless alias: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Portless alias failed: {stderr}"))
    }
}

pub fn portless_remove_alias(subdomain: &str) -> Result<(), String> {
    let hostname = format!("{subdomain}.localhost");
    let output = portless_cmd()
        .args(["alias", "--remove", &hostname])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to remove portless alias: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Portless alias remove failed: {stderr}"))
    }
}

pub fn portless_list() -> Result<Vec<TunnelRoute>, String> {
    let output = portless_cmd()
        .args(["list"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to list portless routes: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Portless list failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut routes = Vec::new();

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("  ") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 3 {
                let url = parts[0].to_string();
                let target = parts[2].to_string();
                if let Some(port_str) = target.strip_prefix("localhost:") {
                    if let Ok(port) = port_str.parse::<u16>() {
                        let hostname = url
                            .strip_prefix("http://")
                            .or_else(|| url.strip_prefix("https://"))
                            .unwrap_or(&url)
                            .split(':')
                            .next()
                            .unwrap_or("")
                            .to_string();
                        routes.push(TunnelRoute {
                            hostname,
                            port,
                            session_id: String::new(),
                            url,
                        });
                    }
                }
            }
        }
    }

    Ok(routes)
}
