use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};
use crate::models::{AgentSessionDto, WorkspaceDto};

#[derive(sqlx::FromRow)]
struct WorkspaceRow {
    id: String,
    project_id: String,
    card_board: Option<String>,
    card_id: Option<String>,
    name: String,
    repo_path: String,
    worktree_path: String,
    branch: String,
    status: String,
    archived: i64,
    created_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(sqlx::FromRow)]
struct AgentSessionRow {
    id: String,
    workspace_id: String,
    executor: String,
    pty_session_id: String,
    status: String,
    last_prompt: Option<String>,
    created_at_ms: i64,
    updated_at_ms: i64,
}

fn workspace_to_dto(r: WorkspaceRow) -> WorkspaceDto {
    WorkspaceDto {
        id: r.id,
        project_id: r.project_id,
        card_board: r.card_board,
        card_id: r.card_id,
        name: r.name,
        repo_path: r.repo_path,
        worktree_path: r.worktree_path,
        branch: r.branch,
        status: r.status,
        archived: r.archived != 0,
        created_at_ms: r.created_at_ms,
        updated_at_ms: r.updated_at_ms,
    }
}

fn session_to_dto(r: AgentSessionRow) -> AgentSessionDto {
    AgentSessionDto {
        id: r.id,
        workspace_id: r.workspace_id,
        executor: r.executor,
        pty_session_id: r.pty_session_id,
        status: r.status,
        last_prompt: r.last_prompt,
        created_at_ms: r.created_at_ms,
        updated_at_ms: r.updated_at_ms,
    }
}

fn db_err(e: sqlx::Error) -> StableError {
    StableError::new(codes::DB_ERROR, e.to_string())
}

const WORKSPACE_COLS: &str = "id, project_id, card_board, card_id, name, repo_path, worktree_path, branch, status, archived, created_at_ms, updated_at_ms";
const SESSION_COLS: &str =
    "id, workspace_id, executor, pty_session_id, status, last_prompt, created_at_ms, updated_at_ms";

