use sqlx::{Pool, Sqlite};
use std::convert::TryFrom;

use crate::error::{codes, StableError};
use crate::models::SessionDto;

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    project_id: String,
    started_at_ms: i64,
    ended_at_ms: Option<i64>,
    command: Option<String>,
    state: String,
    root_pid: Option<i64>,
    tree_pids_json: String,
    exit_code: Option<i64>,
    stop_reason: Option<String>,
    last_event_at_ms: i64,
}

fn row_to_dto(r: SessionRow) -> SessionDto {
    let tree_pids = serde_json::from_str::<Vec<u32>>(&r.tree_pids_json).unwrap_or_default();
    SessionDto {
        id: r.id,
        project_id: r.project_id,
        started_at_ms: r.started_at_ms,
        ended_at_ms: r.ended_at_ms,
        command: r.command,
        state: r.state,
        root_pid: r.root_pid.and_then(|pid| u32::try_from(pid).ok()),
        tree_pids,
        exit_code: r.exit_code.and_then(|code| i32::try_from(code).ok()),
        stop_reason: r.stop_reason,
        last_event_at_ms: r.last_event_at_ms,
    }
}

pub async fn start_session(
    pool: &Pool<Sqlite>,
    project_id: &str,
    command: Option<String>,
    session_id: Option<String>,
) -> Result<SessionDto, StableError> {
    let _ = super::projects::get_project(pool, project_id).await?;
    let id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let started_at_ms = super::now_ms();
    sqlx::query(
        "INSERT INTO sessions (id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms) VALUES (?1, ?2, ?3, NULL, ?4, 'starting', NULL, '[]', NULL, NULL, ?5)",
    )
    .bind(&id)
    .bind(project_id)
    .bind(started_at_ms)
    .bind(&command)
    .bind(started_at_ms)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(SessionDto {
        id,
        project_id: project_id.to_string(),
        started_at_ms,
        ended_at_ms: None,
        command,
        state: "starting".to_string(),
        root_pid: None,
        tree_pids: Vec::new(),
        exit_code: None,
        stop_reason: None,
        last_event_at_ms: started_at_ms,
    })
}

pub async fn end_session(pool: &Pool<Sqlite>, session_id: &str) -> Result<SessionDto, StableError> {
    let row: Option<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE id = ?1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let s = row.ok_or_else(|| StableError::new(codes::NOT_FOUND, "session not found"))?;
    if s.ended_at_ms.is_some() {
        return Ok(row_to_dto(s));
    }
    let now = super::now_ms();
    let dur = now.saturating_sub(s.started_at_ms);
    sqlx::query("UPDATE sessions SET ended_at_ms = ?1, state = CASE WHEN state IN ('success', 'error', 'cancelled') THEN state ELSE 'success' END, last_event_at_ms = ?1 WHERE id = ?2")
        .bind(now)
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    sqlx::query("UPDATE projects SET total_playtime_ms = total_playtime_ms + ?1 WHERE id = ?2")
        .bind(dur)
        .bind(&s.project_id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_session(pool, session_id).await
}

pub async fn get_session(pool: &Pool<Sqlite>, session_id: &str) -> Result<SessionDto, StableError> {
    let row: Option<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE id = ?1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    row.map(row_to_dto)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "session not found"))
}

pub async fn list_sessions_for_project(
    pool: &Pool<Sqlite>,
    project_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SessionDto>, StableError> {
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE project_id = ?1 ORDER BY started_at_ms DESC LIMIT ?2 OFFSET ?3",
    )
    .bind(project_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn get_session_count_for_project(
    pool: &Pool<Sqlite>,
    project_id: &str,
    state_filter: Option<&str>,
) -> Result<i64, StableError> {
    let row: (i64,) = if let Some(state) = state_filter {
        sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE project_id = ?1 AND state = ?2")
            .bind(project_id)
            .bind(state)
            .fetch_one(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?
    } else {
        sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE project_id = ?1")
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?
    };
    Ok(row.0)
}

pub async fn list_active_sessions_for_project(
    pool: &Pool<Sqlite>,
    project_id: &str,
) -> Result<Vec<SessionDto>, StableError> {
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE project_id = ?1 AND ended_at_ms IS NULL ORDER BY started_at_ms DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn list_active_sessions_for_project_all(
    pool: &Pool<Sqlite>,
) -> Result<Vec<SessionDto>, StableError> {
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE ended_at_ms IS NULL ORDER BY started_at_ms DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn recover_orphan_sessions(pool: &Pool<Sqlite>) -> Result<u64, StableError> {
    let open: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command, state, root_pid, tree_pids_json, exit_code, stop_reason, last_event_at_ms FROM sessions WHERE ended_at_ms IS NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let now = super::now_ms();
    let mut n = 0u64;
    for s in open {
        let dur = now.saturating_sub(s.started_at_ms);
        sqlx::query("UPDATE sessions SET ended_at_ms = ?1, state = 'error', stop_reason = COALESCE(stop_reason, 'Recovered as orphaned session on startup'), last_event_at_ms = ?1 WHERE id = ?2")
            .bind(now)
            .bind(&s.id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        sqlx::query("UPDATE projects SET total_playtime_ms = total_playtime_ms + ?1 WHERE id = ?2")
            .bind(dur)
            .bind(&s.project_id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        n += 1;
    }
    Ok(n)
}

pub async fn update_session_runtime(
    pool: &Pool<Sqlite>,
    session_id: &str,
    state: &str,
    root_pid: Option<u32>,
    tree_pids: &[u32],
    exit_code: Option<i32>,
    stop_reason: Option<&str>,
    last_event_at_ms: i64,
) -> Result<SessionDto, StableError> {
    let tree_pids_json = serde_json::to_string(tree_pids)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    sqlx::query(
        "UPDATE sessions SET state = ?1, root_pid = ?2, tree_pids_json = ?3, exit_code = ?4, stop_reason = ?5, last_event_at_ms = ?6 WHERE id = ?7",
    )
    .bind(state)
    .bind(root_pid.map(i64::from))
    .bind(tree_pids_json)
    .bind(exit_code.map(i64::from))
    .bind(stop_reason)
    .bind(last_event_at_ms)
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_session(pool, session_id).await
}

pub async fn clear_sessions_for_project(
    pool: &Pool<Sqlite>,
    project_id: &str,
) -> Result<u64, StableError> {
    let result = sqlx::query("DELETE FROM sessions WHERE project_id = ?1")
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(result.rows_affected())
}
