use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

use crate::db;
use crate::error::{codes, StableError};

static HTTP: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(reqwest::Client::new)
}

async fn token(pool: &Pool<Sqlite>) -> Result<String, StableError> {
    db::get_setting(pool, "github_token")
        .await
        .ok()
        .flatten()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| {
            StableError::new(
                "GITHUB_UNAUTHORIZED",
                "no GitHub token configured (Settings → Accounts → github_token)",
            )
        })
}

fn map_status(status: reqwest::StatusCode, body: &str, what: &str) -> StableError {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return StableError::new(
            "GITHUB_UNAUTHORIZED",
            "GitHub rejected the token (check scopes: repo)",
        );
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return StableError::new(
            codes::NOT_FOUND,
            "repository or PR not found (private repo needs repo scope)",
        );
    }
    if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        let msg: String = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("errors").cloned())
            .and_then(|e| serde_json::to_string(&e).ok())
            .unwrap_or_else(|| body.to_string());
        let short: String = msg.chars().take(300).collect();
        return StableError::new(codes::SCHEMA_INCOMPATIBLE, format!("GitHub refused: {short}"));
    }
    let short: String = body.chars().take(300).collect();
    StableError::new(codes::INTERNAL, format!("GitHub {what} failed ({status}): {short}"))
}

/// Deterministic PR body composed from the card + change stats. Pure.
pub fn build_pr_body(
    card_title: &str,
    card_body: &str,
    branch: &str,
    base: &str,
    files: &[(String, u32, u32)],
) -> String {
    let mut out = String::new();
    let body = card_body.trim();
    if body.is_empty() {
        out.push_str(card_title.trim());
    } else {
        out.push_str(body);
    }
    out.push_str("\n\n## Changes\n\n");
    if files.is_empty() {
        out.push_str("_No file changes detected._\n");
    } else {
        let (mut add, mut del) = (0u32, 0u32);
        for (path, a, d) in files {
            add += a;
            del += d;
            out.push_str(&format!("- `{path}` (+{a} −{d})\n"));
        }
        out.push_str(&format!("\n{add} additions, {del} deletions across {} files.\n", files.len()));
    }
    out.push_str(&format!("\n---\nBranch `{branch}` → `{base}`, via Project Vault workspaces.\n"));
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedPr {
    pub number: u64,
    pub html_url: String,
}

#[cfg(test)]
mod tests {
    use super::build_pr_body;

    #[test]
    fn pr_body_template() {
        let body = build_pr_body(
            "Add login",
            "Users can sign in.",
            "pv/add-login-abc",
            "main",
            &[("src/a.ts".to_string(), 10, 2)],
        );
        assert!(body.contains("Users can sign in."));
        assert!(body.contains("`src/a.ts` (+10 −2)"));
        assert!(body.contains("`pv/add-login-abc` → `main`"));
        let empty = build_pr_body("T", "", "b", "main", &[]);
        assert!(empty.contains("No file changes"));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrStatus {
    pub number: u64,
    pub html_url: String,
    pub state: String,
    pub merged: bool,
    pub mergeable: Option<bool>,
    pub head: String,
    pub base: String,
}

/// POST /repos/{owner}/{repo}/pulls
pub async fn create_pr(
    pool: &Pool<Sqlite>,
    owner: &str,
    repo: &str,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
) -> Result<CreatedPr, StableError> {
    let t = token(pool).await?;
    let resp = http()
        .post(format!("https://api.github.com/repos/{owner}/{repo}/pulls"))
        .header("User-Agent", "project-vault")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Authorization", format!("Bearer {t}"))
        .json(&serde_json::json!({
            "title": title, "head": head, "base": base, "body": body,
        }))
        .send()
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, format!("GitHub request failed: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_status(status, &text, "PR creation"));
    }
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("bad GitHub response: {e}")))?;
    Ok(CreatedPr {
        number: v.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        html_url: v
            .get("html_url")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// GET /repos/{owner}/{repo}/pulls/{number}
pub async fn pr_status(
    pool: &Pool<Sqlite>,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<PrStatus, StableError> {
    let t = token(pool).await?;
    let resp = http()
        .get(format!("https://api.github.com/repos/{owner}/{repo}/pulls/{number}"))
        .header("User-Agent", "project-vault")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Authorization", format!("Bearer {t}"))
        .send()
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, format!("GitHub request failed: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_status(status, &text, "PR lookup"));
    }
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("bad GitHub response: {e}")))?;
    Ok(PrStatus {
        number,
        html_url: v.get("html_url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
        state: v.get("state").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        merged: v.get("merged").and_then(|m| m.as_bool()).unwrap_or(false),
        mergeable: v.get("mergeable").and_then(|m| m.as_bool()),
        head: v.get("head").and_then(|h| h.get("ref")).and_then(|r| r.as_str()).unwrap_or("").to_string(),
        base: v.get("base").and_then(|b| b.get("ref")).and_then(|r| r.as_str()).unwrap_or("").to_string(),
    })
}

/// PUT /repos/{owner}/{repo}/pulls/{number}/merge
pub async fn merge_pr(
    pool: &Pool<Sqlite>,
    owner: &str,
    repo: &str,
    number: u64,
    method: &str,
) -> Result<bool, StableError> {
    let method = match method {
        "squash" | "rebase" => method,
        _ => "merge",
    };
    let t = token(pool).await?;
    let resp = http()
        .put(format!("https://api.github.com/repos/{owner}/{repo}/pulls/{number}/merge"))
        .header("User-Agent", "project-vault")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Authorization", format!("Bearer {t}"))
        .json(&serde_json::json!({ "merge_method": method }))
        .send()
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, format!("GitHub request failed: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_status(status, &text, "PR merge"));
    }
    let merged = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("merged").and_then(|m| m.as_bool()))
        .unwrap_or(false);
    Ok(merged)
}
