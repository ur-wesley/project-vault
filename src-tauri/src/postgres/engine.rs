use std::path::Path;

use super::clusters::*;
use super::extensions::*;
use super::records::*;
use super::settings::*;
use super::versions::*;

/// Record extension intent + patch shared_preload + CREATE EXTENSION.
/// `ext_id` is timescale|postgis|pgvector or `custom:<extname>`.
/// `custom_sql` overrides the install statement (for custom builds).
pub async fn install_extension(
    app_data: &Path,
    target: &str,
    ext_id: &str,
    database: &str,
    custom_sql: Option<&str>,
) -> Result<QueryResult, String> {
    let ext = ext_id.trim().to_lowercase();
    if ext.is_empty() {
        return Err("extension id must not be empty".to_string());
    }
    let (spec, sql) = if ext.starts_with("custom:") {
        let name = ext.trim_start_matches("custom:").trim();
        if name.is_empty() {
            return Err("custom extension name missing (use custom:<name>)".to_string());
        }
        let stmt = custom_sql
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("CREATE EXTENSION IF NOT EXISTS \"{name}\";"));
        (None, stmt)
    } else if let Some(s) = extension_by_id(&ext) {
        let stmt = custom_sql.map(|s| s.to_string()).unwrap_or(s.install_sql.clone());
        (Some(s), stmt)
    } else {
        return Err(format!("unknown extension '{ext_id}'"));
    };

    // Resolve target to a cluster record when managed (for conf patch + intent).
    let cluster_name: Option<String> = if let Some(n) = target.strip_prefix("cluster:") {
        Some(n.to_string())
    } else if !target.starts_with("ext:") {
        Some(target.to_string())
    } else {
        None
    };

    if let Some(cname) = cluster_name.clone() {
        if let Ok(mut rec) = read_record(app_data, &cname) {
            let norm = if ext.starts_with("custom:") { ext.clone() } else { spec.as_ref().unwrap().id.clone() };
            if !rec.extensions.iter().any(|e| e == &norm) {
                rec.extensions.push(norm);
                let _ = write_record(app_data, &rec);
            }
            if let Some(s) = spec.as_ref() {
                if s.needs_shared_preload {
                    if let Some(lib) = &s.preload_lib {
                        let was_running = cluster_status(app_data, &rec.name).map(|st| st.running).unwrap_or(false);
                        let changed = ensure_shared_preload(&rec.data_dir, &[lib.clone()]).unwrap_or(false);
                        if changed && was_running && rec.backend() == "portable" {
                            let _ = stop_cluster(app_data, &rec.name).await;
                            let _ = start_cluster(app_data, &rec.name).await;
                        }
                    }
                }
            }
        }
    }

    check_select_only(&format!("SELECT 1"))?; // keep guard linked (no-op sanity)
    let ep = endpoint_for(app_data, resolve_target(app_data, target, None)?)?;
    let mut res = psql_csv_endpoint(&ep, database, &sql).await.map_err(|e| {
        if let Some(s) = spec.as_ref() {
            format!("{e}\nHint (portable): {}", s.portable_hint)
        } else {
            e
        }
    })?;
    truncate_cells(&mut res);
    Ok(res)
}

// ─── SQL via the version's own psql ─────────────────────────────────────────

pub(crate) fn psql_csv_args(ep: &Endpoint, database: &str, sql: &str) -> Vec<String> {
    vec![
        "-h".to_string(),
        ep.host.clone(),
        "-p".to_string(),
        ep.port.to_string(),
        "-U".to_string(),
        ep.user.clone(),
        "-d".to_string(),
        database.to_string(),
        "-v".to_string(),
        "ON_ERROR_STOP=1".to_string(),
        "--csv".to_string(),
        "-c".to_string(),
        format!("SET statement_timeout = '8s'; {sql}"),
    ]
}

