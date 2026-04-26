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
    let git = project_path.join(".git");
    if git.is_dir() {
        return Some(git);
    }
    if git.is_file() {
        if let Ok(text) = std::fs::read_to_string(&git) {
            for line in text.lines() {
                if let Some(rest) = line.trim().strip_prefix("gitdir: ") {
                    let p = Path::new(rest.trim());
                    let resolved = if p.is_absolute() {
                        p.to_path_buf()
                    } else {
                        project_path.join(p)
                    };
                    if resolved.is_dir() {
                        return Some(resolved);
                    }
                }
            }
        }
    }
    None
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
