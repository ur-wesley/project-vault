use std::collections::{HashMap, HashSet};

use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};
use crate::lua::loader::{
    load_specs, parse_plugin_init_metadata_str, plugin_init_path, read_plugin_init_metadata, repo_slug,
};

use super::monorepo::update_repo_checkout;
use super::paths::{
    git_command, plugins_dir, repo_checkout_path, repo_is_behind_upstream, run_git,
};

#[tauri::command]
pub async fn check_plugin_updates(app: AppHandle) -> Result<Vec<String>, StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let mut updateable = Vec::new();
    let mut checked_slugs: HashSet<String> = HashSet::new();
    let mut slug_behind: HashMap<String, bool> = HashMap::new();

    for spec in specs {
        let repo = match &spec.repo {
            Some(r) => r,
            None => continue,
        };
        let slug = repo_slug(repo);
        let path = repo_checkout_path(&p_dir, repo);
        if !path.is_dir() {
            continue;
        }

        let behind = if let Some(&b) = slug_behind.get(&slug) {
            b
        } else {
            let behind = repo_is_behind_upstream(&path).await;
            checked_slugs.insert(slug.clone());
            slug_behind.insert(slug.clone(), behind);
            behind
        };

        if behind {
            let local_init_path = plugin_init_path(&p_dir, &spec);
            let mut is_update = true;

            if let Ok(rel_path) = local_init_path.strip_prefix(&path) {
                let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
                let mut show_cmd = git_command();
                show_cmd
                    .current_dir(&path)
                    .arg("show")
                    .arg(format!("@{{u}}:{}", rel_path_str));

                if let Ok(out) = run_git(show_cmd).await {
                    if out.status.success() {
                        if let Ok(upstream_content) = String::from_utf8(out.stdout) {
                            let upstream_meta =
                                parse_plugin_init_metadata_str(&upstream_content, None);
                            let local_meta = read_plugin_init_metadata(&local_init_path);
                            if let (Some(up_ver), Some(loc_ver)) =
                                (upstream_meta.version, local_meta.version)
                            {
                                if up_ver == loc_ver {
                                    is_update = false;
                                }
                            }
                        }
                    }
                }
            }

            if is_update {
                updateable.push(spec.id.clone());
            }
        }
    }

    Ok(updateable)
}

#[tauri::command]
pub async fn update_plugin_git(app: AppHandle, plugin_id: String) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let spec = specs.iter().find(|s| s.id == plugin_id).ok_or_else(|| {
        StableError::new(
            codes::NOT_FOUND,
            format!("Plugin not found: {}", plugin_id),
        )
    })?;
    let repo = spec.repo.as_ref().ok_or_else(|| {
        StableError::new(
            codes::NOT_FOUND,
            "Plugin has no git repository",
        )
    })?;
    let discovered = update_repo_checkout(&p_dir, repo).await?;
    if !discovered.is_empty() {
        let _ = app.emit(
            "plugin:discoveries",
            serde_json::json!([{ "repo": repo, "slug": repo_slug(repo), "ids": discovered }]),
        );
    }
    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[tauri::command]
pub async fn update_all_plugins(app: AppHandle) -> Result<Vec<String>, StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let mut seen_slugs: HashSet<String> = HashSet::new();
    let mut updated_slugs: HashSet<String> = HashSet::new();
    let mut discovery_payload: Vec<serde_json::Value> = Vec::new();

    for spec in &specs {
        let repo = match &spec.repo {
            Some(r) => r,
            None => continue,
        };
        let slug = repo_slug(repo);
        if !seen_slugs.insert(slug.clone()) {
            continue;
        }
        let path = repo_checkout_path(&p_dir, repo);
        if !path.is_dir() || !repo_is_behind_upstream(&path).await {
            continue;
        }
        match update_repo_checkout(&p_dir, repo).await {
            Ok(discovered) => {
                updated_slugs.insert(slug.clone());
                if !discovered.is_empty() {
                    discovery_payload.push(serde_json::json!({
                        "repo": repo,
                        "slug": slug,
                        "ids": discovered,
                    }));
                }
            }
            Err(_) => {}
        }
    }

    let updated_ids: Vec<String> = specs
        .iter()
        .filter(|s| {
            s.repo
                .as_ref()
                .is_some_and(|r| updated_slugs.contains(&repo_slug(r)))
        })
        .map(|s| s.id.clone())
        .collect();

    if !discovery_payload.is_empty() {
        let _ = app.emit("plugin:discoveries", discovery_payload);
    }
    let _ = app.emit("plugin:reload", ());
    Ok(updated_ids)
}
