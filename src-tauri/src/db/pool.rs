use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::{Pool, Sqlite};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::db::DB_URL;
use crate::error::{codes, StableError};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn sqlite_pool(db: &DbInstances) -> Result<Pool<Sqlite>, StableError> {
    let guard = db.0.read().await;
    let pool = guard.get(DB_URL).ok_or_else(|| {
        StableError::new(
            codes::DB_ERROR,
            "database not loaded; check sql plugin preload config",
        )
    })?;
    match pool {
        DbPool::Sqlite(p) => Ok(p.clone()),
        #[allow(unreachable_patterns)]
        _ => Err(StableError::new(codes::INTERNAL, "expected sqlite pool")),
    }
}
