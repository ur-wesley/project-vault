use serde::Deserialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::SessionDto;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionPayload {
    pub project_id: String,
    pub command: Option<String>,
    pub session_id: Option<String>,
}

#[tauri::command]
pub async fn start_session(
    db: State<'_, DbInstances>,
    payload: StartSessionPayload,
) -> Result<SessionDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::start_session(&pool, &payload.project_id, payload.command, payload.session_id).await
}

#[tauri::command]
pub async fn end_session(
    db: State<'_, DbInstances>,
    session_id: String,
) -> Result<SessionDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::end_session(&pool, &session_id).await
}

#[tauri::command]
pub async fn list_sessions_for_project(
    db: State<'_, DbInstances>,
    project_id: String,
    limit: i64,
) -> Result<Vec<SessionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_sessions_for_project(&pool, &project_id, limit).await
}

#[tauri::command]
pub async fn list_active_sessions(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Vec<SessionDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::list_active_sessions_for_project(&pool, &project_id).await
}

#[tauri::command]
pub async fn recover_orphan_sessions(db: State<'_, DbInstances>) -> Result<u64, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    db::recover_orphan_sessions(&pool).await
}