pub(crate) async fn psql_csv_endpoint(
    ep: &Endpoint,
    database: &str,
    sql: &str,
) -> Result<QueryResult, String> {
    let args = psql_csv_args(ep, database, sql);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_tool(&ep.exe, &arg_refs, &[("PGPASSWORD", ep.password.as_str())]).await?;
    if !out.status.success() {
        return Err(format!(
            "query failed: {}",
            out_text(&out).trim().chars().take(800).collect::<String>()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    // psql prints "SET" as a bare tag line before the real CSV table because
    // we prefix every statement with SET statement_timeout.
    Ok(parse_csv_tables(&stdout))
}

/// Parse possibly-multiple CSV tables from one psql invocation; the LAST
/// table is the query result (earlier ones come from SET wrappers).
pub(crate) fn parse_csv_tables(stdout: &str) -> QueryResult {
    // psql prints "SET" as a bare line (no comma) before the real CSV table
    // because we prefix every statement with SET statement_timeout.
    let mut lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    if !lines.is_empty() && !lines[0].contains(',') && lines.len() > 1 {
        lines.remove(0); // drop "SET" tag line
    }
    let mut cols: Vec<String> = Vec::new();
    let mut out_rows: Vec<Vec<String>> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let f = parse_csv_line(line);
        if i == 0 {
            cols = f;
        } else {
            out_rows.push(f);
        }
    }
    let row_count = out_rows.len();
    QueryResult {
        columns: cols,
        rows: out_rows,
        row_count,
        truncated: false,
    }
}

/// Minimal CSV line parser (RFC4180 quotes with "" escapes).
pub(crate) fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cur.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            fields.push(std::mem::take(&mut cur));
        } else {
            cur.push(c);
        }
    }
    fields.push(cur);
    fields
}

/// Client+server guard: only read-only statements allowed.
pub fn check_select_only(sql: &str) -> Result<(), String> {
    let mut t = sql.trim();
    // Strip leading SQL comments.
    while t.starts_with("--") || t.starts_with("/*") {
        if let Some(rest) = t.strip_prefix("--") {
            t = rest
                .split('\n')
                .skip(1)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
                .leak();
        } else if let Some(end) = t.find("*/") {
            t = t[end + 2..].trim();
        } else {
            break;
        }
    }
    let up = t.to_ascii_uppercase();
    let ok_start = up.starts_with("SELECT")
        || up.starts_with("WITH")
        || up.starts_with("EXPLAIN")
        || up.starts_with("VALUES")
        || up.starts_with("TABLE ");
    if !ok_start {
        return Err("only SELECT / WITH / EXPLAIN / VALUES queries are allowed".to_string());
    }
    // Reject stacked statements (a semicolon not at the very end).
    let mut in_s = false;
    let mut in_d = false;
    let chars: Vec<char> = t.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if *c == '\'' && !in_d {
            in_s = !in_s;
        } else if *c == '"' && !in_s {
            in_d = !in_d;
        } else if *c == ';' && !in_s && !in_d && i + 1 < chars.len() {
            let rest: String = chars[i + 1..].iter().collect();
            if !rest.trim().is_empty() {
                return Err("multiple statements are not allowed".to_string());
            }
        }
    }
    let forbidden = [
        " INTO ",
        " INFILE ",
        " OUTFILE ",
        "COPY ",
        "\\COPY",
        "LOAD ",
        "IMPORT ",
    ];
    for f in forbidden {
        if up.contains(f) {
            return Err(format!(
                "forbidden keyword in read-only query: {}",
                f.trim()
            ));
        }
    }
    Ok(())
}

pub(crate) fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

pub(crate) fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub(crate) fn truncate_cells(res: &mut QueryResult) {
    for row in &mut res.rows {
        for cell in row {
            if cell.len() > 256 {
                cell.truncate(256);
                cell.push_str("…");
            }
        }
    }
}

/// Target-aware queries. `target` is `cluster:<name>` or `ext:<id>`
/// (bare cluster names still work). `password` is only used for externals.
pub async fn list_databases(
    app_data: &Path,
    target: &str,
    password: Option<&str>,
) -> Result<QueryResult, String> {
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    psql_csv_endpoint(
        &ep,
        "postgres",
        "SELECT datname AS database, pg_size_pretty(pg_database_size(datname)) AS size \
         FROM pg_database WHERE datistemplate = false ORDER BY datname",
    )
    .await
}