pub async fn create_workspace(
    pool: &Pool<Sqlite>,
    ws: &WorkspaceDto,
) -> Result<WorkspaceDto, StableError> {
    sqlx::query(
        "INSERT INTO agent_workspaces (id, project_id, card_board, card_id, name, repo_path, worktree_path, branch, status, archived, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )
    .bind(&ws.id)
    .bind(&ws.project_id)
    .bind(&ws.card_board)
    .bind(&ws.card_id)
    .bind(&ws.name)
    .bind(&ws.repo_path)
    .bind(&ws.worktree_path)
    .bind(&ws.branch)
    .bind(&ws.status)
    .bind(if ws.archived { 1 } else { 0 })
    .bind(ws.created_at_ms)
    .bind(ws.updated_at_ms)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(ws.clone())
}

pub async fn get_workspace(pool: &Pool<Sqlite>, id: &str) -> Result<WorkspaceDto, StableError> {
    let row: Option<WorkspaceRow> =
        sqlx::query_as(&format!("SELECT {WORKSPACE_COLS} FROM agent_workspaces WHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(db_err)?;
    row.map(workspace_to_dto)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "workspace not found"))
}

pub async fn list_workspaces(
    pool: &Pool<Sqlite>,
    project_id: Option<&str>,
    include_archived: bool,
    card_board: Option<&str>,
    card_id: Option<&str>,
) -> Result<Vec<WorkspaceDto>, StableError> {
    let mut sql = format!("SELECT {WORKSPACE_COLS} FROM agent_workspaces WHERE 1 = 1");
    if !include_archived {
        sql.push_str(" AND archived = 0");
    }
    if project_id.is_some() {
        sql.push_str(" AND project_id = ?");
    }
    if card_board.is_some() {
        sql.push_str(" AND card_board = ?");
    }
    if card_id.is_some() {
        sql.push_str(" AND card_id = ?");
    }
    sql.push_str(" ORDER BY updated_at_ms DESC");
    let mut q = sqlx::query_as::<_, WorkspaceRow>(&sql);
    if let Some(p) = project_id {
        q = q.bind(p);
    }
    if let Some(b) = card_board {
        q = q.bind(b);
    }
    if let Some(c) = card_id {
        q = q.bind(c);
    }
    Ok(q.fetch_all(pool).await.map_err(db_err)?.into_iter().map(workspace_to_dto).collect())
}

pub async fn touch_workspace(pool: &Pool<Sqlite>, id: &str) -> Result<(), StableError> {
    sqlx::query("UPDATE agent_workspaces SET updated_at_ms = ?1 WHERE id = ?2")
        .bind(super::now_ms())
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn set_workspace_status(
    pool: &Pool<Sqlite>,
    id: &str,
    status: &str,
) -> Result<(), StableError> {
    sqlx::query("UPDATE agent_workspaces SET status = ?1, updated_at_ms = ?2 WHERE id = ?3")
        .bind(status)
        .bind(super::now_ms())
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn set_workspace_card(
    pool: &Pool<Sqlite>,
    id: &str,
    card_board: Option<&str>,
    card_id: Option<&str>,
) -> Result<(), StableError> {
    sqlx::query("UPDATE agent_workspaces SET card_board = ?1, card_id = ?2, updated_at_ms = ?3 WHERE id = ?4")
        .bind(card_board)
        .bind(card_id)
        .bind(super::now_ms())
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn archive_workspace(
    pool: &Pool<Sqlite>,
    id: &str,
    archived: bool,
) -> Result<(), StableError> {
    sqlx::query("UPDATE agent_workspaces SET archived = ?1, updated_at_ms = ?2 WHERE id = ?3")
        .bind(if archived { 1 } else { 0 })
        .bind(super::now_ms())
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn delete_workspace(pool: &Pool<Sqlite>, id: &str) -> Result<(), StableError> {
    sqlx::query("DELETE FROM agent_sessions WHERE workspace_id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM agent_workspaces WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn create_agent_session(
    pool: &Pool<Sqlite>,
    s: &AgentSessionDto,
) -> Result<AgentSessionDto, StableError> {
    sqlx::query(
        "INSERT INTO agent_sessions (id, workspace_id, executor, pty_session_id, status, last_prompt, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&s.id)
    .bind(&s.workspace_id)
    .bind(&s.executor)
    .bind(&s.pty_session_id)
    .bind(&s.status)
    .bind(&s.last_prompt)
    .bind(s.created_at_ms)
    .bind(s.updated_at_ms)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(s.clone())
}

pub async fn get_agent_session(pool: &Pool<Sqlite>, id: &str) -> Result<AgentSessionDto, StableError> {
    let row: Option<AgentSessionRow> =
        sqlx::query_as(&format!("SELECT {SESSION_COLS} FROM agent_sessions WHERE id = ?1"))
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(db_err)?;
    row.map(session_to_dto)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "agent session not found"))
}

pub async fn list_agent_sessions(
    pool: &Pool<Sqlite>,
    workspace_id: &str,
) -> Result<Vec<AgentSessionDto>, StableError> {
    let rows: Vec<AgentSessionRow> = sqlx::query_as(&format!(
        "SELECT {SESSION_COLS} FROM agent_sessions WHERE workspace_id = ?1 ORDER BY created_at_ms ASC"
    ))
    .bind(workspace_id)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    Ok(rows.into_iter().map(session_to_dto).collect())
}

pub async fn set_agent_session_status(
    pool: &Pool<Sqlite>,
    id: &str,
    status: &str,
) -> Result<(), StableError> {
    sqlx::query("UPDATE agent_sessions SET status = ?1, updated_at_ms = ?2 WHERE id = ?3")
        .bind(status)
        .bind(super::now_ms())
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}
