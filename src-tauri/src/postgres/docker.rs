use super::settings::*;

/// Pick a docker image for a PG version + extension set.
///
/// Custom image always wins (user takes over). Otherwise the combo matrix
/// picks the highest-priority bundled image; anything the image does NOT
/// bundle is reported by [`docker_image_warnings_for`] so the UI can tell
/// the user to install it manually or switch to a custom image.
pub fn docker_image_for(version: &str, extensions: &[String], custom: Option<&str>) -> String {
    if let Some(c) = custom {
        if !c.trim().is_empty() {
            return c.trim().to_string();
        }
    }
    let lower: Vec<String> = extensions.iter().map(|s| s.to_lowercase()).collect();
    let has = |id: &str| lower.iter().any(|e| e == id);
    let has_ts = has("timescale") || has("timescaledb");
    let has_gis = has("postgis");
    let has_vec = has("pgvector") || has("vector");
    if has_ts {
        return format!("timescale/timescaledb-ha:pg{version}");
    }
    if has_gis {
        return format!("postgis/postgis:{version}-3.4");
    }
    if has_vec {
        return format!("pgvector/pgvector:pg{version}");
    }
    format!("postgres:{version}")
}

/// Human-readable warnings for extensions the selected docker image does NOT
/// bundle. Empty when a custom image is set (user takes over) or when every
/// requested extension is either bundled by the image or a contrib module
/// installable via plain `CREATE EXTENSION`.
pub fn docker_image_warnings_for(
    version: &str,
    extensions: &[String],
    custom: Option<&str>,
) -> Vec<String> {
    if let Some(c) = custom {
        if !c.trim().is_empty() {
            return Vec::new();
        }
    }
    let lower: Vec<String> = extensions.iter().map(|s| s.to_lowercase()).collect();
    let has = |id: &str| lower.iter().any(|e| e == id);
    let has_ts = has("timescale") || has("timescaledb");
    let has_gis = has("postgis");
    let has_vec = has("pgvector") || has("vector");
    // Extensions installed via CREATE EXTENSION on any image need no warning.
    let mut unbundled: Vec<&str> = Vec::new();
    if has_ts && has_gis {
        unbundled.push("PostGIS");
    }
    if has_ts && has_vec {
        unbundled.push("pgvector");
    }
    if !has_ts && has_gis && has_vec {
        unbundled.push("pgvector");
    }
    // pg_cron has no docker_image in the registry: any docker cluster
    // requesting it needs a custom image or a manual install.
    if has("pg_cron") {
        unbundled.push("pg_cron");
    }
    if unbundled.is_empty() {
        return Vec::new();
    }
    let image = docker_image_for(version, extensions, None);
    vec![format!(
        "{image} does not bundle {list} — install manually after first start (Postgres: Install extension) or set a custom Docker image.",
        list = unbundled.join(" / ")
    )]
}

pub fn detect_docker() -> serde_json::Value {
    fn probe(args: &[&str]) -> Option<String> {
        let mut cmd = crate::process_util::hidden_command("docker");
        for a in args {
            cmd.arg(a);
        }
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
    let version = probe(&["--version"]);
    serde_json::json!({ "available": version.is_some(), "version": version })
}

pub(crate) fn docker_available() -> bool {
    let mut cmd = crate::process_util::hidden_command("docker");
    cmd.arg("--version");
    matches!(cmd.output(), Ok(o) if o.status.success())
}

pub(crate) fn docker_name(name: &str) -> String {
    format!("pv-pg-{name}")
}

/// Download URL for the EDB portable binaries zip of a major version.
pub fn edb_download_url(major: &str) -> Option<String> {
    let full = pinned_minor(major)?;
    let os_slug: &str = if cfg!(target_os = "windows") {
        "windows-x64"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux-x64"
    };
    Some(format!(
        "https://get.enterprisedb.com/postgresql/postgresql-{full}-{os_slug}-binaries.zip"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edb_url_shape_per_os() {
        let url = edb_download_url("16").unwrap();
        assert!(url.contains("16.4-1"));
        assert!(url.ends_with("-binaries.zip"));
        assert!(edb_download_url("99").is_none());
    }


    #[test]
    fn docker_image_selection_prefers_extensions() {
        assert!(docker_image_for("16", &["timescale".to_string()], None).contains("timescale"));
        assert!(docker_image_for("16", &["postgis".to_string()], None).contains("postgis"));
        assert!(docker_image_for("16", &["pgvector".to_string()], None).contains("pgvector"));
        assert!(docker_image_for("16", &[], None) == "postgres:16");
        assert!(docker_image_for("16", &[], Some("custom/img:1")) == "custom/img:1");
        // Combos resolve to the highest-priority bundled image …
        assert!(docker_image_for(
            "16",
            &["timescale".to_string(), "postgis".to_string()],
            None
        )
        .contains("timescale"));
        // … and custom images always win over the matrix.
        assert!(
            docker_image_for(
                "16",
                &["timescale".to_string(), "postgis".to_string()],
                Some("my-reg/combo:pg16")
            ) == "my-reg/combo:pg16"
        );
    }

    #[test]
    fn docker_image_warnings_cover_unbundled_combos() {
        // Contrib-only sets produce no warnings on any image.
        assert!(docker_image_warnings_for("16", &["pg_trgm".to_string()], None).is_empty());
        assert!(docker_image_warnings_for("16", &[], None).is_empty());
        // timescale+postgis: image bundles timescale, postgis needs manual install.
        let w = docker_image_warnings_for(
            "16",
            &["timescale".to_string(), "postgis".to_string()],
            None,
        );
        assert_eq!(w.len(), 1);
        assert!(w[0].contains("PostGIS"));
        // Custom image silences warnings — user takes over.
        assert!(docker_image_warnings_for(
            "16",
            &["timescale".to_string(), "postgis".to_string()],
            Some("my-reg/combo:pg16")
        )
        .is_empty());
        // pg_cron has no bundled docker image.
        let w = docker_image_warnings_for("16", &["pg_cron".to_string()], None);
        assert_eq!(w.len(), 1);
        assert!(w[0].contains("pg_cron"));
    }

}
