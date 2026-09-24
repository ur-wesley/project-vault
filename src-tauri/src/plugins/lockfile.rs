use std::collections::{HashMap, HashSet};

use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};
use crate::lua::loader::{load_specs, repo_slug};
use crate::lua::vendor::{restore_vendor_lockfile, sync_vendor_lockfile};

use super::paths::{git_command, plugins_dir, repo_checkout_path, repos_dir, run_git};

#[tauri::command]
pub async fn sync_lockfile(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let mut lockfile = serde_json::Map::new();
    let mut seen_repos: HashMap<String, String> = HashMap::new();

    for spec in specs {
        let repo = match &spec.repo {
            Some(r) => r.clone(),
            None => continue,
        };
        let slug = repo_slug(&repo);
        let path = repo_checkout_path(&p_dir, &repo);
        if !path.is_dir() {
            continue;
        }

        let sha = if let Some(commit) = seen_repos.get(&slug) {
            commit.clone()
        } else {
            let mut cmd = git_command();
            cmd.current_dir(&path).arg("rev-parse").arg("HEAD");
            let out = run_git(cmd).await?;
            if !out.status.success() {
                continue;
            }
            let commit = String::from_utf8_lossy(&out.stdout).trim().to_string();
            seen_repos.insert(slug.clone(), commit.clone());
            commit
        };

        let mut info = serde_json::Map::new();
        info.insert("repo".to_string(), serde_json::Value::String(repo));
        info.insert("commit".to_string(), serde_json::Value::String(sha));
        info.insert("repoSlug".to_string(), serde_json::Value::String(slug));
        lockfile.insert(spec.id, serde_json::Value::Object(info));
    }

    let lock_path = p_dir.join("lazy-lock.json");
    let json = serde_json::to_string_pretty(&lockfile).unwrap_or_default();
    std::fs::write(lock_path, json).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-lock.json: {}", e),
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn restore_from_lockfile(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let lock_path = p_dir.join("lazy-lock.json");
    if !lock_path.is_file() {
        return Err(StableError::new(
            codes::NOT_FOUND,
            "lazy-lock.json not found",
        ));
    }

    let content = std::fs::read_to_string(&lock_path).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to read lockfile: {}", e),
        )
    })?;

    let lockfile: HashMap<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("Invalid lockfile JSON: {}", e),
            )
        })?;

    let mut restored_slugs: HashSet<String> = HashSet::new();

    for (_id, val) in lockfile {
        let repo = val.get("repo").and_then(|r| r.as_str());
        let commit = val.get("commit").and_then(|c| c.as_str());
        let slug = val
            .get("repoSlug")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .or_else(|| repo.map(repo_slug));

        if let (Some(r), Some(c), Some(slug)) = (repo, commit, slug) {
            if restored_slugs.contains(&slug) {
                let target_path = repos_dir(&p_dir).join(&slug);
                let mut checkout = git_command();
                checkout.current_dir(&target_path).arg("checkout").arg(c);
                let _ = run_git(checkout).await;
                continue;
            }

            let target_path = repos_dir(&p_dir).join(&slug);
            if !target_path.is_dir() {
                if !repos_dir(&p_dir).is_dir() {
                    let _ = std::fs::create_dir_all(repos_dir(&p_dir));
                }
                let mut cmd = git_command();
                cmd.arg("clone")
                    .arg("--filter=blob:none")
                    .arg(r)
                    .arg(&target_path);
                let _ = run_git(cmd).await;
            }

            let mut checkout = git_command();
            checkout.current_dir(&target_path).arg("checkout").arg(c);
            let _ = run_git(checkout).await;
            restored_slugs.insert(slug);
        }
    }

    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[tauri::command]
pub async fn sync_vendor_lockfile_cmd(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    sync_vendor_lockfile(&p_dir)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_vendor_lockfile_cmd(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    restore_vendor_lockfile(&p_dir)?;
    let _ = app.emit("plugin:reload", ());
    Ok(())
}
