use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};
use crate::lua::loader::{
    diff_registry_against_specs, enrich_spec_from_repo_init, load_registry_entries, load_specs,
    merge_registry_into_lazy_config, read_plugin_init_metadata, registry_entry_to_spec, repo_slug,
    topological_sort_specs, write_specs_to_file, PluginRegistryEntry, PLUGIN_REGISTRY_FILE,
};

use super::dto::{DiscoveredPluginDto, DiscoveredRepoDto, MonorepoDiscoveryDto, MonorepoEntryDto};
use super::paths::{git_command, plugins_dir, repo_checkout_path, repos_dir, run_git};

async fn pull_repo_at(path: &Path) -> Result<(), StableError> {
    let mut pull = git_command();
    pull.current_dir(path).arg("pull");
    let out = run_git(pull).await?;
    if !out.status.success() {
        let err_msg = String::from_utf8_lossy(&out.stderr);
        return Err(StableError::new(
            codes::INTERNAL,
            format!("Git pull failed: {}", err_msg),
        ));
    }
    Ok(())
}

pub(crate) async fn update_repo_checkout(
    p_dir: &Path,
    repo: &str,
) -> Result<Vec<String>, StableError> {
    let path = repo_checkout_path(p_dir, repo);
    if !path.is_dir() {
        return Err(StableError::new(
            codes::NOT_FOUND,
            "Repository checkout not found",
        ));
    }
    pull_repo_at(&path).await?;
    merge_repo_registry_if_present(p_dir, repo)
}

fn merge_repo_registry_if_present(p_dir: &Path, repo: &str) -> Result<Vec<String>, StableError> {
    let target_path = repo_checkout_path(p_dir, repo);
    let registry_path = target_path.join(PLUGIN_REGISTRY_FILE);
    if !registry_path.is_file() {
        return Ok(Vec::new());
    }
    let registry_entries = load_registry_entries(&target_path);
    if registry_entries.is_empty() {
        return Ok(Vec::new());
    }
    let mut specs = load_specs(p_dir);
    let discovered = diff_registry_against_specs(&registry_entries, &specs);
    merge_registry_into_lazy_config(&mut specs, registry_entries, repo, &target_path);
    let lazy_config_path = p_dir.join("lazy-config.luau");
    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;
    Ok(discovered)
}

async fn ensure_repo_checkout(
    p_dir: &Path,
    repo: &str,
    branch: Option<&str>,
    tag: Option<&str>,
    commit: Option<&str>,
) -> Result<PathBuf, StableError> {
    let target_path = repo_checkout_path(p_dir, repo);

    if !repos_dir(p_dir).is_dir() {
        std::fs::create_dir_all(repos_dir(p_dir)).map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("Failed to create repos dir: {}", e),
            )
        })?;
    }

    if target_path.is_dir() {
        pull_repo_at(&target_path).await?;
    } else {
        let mut cmd = git_command();
        cmd.arg("clone")
            .arg("--filter=blob:none")
            .arg(repo)
            .arg(&target_path);

        let out = run_git(cmd).await?;
        if !out.status.success() {
            let err_msg = String::from_utf8_lossy(&out.stderr);
            return Err(StableError::new(
                codes::INTERNAL,
                format!("Git clone failed: {}", err_msg),
            ));
        }
    }

    if let Some(ref_val) = branch.or(tag).or(commit) {
        let mut checkout = git_command();
        checkout
            .current_dir(&target_path)
            .arg("checkout")
            .arg(ref_val);
        let _ = run_git(checkout).await;
    }

    Ok(target_path)
}

fn enrich_entry_meta(
    target_path: &Path,
    entry: &PluginRegistryEntry,
    existing: bool,
) -> MonorepoEntryDto {
    let dir = entry.dir.as_deref().unwrap_or(&entry.id);
    let init_path = target_path.join(dir).join("init.luau");
    let meta = read_plugin_init_metadata(&init_path);
    MonorepoEntryDto {
        id: entry.id.clone(),
        dir: entry.dir.clone(),
        name: meta.name,
        description: meta.description,
        version: meta.version,
        category: meta.category,
        existing,
    }
}

