use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::mcp::server::{
    start_mcp_server as start_server_impl, stop_mcp_server as stop_server_impl, McpServerState,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusDto {
    pub running: bool,
    pub port: u16,
    pub auth_enabled: bool,
    pub auth_token: String,
    pub url: String,
    pub direct_url: String,
}

pub async fn read_status_dto(state: &McpServerState) -> McpServerStatusDto {
    let running = state.0.running.load(Ordering::SeqCst);
    let port = state.0.current_port.load(Ordering::SeqCst);
    let auth_enabled = state.0.auth_enabled.load(Ordering::SeqCst);
    let auth_token = state.0.auth_token.read().await.clone();

    McpServerStatusDto {
        running,
        port,
        auth_enabled,
        auth_token,
        url: format!("http://127.0.0.1:{}/sse", port),
        direct_url: format!("http://127.0.0.1:{}/mcp", port),
    }
}

#[tauri::command]
pub async fn get_mcp_server_status(
    state: State<'_, McpServerState>,
) -> Result<McpServerStatusDto, StableError> {
    Ok(read_status_dto(&state).await)
}

#[tauri::command]
pub async fn start_mcp_server(
    app: AppHandle,
    db: State<'_, DbInstances>,
    state: State<'_, McpServerState>,
    port: Option<u16>,
    auth_enabled: Option<bool>,
    auth_token: Option<String>,
) -> Result<McpServerStatusDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let target_port = port.unwrap_or_else(|| state.0.current_port.load(Ordering::SeqCst));
    let target_auth_enabled =
        auth_enabled.unwrap_or_else(|| state.0.auth_enabled.load(Ordering::SeqCst));
    let target_token = match auth_token {
        Some(t) => t,
        None => state.0.auth_token.read().await.clone(),
    };

    // Save to settings db
    let _ = db::set_setting(&pool, "mcp_enabled", "true").await;
    let _ = db::set_setting(&pool, "mcp_port", &target_port.to_string()).await;
    let _ = db::set_setting(
        &pool,
        "mcp_auth_enabled",
        if target_auth_enabled { "true" } else { "false" },
    )
    .await;
    let _ = db::set_setting(&pool, "mcp_auth_token", &target_token).await;

    start_server_impl(
        (*state).clone(),
        target_port,
        target_auth_enabled,
        target_token,
        pool,
        app,
    )
    .await
    .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))?;

    Ok(read_status_dto(&state).await)
}

#[tauri::command]
pub async fn stop_mcp_server(
    db: State<'_, DbInstances>,
    state: State<'_, McpServerState>,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let _ = db::set_setting(&pool, "mcp_enabled", "false").await;
    stop_server_impl(&state).await;
    Ok(())
}

#[tauri::command]
pub fn generate_mcp_token() -> Result<String, StableError> {
    let token = format!("pv_mcp_{}", uuid::Uuid::new_v4().simple());
    Ok(token)
}

#[tauri::command]
pub async fn save_mcp_settings(
    app: AppHandle,
    db: State<'_, DbInstances>,
    state: State<'_, McpServerState>,
    enabled: bool,
    port: u16,
    auth_enabled: bool,
    auth_token: String,
) -> Result<McpServerStatusDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;

    let _ = db::set_setting(&pool, "mcp_enabled", if enabled { "true" } else { "false" }).await;
    let _ = db::set_setting(&pool, "mcp_port", &port.to_string()).await;
    let _ = db::set_setting(
        &pool,
        "mcp_auth_enabled",
        if auth_enabled { "true" } else { "false" },
    )
    .await;
    let _ = db::set_setting(&pool, "mcp_auth_token", &auth_token).await;

    if enabled {
        start_server_impl((*state).clone(), port, auth_enabled, auth_token, pool, app)
            .await
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))?;
    } else {
        stop_server_impl(&state).await;
    }

    Ok(read_status_dto(&state).await)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceSummaryDto {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
}

#[tauri::command]
pub fn list_mcp_tools() -> Result<Vec<crate::mcp::tool::ToolSummaryDto>, StableError> {
    Ok(crate::mcp::tool::REGISTRY.list_summaries())
}

#[tauri::command]
pub fn list_mcp_resources() -> Result<Vec<McpResourceSummaryDto>, StableError> {
    let resources = crate::mcp::handlers::list_resources()
        .into_iter()
        .map(|r| McpResourceSummaryDto {
            uri: r.uri,
            name: r.name,
            description: r.description,
        })
        .collect();
    Ok(resources)
}
