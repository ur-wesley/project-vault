use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};
use crate::models::SessionDto;

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    project_id: String,
    started_at_ms: i64,
    ended_at_ms: Option<i64>,
    command: Option<String>,
}

fn row_to_dto(r: SessionRow) -> SessionDto {
    SessionDto {
        id: r.id,
        project_id: r.project_id,
        started_at_ms: r.started_at_ms,
        ended_at_ms: r.ended_at_ms,
        command: r.command,
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
        "INSERT INTO sessions (id, project_id, started_at_ms, ended_at_ms, command) VALUES (?1, ?2, ?3, NULL, ?4)",
    )
    .bind(&id)
    .bind(project_id)
    .bind(started_at_ms)
    .bind(&command)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(SessionDto {
        id,
        project_id: project_id.to_string(),
        started_at_ms,
        ended_at_ms: None,
        command,
    })
}

pub async fn end_session(pool: &Pool<Sqlite>, session_id: &str) -> Result<SessionDto, StableError> {
    let row: Option<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command FROM sessions WHERE id = ?1",
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
    sqlx::query("UPDATE sessions SET ended_at_ms = ?1 WHERE id = ?2")
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
        "SELECT id, project_id, started_at_ms, ended_at_ms, command FROM sessions WHERE id = ?1",
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
) -> Result<Vec<SessionDto>, StableError> {
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command FROM sessions WHERE project_id = ?1 ORDER BY started_at_ms DESC LIMIT ?2",
    )
    .bind(project_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn list_active_sessions_for_project(
    pool: &Pool<Sqlite>,
    project_id: &str,
) -> Result<Vec<SessionDto>, StableError> {
    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command FROM sessions WHERE project_id = ?1 AND ended_at_ms IS NULL ORDER BY started_at_ms DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn recover_orphan_sessions(pool: &Pool<Sqlite>) -> Result<u64, StableError> {
    let open: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, project_id, started_at_ms, ended_at_ms, command FROM sessions WHERE ended_at_ms IS NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let now = super::now_ms();
    let mut n = 0u64;
    for s in open {
        let dur = now.saturating_sub(s.started_at_ms);
        sqlx::query("UPDATE sessions SET ended_at_ms = ?1 WHERE id = ?2")
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
