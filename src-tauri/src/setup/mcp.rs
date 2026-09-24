//! MCP server autostart from persisted settings.
//! (Extracted verbatim from the `run()` setup closure in `lib.rs`.)

use tauri::{AppHandle, Manager};

/// Auto-start MCP server if enabled in settings.
pub async fn maybe_autostart_mcp_server(handle: &AppHandle, pool: &sqlx::Pool<sqlx::Sqlite>) {
    // Auto-start MCP server if enabled in settings
    let mcp_state = handle.state::<crate::mcp::McpServerState>().inner().clone();
    let mcp_handle = handle.clone();
    let mcp_pool = pool.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(Some(enabled_val)) = crate::db::get_setting(&mcp_pool, "mcp_enabled").await {
            if enabled_val == "true" {
                let port: u16 = crate::db::get_setting(&mcp_pool, "mcp_port")
                    .await
                    .ok()
                    .flatten()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1622);
                let auth_enabled = crate::db::get_setting(&mcp_pool, "mcp_auth_enabled")
                    .await
                    .ok()
                    .flatten()
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let auth_token = crate::db::get_setting(&mcp_pool, "mcp_auth_token")
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_default();

                let _ = crate::mcp::server::start_mcp_server(
                    mcp_state,
                    port,
                    auth_enabled,
                    auth_token,
                    mcp_pool,
                    mcp_handle,
                )
                .await;
            }
        }
    });
}
