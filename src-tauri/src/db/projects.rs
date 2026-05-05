use std::collections::HashSet;
use std::path::Path;

use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};
use crate::models::{ProjectDto, TaskDto};

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: String,
    location_id: String,
    name: String,
    path: String,
    stack: String,
    runtime_hint: Option<String>,
    favorite: i32,
    last_opened_at_ms: Option<i64>,
    total_playtime_ms: i64,
    tasks_json: String,
    tags_json: String,
    github_owner: Option<String>,
    github_repo: Option<String>,
    file_count: i64,
    size_bytes: i64,
    last_edited_at_ms: Option<i64>,
}

fn row_to_dto(r: ProjectRow) -> Result<ProjectDto, StableError> {
    let tasks: Vec<TaskDto> = serde_json::from_str(&r.tasks_json)
        .map_err(|e| StableError::new(codes::DB_ERROR, format!("tasks_json: {e}")))?;
    let tags: Vec<String> = serde_json::from_str(&r.tags_json)
        .map_err(|e| StableError::new(codes::DB_ERROR, format!("tags_json: {e}")))?;
    Ok(ProjectDto {
        id: r.id,
        location_id: r.location_id,
        name: r.name,
        path: r.path,
        stack: r.stack,
        runtime_hint: r.runtime_hint,
        favorite: r.favorite != 0,
        last_opened_at_ms: r.last_opened_at_ms,
        total_playtime_ms: r.total_playtime_ms,
        tasks,
        tags,
        github_owner: r.github_owner,
        github_repo: r.github_repo,
        file_count: r.file_count as u64,
        size_bytes: r.size_bytes as u64,
        last_edited_at_ms: r.last_edited_at_ms,
    })
}

pub async fn list_projects(pool: &Pool<Sqlite>) -> Result<Vec<ProjectDto>, StableError> {
    let rows: Vec<ProjectRow> = sqlx::query_as(
        "SELECT id, location_id, name, path, stack, runtime_hint, favorite, last_opened_at_ms, total_playtime_ms, tasks_json, tags_json, github_owner, github_repo, file_count, size_bytes, last_edited_at_ms FROM projects ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(row_to_dto(r)?);
    }
    Ok(out)
}

pub async fn get_project(pool: &Pool<Sqlite>, id: &str) -> Result<ProjectDto, StableError> {
    let row: Option<ProjectRow> = sqlx::query_as(
        "SELECT id, location_id, name, path, stack, runtime_hint, favorite, last_opened_at_ms, total_playtime_ms, tasks_json, tags_json, github_owner, github_repo, file_count, size_bytes, last_edited_at_ms FROM projects WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    match row {
        Some(r) => row_to_dto(r),
        None => Err(StableError::new(codes::NOT_FOUND, "project not found")),
    }
}

pub async fn delete_project(pool: &Pool<Sqlite>, id: &str) -> Result<(), StableError> {
    let r = sqlx::query("DELETE FROM projects WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    if r.rows_affected() == 0 {
        return Err(StableError::new(codes::NOT_FOUND, "project not found"));
    }
    Ok(())
}

