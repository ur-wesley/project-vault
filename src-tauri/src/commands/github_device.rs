use std::time::Duration;

use reqwest::header::ACCEPT;
use serde::Deserialize;
use serde::Serialize;
use std::sync::OnceLock;

use crate::error::codes;
use crate::error::StableError;

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GRANT_TYPE_DEVICE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE: &str = "repo read:user";
const SLOW_DOWN_SECS: u64 = 5;

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!(
                env!("CARGO_PKG_NAME"),
                "/",
                env!("CARGO_PKG_VERSION"),
                " (Tauri)"
            ))
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(120))
            .build()
            .expect("reqwest client")
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubOauthFile {
    pub github_device_client_id: String,
}

fn read_client_id(provided: Option<String>) -> Option<String> {
    if let Some(p) = provided.filter(|s| !s.trim().is_empty()) {
        return Some(p);
    }

    // Try to load .env file
    let _ = dotenvy::dotenv();

    if let Ok(v) = std::env::var("GITHUB_DEVICE_CLIENT_ID") {
        let v = v.trim();
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }

    // Also check the Vite-prefixed version since users often set that in .env
    if let Ok(v) = std::env::var("VITE_GITHUB_DEVICE_CLIENT_ID") {
        let v = v.trim();
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }

    let s = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/github_device_config.json"
    ));
    let cfg: GitHubOauthFile = serde_json::from_str(s).ok()?;
    let t = cfg.github_device_client_id.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    interval: u64,
    expires_in: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceStartDto {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub interval_sec: u64,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceTokenDto {
    pub access_token: String,
}

#[tauri::command]
pub async fn is_github_device_configured(client_id: Option<String>) -> Result<bool, StableError> {
    Ok(read_client_id(client_id).is_some())
}

#[tauri::command]
pub async fn start_github_device_flow(
    client_id: Option<String>,
) -> Result<GitHubDeviceStartDto, StableError> {
    let client_id = read_client_id(client_id).ok_or_else(|| {
        StableError::new(
            codes::GITHUB_DEVICE_NOT_CONFIGURED,
            "github_device_config.json: set githubDeviceClientId (OAuth app, enable device flow).",
        )
    })?;
    let c = http();
    let r = c
        .post(DEVICE_CODE_URL)
        .header(ACCEPT, "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| {
            StableError::new(
                codes::GITHUB_DEVICE_REQUEST,
                format!("github device: request failed: {e}"),
            )
        })?;
    let r = r.error_for_status().map_err(|e| {
        StableError::new(codes::GITHUB_DEVICE_REQUEST, format!("github device: {e}"))
    })?;
    let d: DeviceCodeResponse = r.json().await.map_err(|e| {
        StableError::new(
            codes::GITHUB_DEVICE_REQUEST,
            format!("github device: bad response: {e}"),
        )
    })?;
    let mut interval = d.interval.max(5);
    if interval == 0 {
        interval = 5;
    }
    Ok(GitHubDeviceStartDto {
        user_code: d.user_code,
        device_code: d.device_code,
        verification_uri: d.verification_uri,
        interval_sec: interval,
        expires_in: d.expires_in,
    })
}

async fn one_access_token_poll(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
) -> Result<AccessTokenResponse, StableError> {
    let r = client
        .post(ACCESS_TOKEN_URL)
        .header(ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", GRANT_TYPE_DEVICE),
        ])
        .send()
        .await
        .map_err(|e| {
            StableError::new(
                codes::GITHUB_DEVICE_REQUEST,
                format!("github token: request failed: {e}"),
            )
        })?;
    let r = r.error_for_status().map_err(|e| {
        StableError::new(codes::GITHUB_DEVICE_REQUEST, format!("github token: {e}"))
    })?;
    r.json().await.map_err(|e| {
        StableError::new(
            codes::GITHUB_DEVICE_REQUEST,
            format!("github token: bad body: {e}"),
        )
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceWaitPayload {
    pub device_code: String,
    pub interval_sec: u64,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn wait_github_device_flow(
    payload: GitHubDeviceWaitPayload,
    client_id: Option<String>,
) -> Result<GitHubDeviceTokenDto, StableError> {
    let client_id = read_client_id(client_id).ok_or_else(|| {
        StableError::new(
            codes::GITHUB_DEVICE_NOT_CONFIGURED,
            "client id not configured",
        )
    })?;
    let c = http();
    let mut interval = payload.interval_sec.max(5);
    if interval == 0 {
        interval = 5;
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(payload.expires_in.max(1));
    loop {
        if std::time::Instant::now() > deadline {
            return Err(StableError::new(
                codes::GITHUB_DEVICE_TIMEOUT,
                "github device authorization expired. Try again.",
            ));
        }
        let resp = one_access_token_poll(c, &client_id, &payload.device_code).await?;
        if let Some(token) = resp.access_token.filter(|s| !s.is_empty()) {
            return Ok(GitHubDeviceTokenDto {
                access_token: token,
            });
        }
        let err = resp.error.as_deref().unwrap_or("unknown");
        if err == "authorization_pending" {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        }
        if err == "slow_down" {
            interval = interval.saturating_add(SLOW_DOWN_SECS);
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        }
        if err == "expired_token" {
            return Err(StableError::new(
                codes::GITHUB_DEVICE_TIMEOUT,
                "github device: expired",
            ));
        }
        if err == "access_denied" {
            return Err(StableError::new(
                codes::GITHUB_DEVICE_DENIED,
                "github device: access denied",
            ));
        }
        let msg = resp.error_description.unwrap_or_else(|| err.to_string());
        return Err(StableError::new(codes::GITHUB_DEVICE_REQUEST, msg));
    }
}
