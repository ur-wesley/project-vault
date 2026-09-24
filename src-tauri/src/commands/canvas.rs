use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::{CanvasBlueprintDto, CanvasProjectLayoutDto};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPreviewPingResult {
    pub url: String,
    pub status: u16,
    pub ok: bool,
    pub duration_ms: u64,
}

static HTTP: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

/// Shared HTTP client for the preview liveness ping.
fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .no_proxy()
            .build()
            .expect("reqwest client")
    })
}

#[tauri::command]
pub async fn web_preview_ping(url: String) -> Result<WebPreviewPingResult, StableError> {
    let started = std::time::Instant::now();
    let resp = http()
        .get(&url)
        .send()
        .await
        .map_err(|e| StableError::new("INTERNAL", format!("ping request failed: {e}")))?;
    let status = resp.status().as_u16();
    Ok(WebPreviewPingResult {
        url,
        status,
        ok: resp.status().is_success(),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn get_canvas_layout(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<CanvasProjectLayoutDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::get_canvas_layout(&pool, &project_id).await
}

#[tauri::command]
pub async fn save_canvas_layout(
    db: State<'_, DbInstances>,
    layout: CanvasProjectLayoutDto,
) -> Result<(), StableError> {
    layout.validate()?;
    let pool = db::sqlite_pool(&*db).await?;
    db::save_canvas_layout(&pool, &layout).await
}

#[tauri::command]
pub async fn list_canvas_blueprints(
    db: State<'_, DbInstances>,
) -> Result<Vec<CanvasBlueprintDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_canvas_blueprints(&pool).await
}

#[tauri::command]
pub async fn save_canvas_blueprint(
    db: State<'_, DbInstances>,
    blueprint: CanvasBlueprintDto,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::save_canvas_blueprint(&pool, &blueprint).await
}

#[tauri::command]
pub async fn delete_canvas_blueprint(
    db: State<'_, DbInstances>,
    blueprint_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::delete_canvas_blueprint(&pool, &blueprint_id).await
}
