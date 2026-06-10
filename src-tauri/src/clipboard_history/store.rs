use std::path::{Path, PathBuf};

use serde_json;
use sqlx::{Pool, Sqlite};
use uuid::Uuid;

use crate::db;
use crate::error::{codes, StableError};

use super::types::{
    truncate_preview, ClipboardEntryDto, ClipboardEntryKind, ClipboardEntryMeta,
    ClipboardHistorySettingsDto, DEFAULT_DEDUP_SECONDS, DEFAULT_MAX_ENTRIES,
    DEFAULT_MAX_IMAGE_BYTES, MAX_TEXT_BYTES, SETTING_DEDUP_SECONDS, SETTING_ENABLED,
    SETTING_MAX_ENTRIES, SETTING_MAX_IMAGE_BYTES, SETTING_SHOW_SOURCE,
};

#[derive(sqlx::FromRow)]
struct Row {
    id: String,
    kind: String,
    preview: String,
    content_text: Option<String>,
    content_hash: String,
    payload_path: Option<String>,
    meta_json: String,
    source_app: Option<String>,
    pinned: i64,
    created_at_ms: i64,
}

fn row_to_dto(row: Row) -> ClipboardEntryDto {
    let meta: ClipboardEntryMeta =
        serde_json::from_str(&row.meta_json).unwrap_or_default();
    ClipboardEntryDto {
        id: row.id,
        kind: row.kind,
        preview: row.preview,
        content_text: row.content_text,
        content_hash: row.content_hash,
        payload_path: row.payload_path,
        meta,
        source_app: row.source_app,
        pinned: row.pinned != 0,
        created_at_ms: row.created_at_ms,
    }
}

pub async fn load_settings(pool: &Pool<Sqlite>) -> Result<ClipboardHistorySettingsDto, StableError> {
    let enabled = parse_bool_setting(
        db::get_setting(pool, SETTING_ENABLED).await?,
        true,
    );
    let max_entries = parse_u32_setting(
        db::get_setting(pool, SETTING_MAX_ENTRIES).await?,
        DEFAULT_MAX_ENTRIES,
    );
    let max_image_bytes = parse_u64_setting(
        db::get_setting(pool, SETTING_MAX_IMAGE_BYTES).await?,
        DEFAULT_MAX_IMAGE_BYTES,
    );
    let dedup_seconds = parse_u64_setting(
        db::get_setting(pool, SETTING_DEDUP_SECONDS).await?,
        DEFAULT_DEDUP_SECONDS,
    );
    let show_source = parse_bool_setting(
        db::get_setting(pool, SETTING_SHOW_SOURCE).await?,
        true,
    );
    Ok(ClipboardHistorySettingsDto {
        enabled,
        max_entries,
        max_image_bytes,
        dedup_seconds,
        show_source,
    })
}

pub async fn save_settings(
    pool: &Pool<Sqlite>,
    settings: &ClipboardHistorySettingsDto,
) -> Result<(), StableError> {
    db::set_setting(pool, SETTING_ENABLED, if settings.enabled { "true" } else { "false" }).await?;
    let max_entries = settings.max_entries.to_string();
    db::set_setting(pool, SETTING_MAX_ENTRIES, &max_entries).await?;
    let max_image = settings.max_image_bytes.to_string();
    db::set_setting(pool, SETTING_MAX_IMAGE_BYTES, &max_image).await?;
    let dedup = settings.dedup_seconds.to_string();
    db::set_setting(pool, SETTING_DEDUP_SECONDS, &dedup).await?;
    db::set_setting(
        pool,
        SETTING_SHOW_SOURCE,
        if settings.show_source { "true" } else { "false" },
    )
    .await?;
    Ok(())
}

fn parse_bool_setting(value: Option<String>, default: bool) -> bool {
    value
        .map(|v| v == "true" || v == "1")
        .unwrap_or(default)
}

fn parse_u32_setting(value: Option<String>, default: u32) -> u32 {
    value
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
        .max(1)
}

fn parse_u64_setting(value: Option<String>, default: u64) -> u64 {
    value.and_then(|v| v.parse().ok()).unwrap_or(default)
}

pub fn blobs_dir(app_data: &Path) -> PathBuf {
    app_data.join("clipboard-history").join("blobs")
}

