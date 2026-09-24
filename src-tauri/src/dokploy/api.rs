use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db;
use crate::error::{codes, StableError};

use super::dto::DokployServerEntry;

pub const DOKPLOY_URL_SETTING_KEY: &str = "dokploy_url";
pub const DOKPLOY_API_KEY_SETTING_KEY: &str = "dokploy_api_key";
/// JSON list of `{ id, name, url, apiKey }` — the multi-server store.
/// Legacy single-pair keys above remain as a read fallback.
pub const DOKPLOY_SERVERS_SETTING_KEY: &str = "dokploy_servers";

/// Bump when the Dokploy command surface changes incompatibly.
/// The frontend compares against its own expectation and shows a
/// "rebuild/restart the app" banner on mismatch.
pub const DOKPLOY_API_VERSION: u32 = 4;

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

pub(crate) fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client")
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DokployConnection {
    pub id: String,
    pub name: String,
    pub url: String,
    pub api_key: String,
}

pub(crate) fn normalize_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

pub(crate) fn default_server_name(url: &str) -> String {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host = without_scheme.split('/').next().unwrap_or(without_scheme);
    if host.is_empty() {
        url.to_string()
    } else {
        host.to_string()
    }
}

pub(crate) fn connection_from_entry(
    id: &str,
    name: &str,
    url: &str,
    api_key: &str,
) -> Result<DokployConnection, StableError> {
    let url = normalize_url(url);
    if url.is_empty() || api_key.trim().is_empty() {
        return Err(StableError::new(
            codes::DOKPLOY_NOT_CONFIGURED,
            "Dokploy is not configured. Add at least one server URL and API key in Settings → Accounts.",
        ));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(StableError::new(
            codes::DOKPLOY_NOT_CONFIGURED,
            "Dokploy server URL must start with http:// or https://.",
        ));
    }
    let name = name.trim();
    Ok(DokployConnection {
        id: id.trim().to_string(),
        name: if name.is_empty() {
            default_server_name(&url)
        } else {
            name.to_string()
        },
        url,
        api_key: api_key.trim().to_string(),
    })
}

pub(crate) fn connection_from_parts(url: &str, api_key: &str) -> Result<DokployConnection, StableError> {
    connection_from_entry("adhoc", "", url, api_key)
}

/// Parse the `dokploy_servers` JSON list. Invalid entries are skipped so
/// one bad row never breaks the remaining servers.
pub(crate) fn parse_servers_json(raw: &str) -> Vec<DokployConnection> {
    let parsed: Result<Vec<DokployServerEntry>, _> = serde_json::from_str(raw);
    let entries = match parsed {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for (idx, e) in entries.iter().enumerate() {
        let url = e.url.as_deref().unwrap_or("").trim();
        let api_key = e.api_key.as_deref().unwrap_or("").trim();
        if url.is_empty() || api_key.is_empty() {
            continue;
        }
        let id = e.id.clone().unwrap_or_default().trim().to_string();
        let id = if id.is_empty() {
            format!("server-{idx}")
        } else {
            id
        };
        let name = e.name.clone().unwrap_or_default();
        if let Ok(c) = connection_from_entry(&id, &name, url, api_key) {
            out.push(c);
        }
    }
    out
}

pub(crate) async fn read_connections(pool: &sqlx::SqlitePool) -> Result<Vec<DokployConnection>, StableError> {
    if let Some(raw) = db::get_setting(pool, DOKPLOY_SERVERS_SETTING_KEY).await? {
        let list = parse_servers_json(&raw);
        if !list.is_empty() {
            return Ok(list);
        }
        // Fall through to legacy keys when the list is empty/invalid so
        // pre-migration installs keep working.
    }
    let url = db::get_setting(pool, DOKPLOY_URL_SETTING_KEY)
        .await?
        .unwrap_or_default();
    let api_key = db::get_setting(pool, DOKPLOY_API_KEY_SETTING_KEY)
        .await?
        .unwrap_or_default();
    if url.trim().is_empty() && api_key.trim().is_empty() {
        return Err(StableError::new(
            codes::DOKPLOY_NOT_CONFIGURED,
            "Dokploy is not configured. Add at least one server in Settings → Accounts.",
        ));
    }
    let mut conn = connection_from_entry("legacy", "", &url, &api_key)?;
    conn.id = "legacy".to_string();
    Ok(vec![conn])
}

pub(crate) fn select_connection<'a>(
    conns: &'a [DokployConnection],
    server_id: Option<&str>,
) -> Result<&'a DokployConnection, StableError> {
    let want = server_id.map(str::trim).filter(|s| !s.is_empty());
    // Single-server setups ignore the id entirely (backward compatible with
    // older frontends that send no serverId).
    if conns.len() == 1 {
        return Ok(&conns[0]);
    }
    match want {
        None => Ok(&conns[0]),
        Some(id) => conns.iter().find(|c| c.id == id).ok_or_else(|| {
            StableError::new(
                codes::DOKPLOY_NOT_FOUND,
                "Dokploy server not found. It may have been removed in Settings → Accounts.",
            )
        }),
    }
}

