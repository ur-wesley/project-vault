use std::path::Path;

use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};
use crate::models::LocationDto;

#[derive(sqlx::FromRow)]
struct LocationRow {
    id: String,
    path: String,
    name: String,
    sort_index: i32,
    enabled: i32,
    is_default: i32,
}

fn row_to_dto(r: LocationRow) -> LocationDto {
    LocationDto {
        id: r.id,
        path: r.path,
        name: r.name,
        sort_index: r.sort_index,
        enabled: r.enabled != 0,
        is_default: r.is_default != 0,
    }
}

pub async fn list_locations(pool: &Pool<Sqlite>) -> Result<Vec<LocationDto>, StableError> {
    let rows: Vec<LocationRow> = sqlx::query_as(
        "SELECT id, path, name, sort_index, enabled, is_default FROM locations ORDER BY sort_index ASC, name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn add_location(
    pool: &Pool<Sqlite>,
    path: String,
    name: String,
) -> Result<LocationDto, StableError> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "path is empty"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let max_sort: Option<i32> = sqlx::query_scalar("SELECT MAX(sort_index) FROM locations")
        .fetch_one(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let sort_index = max_sort.unwrap_or(-1) + 1;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM locations")
        .fetch_one(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    let is_default = if count == 0 { 1 } else { 0 };
    sqlx::query(
        "INSERT INTO locations (id, path, name, sort_index, enabled, is_default) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
    )
    .bind(&id)
    .bind(&path)
    .bind(&name)
    .bind(sort_index)
    .bind(is_default)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    get_location(pool, &id).await
}

pub async fn get_location(pool: &Pool<Sqlite>, id: &str) -> Result<LocationDto, StableError> {
    let row: Option<LocationRow> = sqlx::query_as(
        "SELECT id, path, name, sort_index, enabled, is_default FROM locations WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    row.map(row_to_dto)
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "location not found"))
}

pub async fn remove_location(pool: &Pool<Sqlite>, id: &str) -> Result<(), StableError> {
    let r = sqlx::query("DELETE FROM locations WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    if r.rows_affected() == 0 {
        return Err(StableError::new(codes::NOT_FOUND, "location not found"));
    }
    Ok(())
}

pub async fn update_location(
    pool: &Pool<Sqlite>,
    id: &str,
    path: Option<String>,
    name: Option<String>,
    sort_index: Option<i32>,
    enabled: Option<bool>,
    is_default: Option<bool>,
) -> Result<LocationDto, StableError> {
    let _ = get_location(pool, id).await?;
    if let Some(p) = path {
        let p = p.trim().to_string();
        if p.is_empty() {
            return Err(StableError::new(codes::INVALID_PATH, "path is empty"));
        }
        sqlx::query("UPDATE locations SET path = ?1 WHERE id = ?2")
            .bind(&p)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    if let Some(n) = name {
        sqlx::query("UPDATE locations SET name = ?1 WHERE id = ?2")
            .bind(&n)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    if let Some(s) = sort_index {
        sqlx::query("UPDATE locations SET sort_index = ?1 WHERE id = ?2")
            .bind(s)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    if let Some(e) = enabled {
        sqlx::query("UPDATE locations SET enabled = ?1 WHERE id = ?2")
            .bind(if e { 1 } else { 0 })
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    if let Some(true) = is_default {
        sqlx::query("UPDATE locations SET is_default = 0")
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        sqlx::query("UPDATE locations SET is_default = 1 WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    } else if let Some(false) = is_default {
        sqlx::query("UPDATE locations SET is_default = 0 WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    get_location(pool, id).await
}

pub async fn reorder_locations(
    pool: &Pool<Sqlite>,
    order: &[(String, i32)],
) -> Result<(), StableError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    for (id, sort_index) in order {
        sqlx::query("UPDATE locations SET sort_index = ?1 WHERE id = ?2")
            .bind(sort_index)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    tx.commit()
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn find_location_id_for_path(
    pool: &Pool<Sqlite>,
    path: &str,
) -> Result<String, StableError> {
    let child = dunce::canonicalize(Path::new(path))
        .map_err(|e| StableError::new(codes::INVALID_PATH, format!("invalid path: {e}")))?;
    let locs = list_locations(pool).await?;
    let mut best: Option<(String, usize)> = None;
    for loc in locs {
        let root = match dunce::canonicalize(Path::new(&loc.path)) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if child.starts_with(&root) {
            let n = root.as_os_str().len();
            if best.as_ref().map_or(true, |(_, b)| n > *b) {
                best = Some((loc.id, n));
            }
        }
    }
    best.map(|(id, _)| id).ok_or_else(|| {
        StableError::new(
            codes::INVALID_PATH,
            "the destination is not under any library folder. Add the folder in Library locations first.",
        )
    })
}