pub async fn list_entries(
    pool: &Pool<Sqlite>,
    query: Option<&str>,
    kind: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<Vec<ClipboardEntryDto>, StableError> {
    let rows: Vec<Row> = if let Some(q) = query.filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", q.trim());
        if let Some(k) = kind.filter(|s| !s.is_empty() && *s != "all") {
            sqlx::query_as(
                "SELECT id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms
                 FROM clipboard_history
                 WHERE kind = ?1 AND (preview LIKE ?2 OR content_text LIKE ?2)
                 ORDER BY pinned DESC, created_at_ms DESC
                 LIMIT ?3 OFFSET ?4",
            )
            .bind(k)
            .bind(&pattern)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as(
                "SELECT id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms
                 FROM clipboard_history
                 WHERE preview LIKE ?1 OR content_text LIKE ?1
                 ORDER BY pinned DESC, created_at_ms DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .bind(&pattern)
            .bind(limit as i64)
            .bind(offset as i64)
            .fetch_all(pool)
            .await
        }
    } else if let Some(k) = kind.filter(|s| !s.is_empty() && *s != "all") {
        sqlx::query_as(
            "SELECT id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms
             FROM clipboard_history
             WHERE kind = ?1
             ORDER BY pinned DESC, created_at_ms DESC
             LIMIT ?2 OFFSET ?3",
        )
        .bind(k)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            "SELECT id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms
             FROM clipboard_history
             ORDER BY pinned DESC, created_at_ms DESC
             LIMIT ?1 OFFSET ?2",
        )
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        if !seen.insert(row.content_hash.clone()) {
            continue;
        }
        out.push(row_to_dto(row));
    }
    Ok(out)
}