#[tauri::command]
pub async fn discover_monorepo(
    app: AppHandle,
    repo: String,
    branch: Option<String>,
    tag: Option<String>,
    commit: Option<String>,
) -> Result<MonorepoDiscoveryDto, StableError> {
    let p_dir = plugins_dir(&app);
    let slug = repo_slug(&repo);
    let target_path = ensure_repo_checkout(
        &p_dir,
        &repo,
        branch.as_deref(),
        tag.as_deref(),
        commit.as_deref(),
    )
    .await?;

    let registry_path = target_path.join(PLUGIN_REGISTRY_FILE);
    let root_init = target_path.join("init.luau");

    let specs = load_specs(&p_dir);
    let installed_ids: HashSet<String> = specs.iter().map(|s| s.id.clone()).collect();

    if registry_path.is_file() {
        let entries = load_registry_entries(&target_path);
        if entries.is_empty() {
            return Err(StableError::new(
                codes::INTERNAL,
                format!("{} parsed to zero plugins", PLUGIN_REGISTRY_FILE),
            ));
        }
        let dtos: Vec<MonorepoEntryDto> = entries
            .iter()
            .map(|e| {
                let existing = installed_ids.contains(&e.id);
                enrich_entry_meta(&target_path, e, existing)
            })
            .collect();
        Ok(MonorepoDiscoveryDto {
            repo,
            slug,
            branch,
            tag,
            commit,
            kind: "monorepo".to_string(),
            entries: dtos,
        })
    } else if root_init.is_file() {
        let entry = PluginRegistryEntry {
            id: slug.clone(),
            dir: None,
        };
        let existing = installed_ids.contains(&entry.id);
        let dto = enrich_entry_meta(&target_path, &entry, existing);
        Ok(MonorepoDiscoveryDto {
            repo,
            slug,
            branch,
            tag,
            commit,
            kind: "single".to_string(),
            entries: vec![dto],
        })
    } else {
        Err(StableError::new(
            codes::NOT_FOUND,
            format!(
                "No {} or init.luau found at repository root",
                PLUGIN_REGISTRY_FILE
            ),
        ))
    }
}

#[tauri::command]
pub async fn install_plugin_git(
    app: AppHandle,
    repo: String,
    branch: Option<String>,
    tag: Option<String>,
    commit: Option<String>,
    selected_ids: Option<Vec<String>>,
) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let slug = repo_slug(&repo);
    let target_path = ensure_repo_checkout(
        &p_dir,
        &repo,
        branch.as_deref(),
        tag.as_deref(),
        commit.as_deref(),
    )
    .await?;

    let registry_path = target_path.join(PLUGIN_REGISTRY_FILE);
    let root_init = target_path.join("init.luau");

    let mut specs = load_specs(&p_dir);
    let lazy_config_path = p_dir.join("lazy-config.luau");

    if registry_path.is_file() {
        let registry_entries = load_registry_entries(&target_path);
        if registry_entries.is_empty() {
            return Err(StableError::new(
                codes::INTERNAL,
                format!("{} parsed to zero plugins", PLUGIN_REGISTRY_FILE),
            ));
        }

        let filtered: Vec<PluginRegistryEntry> = match &selected_ids {
            Some(ids) => {
                if ids.is_empty() {
                    return Err(StableError::new(
                        codes::EMPTY_SELECTION,
                        "No plugins selected for installation",
                    ));
                }
                let wanted: HashSet<&String> = ids.iter().collect();
                registry_entries
                    .into_iter()
                    .filter(|e| wanted.contains(&e.id))
                    .collect()
            }
            None => registry_entries,
        };

        if filtered.is_empty() {
            return Err(StableError::new(
                codes::EMPTY_SELECTION,
                "No matching plugins found in registry for the given selection",
            ));
        }

        merge_registry_into_lazy_config(&mut specs, filtered, &repo, &target_path);
    } else if root_init.is_file() {
        let mut single = registry_entry_to_spec(
            &PluginRegistryEntry {
                id: slug.clone(),
                dir: None,
            },
            &repo,
        );
        enrich_spec_from_repo_init(&target_path, &mut single);
        if let Some(idx) = specs.iter().position(|s| s.id == single.id) {
            specs[idx].repo = Some(repo.clone());
            specs[idx].dir = single.dir.clone();
        } else {
            specs.push(single);
        }
        let _ = topological_sort_specs(&mut specs);
    } else {
        return Err(StableError::new(
            codes::NOT_FOUND,
            format!(
                "No {} or init.luau found at repository root",
                PLUGIN_REGISTRY_FILE
            ),
        ));
    }

    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;

    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[tauri::command]
