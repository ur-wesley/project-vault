use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoRefDto {
    pub owner: String,
    pub repo: String,
}

fn split_owner_repo_tail(tail: &str) -> Option<(String, String)> {
    let s = tail.trim().trim_end_matches('/').trim_end_matches(".git");
    let (a, b) = s.split_once('/')?;
    if a.is_empty() || b.is_empty() {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

fn parse_github_url(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    if let Some(rest) = u.strip_prefix("git@github.com:") {
        return split_owner_repo_tail(rest);
    }
    if let Some(rest) = u.strip_prefix("ssh://git@github.com/") {
        return split_owner_repo_tail(rest);
    }
    u.rfind("github.com/")
        .and_then(|idx| split_owner_repo_tail(&u[idx + "github.com/".len()..]))
}

fn find_origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t == r#"[remote "origin"]"#;
            continue;
        }
        if in_origin {
            if let Some(rest) = t.strip_prefix("url = ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

fn resolve_git_dir(project_path: &Path) -> Option<PathBuf> {
    crate::commands::git::utils::resolve_git_dir(project_path)
}

#[tauri::command]
pub async fn get_github_repo_for_project(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<GitHubRepoRefDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let project_path = Path::new(&project.path);
    let Some(git_dir) = resolve_git_dir(project_path) else {
        return Ok(None);
    };
    let config_path = git_dir.join("config");
    let config = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let Some(url) = find_origin_url(&config) else {
        return Ok(None);
    };
    let Some((owner, repo)) = parse_github_url(&url) else {
        return Ok(None);
    };
    Ok(Some(GitHubRepoRefDto { owner, repo }))
}

pub fn convert_git_remote_to_web_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    if url.starts_with("http://") || url.starts_with("https://") {
        let mut clean = url.trim_end_matches('/').trim_end_matches(".git").to_string();
        if let Some(pos) = clean.find("://") {
            let after_scheme = &clean[pos + 3..];
            if let Some(at_idx) = after_scheme.find('@') {
                clean = format!("{}://{}", &clean[0..pos], &after_scheme[at_idx + 1..]);
            }
        }
        return Some(clean);
    }

    // SSH format, e.g. git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
    let mut host_path = url;
    if let Some(rest) = host_path.strip_prefix("ssh://") {
        host_path = rest;
    }
    if let Some(rest) = host_path.strip_prefix("git@") {
        host_path = rest;
    }

    let cleaned = host_path.replace(':', "/");
    let parts: Vec<&str> = cleaned.split('/').collect();
    if parts.len() >= 3 {
        let domain = parts[0];
        let rest = parts[1..].join("/");
        let clean_path = rest.trim_end_matches('/').trim_end_matches(".git");
        return Some(format!("https://{}/{}", domain, clean_path));
    }

    None
}

#[tauri::command]
pub async fn get_git_remote_url(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<String>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let project_path = Path::new(&project.path);
    let Some(git_dir) = resolve_git_dir(project_path) else {
        return Ok(None);
    };
    let config_path = git_dir.join("config");
    let config = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let Some(url) = find_origin_url(&config) else {
        return Ok(None);
    };
    Ok(convert_git_remote_to_web_url(&url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_git_remote_to_web_url() {
        assert_eq!(
            convert_git_remote_to_web_url("git@github.com:ur-wesley/project-vault.git"),
            Some("https://github.com/ur-wesley/project-vault".to_string())
        );
        assert_eq!(
            convert_git_remote_to_web_url("https://github.com/ur-wesley/project-vault.git"),
            Some("https://github.com/ur-wesley/project-vault".to_string())
        );
        assert_eq!(
            convert_git_remote_to_web_url("ssh://git@github.com/ur-wesley/project-vault"),
            Some("https://github.com/ur-wesley/project-vault".to_string())
        );
        assert_eq!(
            convert_git_remote_to_web_url("https://oauth2:token@gitlab.com/owner/repo.git"),
            Some("https://gitlab.com/owner/repo".to_string())
        );
        assert_eq!(
            convert_git_remote_to_web_url("   "),
            None
        );
    }
}