pub async fn get_entry(pool: &Pool<Sqlite>, id: &str) -> Result<Option<ClipboardEntryDto>, StableError> {
    let row: Option<Row> = sqlx::query_as(
        "SELECT id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms
         FROM clipboard_history WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(row.map(row_to_dto))
}

pub async fn delete_entry(pool: &Pool<Sqlite>, id: &str, app_data: &Path) -> Result<(), StableError> {
    if let Some(entry) = get_entry(pool, id).await? {
        if let Some(rel) = entry.payload_path {
            let path = app_data.join(rel);
            let _ = std::fs::remove_file(path);
        }
    }
    sqlx::query("DELETE FROM clipboard_history WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn clear_entries(
    pool: &Pool<Sqlite>,
    app_data: &Path,
    keep_pinned: bool,
) -> Result<(), StableError> {
    let rows: Vec<(String, Option<String>)> = if keep_pinned {
        sqlx::query_as(
            "SELECT id, payload_path FROM clipboard_history WHERE pinned = 0",
        )
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as("SELECT id, payload_path FROM clipboard_history")
            .fetch_all(pool)
            .await
    }
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    for (_, payload_path) in &rows {
        if let Some(rel) = payload_path {
            let _ = std::fs::remove_file(app_data.join(rel));
        }
    }

    if keep_pinned {
        sqlx::query("DELETE FROM clipboard_history WHERE pinned = 0")
            .execute(pool)
            .await
    } else {
        sqlx::query("DELETE FROM clipboard_history")
            .execute(pool)
            .await
    }
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn toggle_pin(pool: &Pool<Sqlite>, id: &str) -> Result<(), StableError> {
    sqlx::query(
        "UPDATE clipboard_history SET pinned = CASE WHEN pinned = 0 THEN 1 ELSE 0 END WHERE id = ?1",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn update_text_entry(
    pool: &Pool<Sqlite>,
    id: &str,
    text: &str,
) -> Result<(), StableError> {
    let entry = get_entry(pool, id)
        .await?
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "clipboard entry not found"))?;
    if entry.kind != ClipboardEntryKind::Text.as_str()
        && entry.kind != ClipboardEntryKind::Html.as_str()
    {
        return Err(StableError::new(
            codes::INTERNAL,
            "only text entries can be edited",
        ));
    }
    let bounded: String = text.chars().take(MAX_TEXT_BYTES).collect();
    let preview = truncate_preview(&bounded, 120);
    let hash = format!("{:x}", md5_hash(bounded.as_bytes()));
    sqlx::query(
        "UPDATE clipboard_history SET content_text = ?1, preview = ?2, content_hash = ?3, created_at_ms = ?4 WHERE id = ?5",
    )
    .bind(&bounded)
    .bind(&preview)
    .bind(&hash)
    .bind(db::now_ms())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    Ok(())
}

pub async fn touch_duplicate(
    pool: &Pool<Sqlite>,
    content_hash: &str,
    _dedup_seconds: u64,
) -> Result<Option<String>, StableError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM clipboard_history WHERE content_hash = ?1 ORDER BY created_at_ms DESC LIMIT 1",
    )
    .bind(content_hash)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    if let Some((id,)) = row {
        let now = db::now_ms();
        sqlx::query("UPDATE clipboard_history SET created_at_ms = ?1 WHERE id = ?2")
            .bind(now)
            .bind(&id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        sqlx::query("DELETE FROM clipboard_history WHERE content_hash = ?1 AND id != ?2")
            .bind(content_hash)
            .bind(&id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
        return Ok(Some(id));
    }
    Ok(None)
}

pub async fn insert_entry(
    pool: &Pool<Sqlite>,
    app_data: &Path,
    kind: ClipboardEntryKind,
    content_text: Option<String>,
    content_hash: String,
    payload_rel: Option<String>,
    meta: ClipboardEntryMeta,
    preview: String,
    source_app: Option<String>,
    max_entries: u32,
) -> Result<ClipboardEntryDto, StableError> {
    let id = Uuid::new_v4().to_string();
    let now = db::now_ms();
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;

    sqlx::query(
        "INSERT INTO clipboard_history (id, kind, preview, content_text, content_hash, payload_path, meta_json, source_app, pinned, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
    )
    .bind(&id)
    .bind(kind.as_str())
    .bind(&preview)
    .bind(&content_text)
    .bind(&content_hash)
    .bind(&payload_rel)
    .bind(&meta_json)
    .bind(&source_app)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    prune_old_entries(pool, app_data, max_entries).await?;

    get_entry(pool, &id)
        .await?
        .ok_or_else(|| StableError::new(codes::INTERNAL, "failed to read inserted entry"))
}

async fn prune_old_entries(
    pool: &Pool<Sqlite>,
    app_data: &Path,
    max_entries: u32,
) -> Result<(), StableError> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM clipboard_history")
        .fetch_one(pool)
        .await
        .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    if count.0 <= max_entries as i64 {
        return Ok(());
    }

    let excess = count.0 - max_entries as i64;
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, payload_path FROM clipboard_history WHERE pinned = 0 ORDER BY created_at_ms ASC LIMIT ?1",
    )
    .bind(excess)
    .fetch_all(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;

    for (id, payload_path) in rows {
        if let Some(rel) = payload_path {
            let _ = std::fs::remove_file(app_data.join(rel));
        }
        sqlx::query("DELETE FROM clipboard_history WHERE id = ?1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    }
    Ok(())
}

pub fn md5_hash(data: &[u8]) -> u128 {
    fnv1a64(data)
}

fn fnv1a64(data: &[u8]) -> u128 {
    const FNV_OFFSET: u128 = 0xcbf29ce484222325;
    const FNV_PRIME: u128 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in data {
        hash ^= *byte as u128;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

pub fn ensure_blobs_dir(app_data: &Path) -> Result<PathBuf, StableError> {
    let dir = blobs_dir(app_data);
    std::fs::create_dir_all(&dir)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to create blobs dir: {e}")))?;
    Ok(dir)
}

pub fn entry_thumbnail_data_url(
    app_data: &Path,
    entry: &ClipboardEntryDto,
    max_size: u32,
) -> Result<Option<String>, StableError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::{ImageBuffer, RgbaImage};

    if entry.kind != "image" {
        return Ok(None);
    }
    let rel = match &entry.payload_path {
        Some(path) => path,
        None => return Ok(None),
    };

    let full = app_data.join(rel);
    let bytes = std::fs::read(&full).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("read clipboard image blob: {e}"))
    })?;

    let width = entry.meta.width.unwrap_or(1).max(1);
    let height = entry.meta.height.unwrap_or(1).max(1);
    let img: RgbaImage = ImageBuffer::from_raw(width, height, bytes).ok_or_else(|| {
        StableError::new(codes::INTERNAL, "invalid clipboard rgba image dimensions")
    })?;

    let thumb = image::imageops::thumbnail(&img, max_size, max_size);
    let mut png = Vec::new();
    thumb
        .write_to(
            &mut std::io::Cursor::new(&mut png),
            image::ImageFormat::Png,
        )
        .map_err(|e| StableError::new(codes::INTERNAL, format!("encode thumbnail: {e}")))?;

    Ok(Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png)
    )))
}