pub async fn list_tables(
    app_data: &Path,
    target: &str,
    database: &str,
    schema: &str,
    password: Option<&str>,
) -> Result<QueryResult, String> {
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    let sql = format!(
        "SELECT t.tablename AS table_name, t.schemaname AS schema, \
          pg_size_pretty(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))) AS size, \
          (SELECT c.reltuples::bigint FROM pg_class c \
           JOIN pg_namespace n ON n.oid = c.relnamespace \
           WHERE c.relname = t.tablename AND n.nspname = t.schemaname) AS rows_est \
         FROM pg_tables t WHERE t.schemaname = {} ORDER BY t.tablename",
        quote_literal(schema)
    );
    psql_csv_endpoint(&ep, database, &sql).await
}

pub async fn preview_table(
    app_data: &Path,
    target: &str,
    database: &str,
    schema: &str,
    table: &str,
    limit: i64,
    offset: i64,
    password: Option<&str>,
) -> Result<QueryResult, String> {
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    let limit = limit.clamp(1, 200);
    let offset = offset.max(0);
    let sql = format!(
        "SELECT * FROM {}.{} LIMIT {limit} OFFSET {offset}",
        quote_ident(schema),
        quote_ident(table)
    );
    let mut res = psql_csv_endpoint(&ep, database, &sql).await?;
    // Truncate overlong cells for the 256KB store budget.
    truncate_cells(&mut res);
    res.row_count = res.rows.len();
    res.truncated = res.rows.len() as i64 >= limit;
    Ok(res)
}

pub async fn run_select(
    app_data: &Path,
    target: &str,
    database: &str,
    sql: &str,
    limit: i64,
    password: Option<&str>,
) -> Result<QueryResult, String> {
    check_select_only(sql)?;
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    let limit = limit.clamp(1, 200);
    let wrapped = format!(
        "SELECT * FROM ({}) AS _q LIMIT {limit}",
        sql.trim().trim_end_matches(';')
    );
    let mut res = psql_csv_endpoint(&ep, database, &wrapped).await?;
    truncate_cells(&mut res);
    res.row_count = res.rows.len();
    res.truncated = res.rows.len() as i64 >= limit;
    Ok(res)
}

// ─── Database / table management (write path) ──────────────────────────────
// These statements are built internally with quoted identifiers only — no
// user SQL passes through here, so the SELECT-only guard does not apply.

/// Strict identifier check for database/schema/table names created or
/// dropped through the management actions.
pub(crate) fn validate_db_object_name(name: &str, what: &str) -> Result<String, String> {
    let t = name.trim();
    if t.is_empty() || t.len() > 63 {
        return Err(format!("{what} name must be 1–63 characters"));
    }
    let mut chars = t.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => {
            return Err(format!(
                "{what} name must start with a letter or underscore"
            ))
        }
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        return Err(format!(
            "{what} name may only contain letters, digits, _ and $"
        ));
    }
    Ok(t.to_string())
}

