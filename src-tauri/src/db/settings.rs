use sqlx::{Pool, Sqlite};

use crate::error::{codes, StableError};

pub async fn get_setting(pool: &Pool<Sqlite>, key: &str) -> Result<Option<String>, StableError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(row.map(|r| r.0))
}

pub async fn set_setting(pool: &Pool<Sqlite>, key: &str, value: &str) -> Result<(), StableError> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn list_settings(pool: &Pool<Sqlite>) -> Result<Vec<(String, String)>, StableError> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
            .fetch_all(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(rows)
}
