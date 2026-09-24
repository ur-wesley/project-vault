use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::Row;

pub fn normalize_sql(sql: &'static str) -> &'static str {
    if !sql.contains('\r') {
        return sql;
    }
    Box::leak(sql.replace("\r\n", "\n").into_boxed_str())
}

pub fn eol_checksum_fix(stored: &[u8], sql: &str) -> Option<Vec<u8>> {
    let expected = sql_checksum(sql);
    if stored == expected.as_slice() {
        return None;
    }
    let lf = sql.replace("\r\n", "\n");
    let crlf = lf.replace('\n', "\r\n");
    let alt = if sql.contains('\r') {
        sql_checksum(&lf)
    } else {
        sql_checksum(&crlf)
    };
    if stored == alt.as_slice() {
        Some(expected)
    } else {
        None
    }
}

pub fn default_sqlite_path() -> Option<std::path::PathBuf> {
    sqlite_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("project-vault.db"))
        .find(|path| path.is_file())
}

fn sqlite_dir_candidates() -> Vec<std::path::PathBuf> {
    const ID: &str = "io.w4y.project-vault";
    let mut dirs = Vec::new();
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(std::path::PathBuf::from(appdata).join(ID));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(
            std::path::PathBuf::from(home)
                .join("Library/Application Support")
                .join(ID),
        );
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
            dirs.push(std::path::PathBuf::from(config).join(ID));
        } else if let Some(home) = std::env::var_os("HOME") {
            dirs.push(std::path::PathBuf::from(home).join(".config").join(ID));
        }
        if let Some(data) = std::env::var_os("XDG_DATA_HOME") {
            dirs.push(std::path::PathBuf::from(data).join(ID));
        } else if let Some(home) = std::env::var_os("HOME") {
            dirs.push(std::path::PathBuf::from(home).join(".local/share").join(ID));
        }
    }
    dirs
}

pub fn repair_applied_migration_eols(migrations: &[(i64, &str)]) {
    let Some(path) = default_sqlite_path() else {
        return;
    };
    repair_applied_migration_eols_at(&path, migrations);
}

pub fn repair_applied_migration_eols_at(db_path: &Path, migrations: &[(i64, &str)]) {
    if !db_path.is_file() {
        return;
    }
    tauri::async_runtime::block_on(async {
        if let Err(e) = repair_applied_migration_eols_async(db_path, migrations).await {
            eprintln!("[sql] eol checksum repair failed: {e}");
        }
    });
}

fn sql_checksum(sql: &str) -> Vec<u8> {
    use sha2::{Digest, Sha384};
    Sha384::digest(sql.as_bytes()).to_vec()
}

async fn repair_applied_migration_eols_async(
    db_path: &Path,
    migrations: &[(i64, &str)],
) -> Result<(), String> {
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(false);
    let pool = SqlitePool::connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT version, checksum FROM _sqlx_migrations")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    for (version, sql) in migrations {
        let Some(stored) = rows.iter().find_map(|row| {
            let v: i64 = row.try_get("version").ok()?;
            (v == *version).then(|| row.try_get::<Vec<u8>, _>("checksum").ok())?
        }) else {
            continue;
        };
        let Some(fixed) = eol_checksum_fix(&stored, sql) else {
            continue;
        };
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2")
            .bind(&fixed)
            .bind(version)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LF: &str = "DELETE FROM t;\nCREATE INDEX i ON t (c);\n";
    const CRLF: &str = "DELETE FROM t;\r\nCREATE INDEX i ON t (c);\r\n";

    #[test]
    fn normalize_sql_strips_crlf() {
        assert_eq!(normalize_sql(CRLF), LF);
        assert!(std::ptr::eq(normalize_sql(LF), LF));
    }

    #[test]
    fn eol_checksum_fix_rewrites_crlf_to_lf() {
        let crlf_sum = sql_checksum(CRLF);
        let lf_sum = sql_checksum(LF);
        assert_ne!(crlf_sum, lf_sum);
        assert_eq!(
            eol_checksum_fix(&crlf_sum, LF).as_deref(),
            Some(lf_sum.as_slice())
        );
        assert_eq!(eol_checksum_fix(&lf_sum, LF), None);
        assert_eq!(eol_checksum_fix(&crlf_sum, CRLF), None);
        assert_eq!(
            eol_checksum_fix(&lf_sum, CRLF).as_deref(),
            Some(crlf_sum.as_slice())
        );
    }

    #[test]
    fn eol_checksum_fix_ignores_unrelated_hash() {
        assert_eq!(eol_checksum_fix(&[0u8; 48], LF), None);
    }
}