pub async fn upsert_project(
    pool: &Pool<Sqlite>,
    dto: &ProjectDto,
) -> Result<ProjectDto, StableError> {
    let tasks_json = serde_json::to_string(&dto.tasks)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    let tags_json = serde_json::to_string(&dto.tags)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;

    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM projects WHERE location_id = ?1 AND path = ?2")
            .bind(&dto.location_id)
            .bind(&dto.path)
            .fetch_optional(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    let id = if let Some(eid) = existing {
        sqlx::query(
            r#"UPDATE projects SET name = ?1, stack = ?2, runtime_hint = ?3, tasks_json = ?4, tags_json = ?5, github_owner = ?6, github_repo = ?7, file_count = ?8, size_bytes = ?9, last_edited_at_ms = ?10
               WHERE id = ?11"#,
        )
        .bind(&dto.name)
        .bind(&dto.stack)
        .bind(&dto.runtime_hint)
        .bind(&tasks_json)
        .bind(&tags_json)
        .bind(&dto.github_owner)
        .bind(&dto.github_repo)
        .bind(dto.file_count as i64)
        .bind(dto.size_bytes as i64)
        .bind(dto.last_edited_at_ms)
        .bind(&eid)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        eid
    } else {
        let nid = if dto.id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            dto.id.clone()
        };
        sqlx::query(
            r#"INSERT INTO projects (
                id, location_id, name, path, stack, runtime_hint, favorite, last_opened_at_ms, total_playtime_ms, tasks_json, tags_json, github_owner, github_repo, file_count, size_bytes, last_edited_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"#,
        )
        .bind(&nid)
        .bind(&dto.location_id)
        .bind(&dto.name)
        .bind(&dto.path)
        .bind(&dto.stack)
        .bind(&dto.runtime_hint)
        .bind(if dto.favorite { 1 } else { 0 })
        .bind(dto.last_opened_at_ms)
        .bind(dto.total_playtime_ms)
        .bind(&tasks_json)
        .bind(&tags_json)
        .bind(&dto.github_owner)
        .bind(&dto.github_repo)
        .bind(dto.file_count as i64)
        .bind(dto.size_bytes as i64)
        .bind(dto.last_edited_at_ms)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        nid
    };

    get_project(pool, &id).await
}

pub async fn upsert_project_lightweight(
    pool: &Pool<Sqlite>,
    dto: &ProjectDto,
) -> Result<ProjectDto, StableError> {
    let tasks_json = serde_json::to_string(&dto.tasks)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    let tags_json = serde_json::to_string(&dto.tags)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;

    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM projects WHERE location_id = ?1 AND path = ?2")
            .bind(&dto.location_id)
            .bind(&dto.path)
            .fetch_optional(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    let id = if let Some(eid) = existing {
        // Preserve metadata: only update structural fields
        sqlx::query(
            r#"UPDATE projects SET name = ?1, stack = ?2, runtime_hint = ?3, tasks_json = ?4, tags_json = ?5, github_owner = ?6, github_repo = ?7
               WHERE id = ?8"#,
        )
        .bind(&dto.name)
        .bind(&dto.stack)
        .bind(&dto.runtime_hint)
        .bind(&tasks_json)
        .bind(&tags_json)
        .bind(&dto.github_owner)
        .bind(&dto.github_repo)
        .bind(&eid)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        eid
    } else {
        let nid = if dto.id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            dto.id.clone()
        };
        sqlx::query(
            r#"INSERT INTO projects (
                id, location_id, name, path, stack, runtime_hint, favorite, last_opened_at_ms, total_playtime_ms, tasks_json, tags_json, github_owner, github_repo, file_count, size_bytes, last_edited_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"#,
        )
        .bind(&nid)
        .bind(&dto.location_id)
        .bind(&dto.name)
        .bind(&dto.path)
        .bind(&dto.stack)
        .bind(&dto.runtime_hint)
        .bind(if dto.favorite { 1 } else { 0 })
        .bind(dto.last_opened_at_ms)
        .bind(dto.total_playtime_ms)
        .bind(&tasks_json)
        .bind(&tags_json)
        .bind(&dto.github_owner)
        .bind(&dto.github_repo)
        .bind(dto.file_count as i64)
        .bind(dto.size_bytes as i64)
        .bind(dto.last_edited_at_ms)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        nid
    };

    get_project(pool, &id).await
}