pub async fn get_pending_discoveries(
    app: AppHandle,
) -> Result<Vec<DiscoveredRepoDto>, StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let installed_ids: HashSet<String> = specs.iter().map(|s| s.id.clone()).collect();

    // Collect unique repo URLs from installed specs
    let mut seen_slugs: HashMap<String, String> = HashMap::new();
    for spec in &specs {
        if let Some(ref repo) = spec.repo {
            let slug = repo_slug(repo);
            seen_slugs.entry(slug).or_insert_with(|| repo.clone());
        }
    }

    let mut out: Vec<DiscoveredRepoDto> = Vec::new();
    for (slug, repo) in seen_slugs {
        let target_path = repo_checkout_path(&p_dir, &repo);
        if !target_path.is_dir() {
            continue;
        }
        let entries = load_registry_entries(&target_path);
        if entries.is_empty() {
            continue;
        }
        let mut discovered: Vec<DiscoveredPluginDto> = Vec::new();
        for entry in &entries {
            if installed_ids.contains(&entry.id) {
                continue;
            }
            let dir = entry.dir.as_deref().unwrap_or(&entry.id);
            let init_path = target_path.join(dir).join("init.luau");
            let meta = read_plugin_init_metadata(&init_path);
            discovered.push(DiscoveredPluginDto {
                id: entry.id.clone(),
                name: meta.name,
                description: meta.description,
                version: meta.version,
                category: meta.category,
            });
        }
        if !discovered.is_empty() {
            out.push(DiscoveredRepoDto {
                repo: repo.clone(),
                slug,
                entries: discovered,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn uninstall_plugin(app: AppHandle, plugin_id: String) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let mut specs = load_specs(&p_dir);
    let removed = specs.iter().find(|s| s.id == plugin_id).cloned();
    specs.retain(|s| s.id != plugin_id);

    let lazy_config_path = p_dir.join("lazy-config.luau");
    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;

    if let Some(removed_spec) = removed {
        if let Some(ref repo) = removed_spec.repo {
            let slug = repo_slug(repo);
            let still_used = specs.iter().any(|s| {
                s.repo
                    .as_ref()
                    .map(|r| repo_slug(r) == slug)
                    .unwrap_or(false)
            });
            if !still_used {
                let repo_path = repos_dir(&p_dir).join(&slug);
                if repo_path.is_dir() {
                    let _ = std::fs::remove_dir_all(&repo_path);
                }
            }
        } else {
            let flat_path = p_dir.join(&plugin_id);
            if flat_path.is_dir() {
                let _ = std::fs::remove_dir_all(&flat_path);
            }
        }
    }

    let cache_file = p_dir.join(".cache").join(format!("{}.luauc", plugin_id));
    if cache_file.is_file() {
        let _ = std::fs::remove_file(cache_file);
    }

    let _ = app.emit("plugin:reload", ());
    Ok(())
}