pub(crate) fn map_http_error(status: reqwest::StatusCode, body: &str) -> StableError {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return StableError::new(
            codes::DOKPLOY_UNAUTHORIZED,
            "Dokploy refused the API key. Check it in Settings → Accounts.",
        );
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return StableError::new(
            codes::DOKPLOY_NOT_FOUND,
            "Dokploy did not find the requested service. It may have been deleted.",
        );
    }
    let snippet: String = body.chars().take(160).collect();
    StableError::new(
        codes::DOKPLOY_REQUEST_FAILED,
        format!("Dokploy request failed ({}): {}", status.as_u16(), snippet),
    )
}

pub(crate) async fn api_get(conn: &DokployConnection, path: &str) -> Result<Value, StableError> {
    let url = format!("{}{}", conn.url, path);
    let res = http()
        .get(&url)
        .header("x-api-key", &conn.api_key)
        .header("Authorization", format!("Bearer {}", conn.api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            StableError::new(
                codes::DOKPLOY_UNREACHABLE,
                format!("Could not reach Dokploy at {}: {}", conn.url, e),
            )
        })?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_http_error(status, &body));
    }
    serde_json::from_str(&body).map_err(|e| {
        StableError::new(
            codes::DOKPLOY_REQUEST_FAILED,
            format!("Dokploy returned an unreadable response: {e}"),
        )
    })
}

pub(crate) async fn api_post(
    conn: &DokployConnection,
    path: &str,
    payload: Value,
) -> Result<Value, StableError> {
    let url = format!("{}{}", conn.url, path);
    let res = http()
        .post(&url)
        .header("x-api-key", &conn.api_key)
        .header("Authorization", format!("Bearer {}", conn.api_key))
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            StableError::new(
                codes::DOKPLOY_UNREACHABLE,
                format!("Could not reach Dokploy at {}: {}", conn.url, e),
            )
        })?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_http_error(status, &body));
    }
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str::<Value>(&body).unwrap_or(Value::Null))
}

pub(crate) fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_rejects_blank_and_scheme_less_urls() {
        assert!(connection_from_parts("", "key").is_err());
        assert!(connection_from_parts("https://dokploy.local", "").is_err());
        assert!(connection_from_parts("dokploy.local", "key").is_err());
        let c = connection_from_parts("https://dokploy.local/", " key ").unwrap();
        assert_eq!(c.url, "https://dokploy.local");
        assert_eq!(c.api_key, "key");
    }

    fn test_server(id: &str, name: &str) -> DokployConnection {
        DokployConnection {
            id: id.to_string(),
            name: name.to_string(),
            url: "https://dokploy.local".to_string(),
            api_key: "key".to_string(),
        }
    }

    #[test]
    fn servers_json_parses_and_skips_invalid_rows() {
        let raw = r#"[
            { "id": "a", "name": "Main", "url": "https://a.example.com/", "apiKey": "k1" },
            { "id": "b", "name": "", "url": "https://b.example.com", "api_key": "k2" },
            { "id": "bad", "name": "Bad", "url": "", "apiKey": "k3" },
            { "id": "bad2", "name": "Bad2", "url": "notaurl", "apiKey": "k4" }
        ]"#;
        let out = parse_servers_json(raw);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "a");
        assert_eq!(out[0].url, "https://a.example.com");
        assert_eq!(out[0].name, "Main");
        // Empty name falls back to the URL host.
        assert_eq!(out[1].name, "b.example.com");
        assert!(parse_servers_json("not json").is_empty());
    }

    #[test]
    fn select_connection_routes_by_server_id() {
        let conns = vec![test_server("a", "A"), test_server("b", "B")];
        assert_eq!(select_connection(&conns, None).unwrap().id, "a");
        assert_eq!(select_connection(&conns, Some("b")).unwrap().id, "b");
        assert!(select_connection(&conns, Some("missing")).is_err());
        // Single-server setups ignore stale ids (old frontend compat).
        let single = vec![test_server("only", "Only")];
        assert_eq!(
            select_connection(&single, Some("stale")).unwrap().id,
            "only"
        );
    }
}