pub async fn update_project_path_and_location(
    pool: &Pool<Sqlite>,
    id: &str,
    path: &str,
    location_id: &str,
) -> Result<ProjectDto, StableError> {
    let _ = get_project(pool, id).await?;
    let path = path.to_string();
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM projects WHERE location_id = ?1 AND path = ?2")
            .bind(location_id)
            .bind(&path)
            .fetch_optional(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    if let Some(oid) = existing {
        if oid != id {
            return Err(StableError::new(
                codes::ALREADY_EXISTS,
                "another project already uses that path",
            ));
        }
    }
    sqlx::query("UPDATE projects SET path = ?1, location_id = ?2 WHERE id = ?3")
        .bind(&path)
        .bind(location_id)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_project(pool, id).await
}

pub async fn set_project_favorite(
    pool: &Pool<Sqlite>,
    id: &str,
    favorite: bool,
) -> Result<ProjectDto, StableError> {
    let _ = get_project(pool, id).await?;
    sqlx::query("UPDATE projects SET favorite = ?1 WHERE id = ?2")
        .bind(if favorite { 1 } else { 0 })
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_project(pool, id).await
}

pub async fn set_project_tag(
    pool: &Pool<Sqlite>,
    id: &str,
    tag: &str,
) -> Result<ProjectDto, StableError> {
    let project = get_project(pool, id).await?;
    let mut tags: HashSet<String> = project.tags.clone().into_iter().collect();
    if tags.insert(tag.to_string()) {
        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        sqlx::query("UPDATE projects SET tags_json = ?1 WHERE id = ?2")
            .bind(tags_json)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        get_project(pool, id).await
    } else {
        Ok(project)
    }
}

pub async fn remove_project_tag(
    pool: &Pool<Sqlite>,
    id: &str,
    tag: &str,
) -> Result<ProjectDto, StableError> {
    let project = get_project(pool, id).await?;
    let mut tags: HashSet<String> = project.tags.clone().into_iter().collect();
    if tags.remove(tag) {
        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
        sqlx::query("UPDATE projects SET tags_json = ?1 WHERE id = ?2")
            .bind(tags_json)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        get_project(pool, id).await
    } else {
        Ok(project)
    }
}

pub async fn touch_project_opened(
    pool: &Pool<Sqlite>,
    id: &str,
) -> Result<ProjectDto, StableError> {
    let now = super::now_ms();
    let _ = get_project(pool, id).await?;
    sqlx::query("UPDATE projects SET last_opened_at_ms = ?1 WHERE id = ?2")
        .bind(now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_project(pool, id).await
}

pub async fn update_project_tasks(
    pool: &Pool<Sqlite>,
    id: &str,
    tasks: &[TaskDto],
) -> Result<(), StableError> {
    let tasks_json = serde_json::to_string(tasks)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    sqlx::query("UPDATE projects SET tasks_json = ?1 WHERE id = ?2")
        .bind(&tasks_json)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn find_project_by_path(pool: &Pool<Sqlite>, path: &str) -> Result<ProjectDto, StableError> {
    let row: Option<ProjectRow> = sqlx::query_as(
        "SELECT id, location_id, name, path, stack, runtime_hint, favorite, last_opened_at_ms, total_playtime_ms, tasks_json, tags_json, github_owner, github_repo, file_count, size_bytes, last_edited_at_ms FROM projects WHERE path = ?1",
    )
    .bind(path)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    match row {
        Some(r) => row_to_dto(r),
        None => Err(StableError::new(codes::NOT_FOUND, "project not found at this path")),
    }
}

pub async fn delete_projects_for_location_not_in_paths(
    pool: &Pool<Sqlite>,
    location_id: &str,
    keep: &HashSet<String>,
) -> Result<u64, StableError> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, path FROM projects WHERE location_id = ?1")
            .bind(location_id)
            .fetch_all(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let mut n = 0u64;
    for (id, path) in rows {
        let still_valid = keep.contains(&path)
            || dunce::canonicalize(Path::new(&path))
                .map(|p| keep.contains(&p.to_string_lossy().to_string()))
                .unwrap_or(false);
        if still_valid {
            continue;
        }
        sqlx::query("DELETE FROM projects WHERE id = ?1")
            .bind(&id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        n += 1;
    }
    Ok(n)
}
