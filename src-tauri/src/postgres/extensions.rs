use serde::{Deserialize, Serialize};

use super::settings::*;

/// Installable Postgres extension descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub backends: Vec<String>,
    pub pg_versions: Vec<String>,
    pub docker_image: Option<String>,
    pub needs_shared_preload: bool,
    pub preload_lib: Option<String>,
    pub install_sql: String,
    pub portable_hint: String,
    /// "contrib" (ships with stock/EDB binaries, CREATE EXTENSION just works)
    /// or "third_party" (needs docker image or manual binary install).
    #[serde(default = "default_contrib_kind")]
    pub kind: String,
}

pub(crate) fn default_contrib_kind() -> String {
    "third_party".to_string()
}

pub(crate) fn all_pg_versions() -> Vec<String> {
    SUPPORTED_VERSIONS.iter().map(|v| v.to_string()).collect()
}

/// Helper for contrib extensions bundled with stock/EDB portable binaries:
/// work on both backends via plain `CREATE EXTENSION`, no docker image needed.
pub(crate) fn contrib(id: &str, label: &str, description: &str, sql: &str) -> ExtensionSpec {
    contrib_with_preload(id, label, description, sql, false, None)
}

pub(crate) fn contrib_with_preload(
    id: &str,
    label: &str,
    description: &str,
    sql: &str,
    needs_shared_preload: bool,
    preload_lib: Option<&str>,
) -> ExtensionSpec {
    ExtensionSpec {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        backends: vec!["portable".to_string(), "docker".to_string()],
        pg_versions: all_pg_versions(),
        docker_image: None,
        needs_shared_preload,
        preload_lib: preload_lib.map(|s| s.to_string()),
        install_sql: sql.to_string(),
        portable_hint: "Built in — ships with the portable binaries, no download needed.".to_string(),
        kind: "contrib".to_string(),
    }
}

pub(crate) fn third_party(
    id: &str,
    label: &str,
    description: &str,
    pg_versions: &[&str],
    docker_image: Option<&str>,
    needs_shared_preload: bool,
    preload_lib: Option<&str>,
    install_sql: &str,
    portable_hint: &str,
) -> ExtensionSpec {
    ExtensionSpec {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        backends: vec!["portable".to_string(), "docker".to_string()],
        pg_versions: pg_versions.iter().map(|v| v.to_string()).collect(),
        docker_image: docker_image.map(|s| s.to_string()),
        needs_shared_preload,
        preload_lib: preload_lib.map(|s| s.to_string()),
        install_sql: install_sql.to_string(),
        portable_hint: portable_hint.to_string(),
        kind: "third_party".to_string(),
    }
}

