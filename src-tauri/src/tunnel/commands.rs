use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{codes, StableError};
use super::{
    check_portless_available, portless_alias, portless_remove_alias, portless_trust,
    start_portless_proxy, stop_portless_proxy, TunnelChangedEmit, TunnelRoute, TunnelState,
    TunnelStatusDto,
};

const PROXY_PORT_KEY: &str = "tunnel_proxy_port";
const TLS_KEY: &str = "tunnel_tls_enabled";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableTunnelInput {
    pub session_id: String,
    pub project_id: String,
    pub port: u16,
    pub subdomain: String,
}

#[tauri::command]
pub async fn check_tunnel_available() -> Result<bool, StableError> {
    Ok(check_portless_available())
}

#[tauri::command]
pub async fn trust_portless_ca() -> Result<(), StableError> {
    portless_trust().map_err(|e| StableError::new(codes::INTERNAL, e))
}

#[tauri::command]
pub async fn start_tunnel_proxy(
    state: State<'_, TunnelState>,
    db: State<'_, tauri_plugin_sql::DbInstances>,
) -> Result<(), StableError> {
    let pool = crate::db::sqlite_pool(&*db).await?;

    let tls_str = crate::db::get_setting(&pool, TLS_KEY)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "false".to_string());
    let tls = tls_str == "true";

    let port_str = crate::db::get_setting(&pool, PROXY_PORT_KEY)
        .await
        .ok()
        .flatten();
    let port: u16 = match port_str.as_deref() {
        Some("4200") | Some("") | None => if tls { 443 } else { 80 },
        Some(p) => p.parse().unwrap_or(if tls { 443 } else { 80 }),
    };

    start_portless_proxy(port, tls).map_err(|e| StableError::new(codes::INTERNAL, e))?;

    {
        let mut inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        inner.proxy_running = true;
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_tunnel_proxy(
    state: State<'_, TunnelState>,
    db: State<'_, tauri_plugin_sql::DbInstances>,
) -> Result<(), StableError> {
    let pool = crate::db::sqlite_pool(&*db).await?;

    let tls_str = crate::db::get_setting(&pool, TLS_KEY)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "false".to_string());
    let tls = tls_str == "true";

    let port_str = crate::db::get_setting(&pool, PROXY_PORT_KEY)
        .await
        .ok()
        .flatten();
    let port: u16 = match port_str.as_deref() {
        Some("4200") | Some("") | None => if tls { 443 } else { 80 },
        Some(p) => p.parse().unwrap_or(if tls { 443 } else { 80 }),
    };

    stop_portless_proxy(port).map_err(|e| StableError::new(codes::INTERNAL, e))?;

    {
        let mut inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        inner.proxy_running = false;
        inner.routes.clear();
    }

    Ok(())
}

#[tauri::command]
pub async fn enable_tunnel(
    app: AppHandle,
    state: State<'_, TunnelState>,
    db: State<'_, tauri_plugin_sql::DbInstances>,
    input: EnableTunnelInput,
) -> Result<String, StableError> {
    let pool = crate::db::sqlite_pool(&*db).await?;
    let tls_str = crate::db::get_setting(&pool, TLS_KEY)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "false".to_string());
    let tls = tls_str == "true";

    let port_str = crate::db::get_setting(&pool, PROXY_PORT_KEY)
        .await
        .ok()
        .flatten();
    let proxy_port: u16 = match port_str.as_deref() {
        Some("4200") | Some("") | None => if tls { 443 } else { 80 },
        Some(p) => p.parse().unwrap_or(if tls { 443 } else { 80 }),
    };

    {
        let mut inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        if !inner.proxy_running {
            start_portless_proxy(proxy_port, tls)
                .map_err(|e| StableError::new(codes::INTERNAL, e))?;
            inner.proxy_running = true;
        }
    }

    portless_alias(&input.subdomain, input.port)
        .map_err(|e| StableError::new(codes::INTERNAL, e))?;

    let scheme = if tls { "https" } else { "http" };
    let port_suffix = if (tls && proxy_port != 443) || (!tls && proxy_port != 80) {
        format!(":{}", proxy_port)
    } else {
        String::new()
    };
    let url = format!("{}://{}.localhost{}", scheme, input.subdomain, port_suffix);

    let route = TunnelRoute {
        hostname: format!("{}.localhost", input.subdomain),
        port: input.port,
        session_id: input.session_id.clone(),
        url: url.clone(),
    };

    {
        let mut inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        inner.routes.insert(input.session_id.clone(), route);
    }

    let _ = app.emit(
        "task-tunnel-changed",
        TunnelChangedEmit {
            session_id: input.session_id,
            project_id: input.project_id,
            port: input.port,
            hostname: Some(format!("{}.localhost", input.subdomain)),
            url: Some(url.clone()),
            active: true,
        },
    );

    Ok(url)
}

#[tauri::command]
pub async fn disable_tunnel(
    app: AppHandle,
    state: State<'_, TunnelState>,
    session_id: String,
    project_id: String,
) -> Result<(), StableError> {
    let route = {
        let mut inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
        inner.routes.remove(&session_id)
    };

    if let Some(route) = route {
        let subdomain = route.hostname.strip_suffix(".localhost").unwrap_or(&route.hostname);
        let _ = portless_remove_alias(subdomain);

        let _ = app.emit(
            "task-tunnel-changed",
            TunnelChangedEmit {
                session_id,
                project_id,
                port: route.port,
                hostname: None,
                url: None,
                active: false,
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn get_tunnel_status(
    state: State<'_, TunnelState>,
) -> Result<TunnelStatusDto, StableError> {
    let inner = state.0.lock().map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    Ok(TunnelStatusDto {
        available: check_portless_available(),
        proxy_running: inner.proxy_running,
        routes: inner.routes.values().cloned().collect(),
    })
}