/// Run one internally-built write statement (no result rows expected).
pub(crate) async fn psql_exec_endpoint(ep: &Endpoint, database: &str, sql: &str) -> Result<String, String> {
    let args = vec![
        "-h".to_string(),
        ep.host.clone(),
        "-p".to_string(),
        ep.port.to_string(),
        "-U".to_string(),
        ep.user.clone(),
        "-d".to_string(),
        database.to_string(),
        "-v".to_string(),
        "ON_ERROR_STOP=1".to_string(),
        "-t".to_string(),
        "-A".to_string(),
        "-c".to_string(),
        format!("SET statement_timeout = '30s'; {sql}"),
    ];
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_tool(&ep.exe, &arg_refs, &[("PGPASSWORD", ep.password.as_str())]).await?;
    if !out.status.success() {
        return Err(format!(
            "statement failed: {}",
            out_text(&out).trim().chars().take(800).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub async fn create_database(
    app_data: &Path,
    target: &str,
    name: &str,
    password: Option<&str>,
) -> Result<String, String> {
    let name = validate_db_object_name(name, "Database")?;
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    psql_exec_endpoint(
        &ep,
        "postgres",
        &format!("CREATE DATABASE {}", quote_ident(&name)),
    )
    .await?;
    Ok(format!("database {name} created"))
}

pub(crate) fn check_drop_database_allowed(name: &str) -> Result<String, String> {
    let name = validate_db_object_name(name, "Database")?;
    let lower = name.to_lowercase();
    if lower == "template0" || lower == "template1" {
        return Err(format!("refusing to drop template database '{name}'"));
    }
    if lower == "postgres" {
        return Err(
            "refusing to drop the 'postgres' maintenance database — the plugin connects through it"
                .to_string(),
        );
    }
    Ok(name)
}

pub async fn drop_database(
    app_data: &Path,
    target: &str,
    name: &str,
    password: Option<&str>,
) -> Result<String, String> {
    let name = check_drop_database_allowed(name)?;
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    psql_exec_endpoint(&ep, "postgres", &format!("DROP DATABASE {}", quote_ident(&name)))
        .await
        .map_err(|e| {
            if e.to_lowercase().contains("being accessed") {
                format!("{e}\nHint: close other connections to '{name}' (disconnect clients, stop apps) and retry")
            } else {
                e
            }
        })?;
    Ok(format!("database {name} dropped"))
}

pub async fn drop_table(
    app_data: &Path,
    target: &str,
    database: &str,
    schema: &str,
    table: &str,
    password: Option<&str>,
) -> Result<String, String> {
    let schema = validate_db_object_name(schema, "Schema")?;
    let table = validate_db_object_name(table, "Table")?;
    let ep = endpoint_for(app_data, resolve_target(app_data, target, password)?)?;
    psql_exec_endpoint(
        &ep,
        database,
        &format!(
            "DROP TABLE {}.{}",
            quote_ident(&schema),
            quote_ident(&table)
        ),
    )
    .await?;
    Ok(format!("table {schema}.{table} dropped"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_object_names_are_validated() {
        assert!(validate_db_object_name("mydb", "Database").is_ok());
        assert!(validate_db_object_name("_lead", "Database").is_ok());
        assert!(validate_db_object_name("a$b1", "Database").is_ok());
        assert!(validate_db_object_name("", "Database").is_err());
        assert!(validate_db_object_name("1abc", "Database").is_err());
        assert!(validate_db_object_name("has space", "Database").is_err());
        assert!(validate_db_object_name("semi;colon", "Table").is_err());
        assert!(validate_db_object_name("quo\"te", "Table").is_err());
        assert!(validate_db_object_name(&"x".repeat(64), "Database").is_err());
    }

    #[test]
    fn drop_database_refuses_system_dbs() {
        // Guard runs before any connection attempt (no server needed).
        for protected in ["template0", "TEMPLATE1", "postgres", "Postgres"] {
            assert!(
                check_drop_database_allowed(protected).is_err(),
                "{protected} must be refused"
            );
        }
        assert!(check_drop_database_allowed("1bad").is_err());
        assert_eq!(check_drop_database_allowed("mydb").unwrap(), "mydb");
    }


    #[test]
    fn select_guard_allows_reads_rejects_writes() {
        assert!(check_select_only("SELECT 1").is_ok());
        assert!(check_select_only("  with x as (select 1) select * from x").is_ok());
        assert!(check_select_only("EXPLAIN SELECT 1").is_ok());
        assert!(check_select_only("-- comment\nSELECT 2").is_ok());
        assert!(check_select_only("DELETE FROM t").is_err());
        assert!(check_select_only("DROP TABLE t").is_err());
        assert!(check_select_only("SELECT 1; DELETE FROM t").is_err());
        assert!(check_select_only("SELECT * INTO t FROM u").is_err());
        assert!(check_select_only("COPY t TO '/tmp/x'").is_err());
    }

    #[test]
    fn csv_parser_handles_quotes_and_commas() {
        assert_eq!(parse_csv_line("a,b,c"), vec!["a", "b", "c"]);
        assert_eq!(
            parse_csv_line("\"a,b\",\"c\"\"d\",e"),
            vec!["a,b", "c\"d", "e"]
        );
    }

    #[test]
    fn csv_tables_skip_set_tag_line() {
        let res = parse_csv_tables("SET\nid,name\n1,alice\n");
        assert_eq!(res.columns, vec!["id", "name"]);
        assert_eq!(res.row_count, 1);
    }

}