pub fn supported_extensions() -> Vec<ExtensionSpec> {
    let mut out = vec![
        third_party(
            "timescale",
            "TimescaleDB",
            "Time-series hypertables (needs shared_preload_libraries)",
            &["13", "14", "15", "16", "17"],
            Some("timescale/timescaledb-ha:pg{ver}"),
            true,
            Some("timescaledb"),
            "CREATE EXTENSION IF NOT EXISTS timescaledb;",
            "No official portable zip — prefer Docker backend, or place timescaledb binaries into versions/<ver>/ and retry. PG 18 not yet supported by TimescaleDB.",
        ),
        third_party(
            "postgis",
            "PostGIS",
            "Geospatial types + indexes",
            &["13", "14", "15", "16", "17", "18"],
            Some("postgis/postgis:{ver}-3.4"),
            false,
            None,
            "CREATE EXTENSION IF NOT EXISTS postgis;",
            "Unpack a matching PostGIS build into versions/<ver>/ (bin+lib+share), then retry.",
        ),
        third_party(
            "pgvector",
            "pgvector",
            "Vector similarity search",
            &["13", "14", "15", "16", "17", "18"],
            Some("pgvector/pgvector:pg{ver}"),
            false,
            None,
            "CREATE EXTENSION IF NOT EXISTS vector;",
            "Copy the pgvector build (vector.dll/.so + .control + .sql) into versions/<ver>/, then retry.",
        ),
        third_party(
            "pg_cron",
            "pg_cron",
            "Cron-based job scheduler (needs shared_preload_libraries)",
            &["13", "14", "15", "16", "17", "18"],
            None,
            true,
            Some("pg_cron"),
            "CREATE EXTENSION IF NOT EXISTS pg_cron;",
            "No official portable zip — use a custom docker image with pg_cron, or place the binaries into versions/<ver>/ and retry.",
        ),
    ];
    // Contrib extensions bundled with stock/EDB binaries — zero setup.
    out.push(contrib_with_preload(
        "pg_stat_statements",
        "pg_stat_statements",
        "Query execution statistics (needs shared_preload_libraries, restarts cluster)",
        "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
        true,
        Some("pg_stat_statements"),
    ));
    for (id, label, desc, sql) in [
        ("pg_trgm", "pg_trgm", "Trigram similarity search (LIKE / ILIKE / pg_trgm indexes)", "CREATE EXTENSION IF NOT EXISTS pg_trgm;"),
        ("pgcrypto", "pgcrypto", "Cryptographic functions (gen_random_uuid, digest, hmac)", "CREATE EXTENSION IF NOT EXISTS pgcrypto;"),
        ("uuid-ossp", "uuid-ossp", "UUID generation functions", "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"),
        ("hstore", "hstore", "Key-value store type", "CREATE EXTENSION IF NOT EXISTS hstore;"),
        ("citext", "citext", "Case-insensitive text type", "CREATE EXTENSION IF NOT EXISTS citext;"),
        ("btree_gin", "btree_gin", "GIN index support for scalar types", "CREATE EXTENSION IF NOT EXISTS btree_gin;"),
        ("btree_gist", "btree_gist", "GiST index support for scalar types", "CREATE EXTENSION IF NOT EXISTS btree_gist;"),
        ("cube", "cube", "Multidimensional cube type (required by earthdistance)", "CREATE EXTENSION IF NOT EXISTS cube;"),
        ("earthdistance", "earthdistance", "Great-circle distance on Earth (needs cube)", "CREATE EXTENSION IF NOT EXISTS cube; CREATE EXTENSION IF NOT EXISTS earthdistance;"),
        ("fuzzystrmatch", "fuzzystrmatch", "Fuzzy string matching (soundex, levenshtein)", "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"),
        ("ltree", "ltree", "Hierarchical tree-like data type", "CREATE EXTENSION IF NOT EXISTS ltree;"),
        ("tablefunc", "tablefunc", "Crosstab and table functions", "CREATE EXTENSION IF NOT EXISTS tablefunc;"),
        ("unaccent", "unaccent", "Accent-insensitive text search", "CREATE EXTENSION IF NOT EXISTS unaccent;"),
        ("intarray", "intarray", "Extra functions for one-dimensional int arrays", "CREATE EXTENSION IF NOT EXISTS intarray;"),
        ("isn", "isn", "ISBN/ISMN/ISSN/EAN product-number types", "CREATE EXTENSION IF NOT EXISTS isn;"),
        ("seg", "seg", "Segment (float-interval) data type", "CREATE EXTENSION IF NOT EXISTS seg;"),
        ("postgres_fdw", "postgres_fdw", "Foreign tables on remote Postgres servers", "CREATE EXTENSION IF NOT EXISTS postgres_fdw;"),
        ("file_fdw", "file_fdw", "Foreign tables backed by flat files", "CREATE EXTENSION IF NOT EXISTS file_fdw;"),
    ] {
        out.push(contrib(id, label, desc, sql));
    }
    out
}

pub fn extension_by_id(id: &str) -> Option<ExtensionSpec> {
    supported_extensions().into_iter().find(|e| e.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_registry_has_expected_ids() {
        let ids: Vec<String> = supported_extensions().iter().map(|e| e.id.clone()).collect();
        for id in [
            "timescale",
            "postgis",
            "pgvector",
            "pg_cron",
            "pg_stat_statements",
            "pg_trgm",
            "pgcrypto",
            "uuid-ossp",
            "hstore",
            "citext",
            "btree_gin",
            "btree_gist",
            "cube",
            "earthdistance",
            "fuzzystrmatch",
            "ltree",
            "tablefunc",
            "unaccent",
            "intarray",
            "isn",
            "seg",
            "postgres_fdw",
            "file_fdw",
        ] {
            assert!(ids.contains(&id.to_string()), "missing extension '{id}'");
        }
    }

    #[test]
    fn contrib_specs_need_no_docker_image() {
        for spec in supported_extensions().iter().filter(|e| e.kind == "contrib") {
            assert!(spec.docker_image.is_none(), "{} must not pin a docker image", spec.id);
            assert!(
                spec.backends.contains(&"portable".to_string()),
                "{} must support portable",
                spec.id
            );
            assert!(!spec.install_sql.trim().is_empty(), "{} needs install_sql", spec.id);
        }
    }

}
