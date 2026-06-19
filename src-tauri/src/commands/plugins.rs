use std::collections::{HashSet, HashMap};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Emitter};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::lua::loader::{
    PluginCommandMetadata, PluginInfo, PluginManager, PluginRegistryEntry, load_specs,
    load_registry_entries, merge_registry_into_lazy_config, registry_entry_to_spec,
    enrich_spec_from_repo_init, repo_slug, topological_sort_specs, write_specs_to_file,
    PLUGIN_REGISTRY_FILE, OFFICIAL_PLUGINS_REPO, plugin_init_path, parse_plugin_init_metadata_str,
    read_plugin_init_metadata, diff_registry_against_specs,
};
use crate::lua::plugin_install::resolve_plugin_deps;
use crate::lua::vendor::{restore_vendor_lockfile, sync_vendor_lockfile};
use crate::lua::ui::UiBridge;

pub fn plugins_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("plugins")
}

fn repos_dir(plugins_dir: &Path) -> PathBuf {
    plugins_dir.join("repos")
}

fn repo_checkout_path(plugins_dir: &Path, repo: &str) -> PathBuf {
    repos_dir(plugins_dir).join(repo_slug(repo))
}

async fn get_disabled_plugins(db: &DbInstances) -> Result<HashSet<String>, StableError> {
    let pool = db::sqlite_pool(db).await?;
    let raw = db::get_setting(&pool, "disabled_plugins").await?;
    let set = match raw {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => HashSet::new(),
    };
    Ok(set)
}

async fn save_disabled_plugins(db: &DbInstances, set: &HashSet<String>) -> Result<(), StableError> {
    let pool = db::sqlite_pool(db).await?;
    let json = serde_json::to_string(set).unwrap_or_else(|_| "[]".to_string());
    db::set_setting(&pool, "disabled_plugins", &json).await
}

fn git_command() -> tokio::process::Command {
    crate::process_util::hidden_tokio_command("git")
}

async fn run_git(mut cmd: tokio::process::Command) -> Result<std::process::Output, StableError> {
    cmd.output().await.map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to spawn git: {}", e))
    })
}

async fn pull_repo_at(path: &Path) -> Result<(), StableError> {
    let mut pull = git_command();
    pull.current_dir(path).arg("pull");
    let out = run_git(pull).await?;
    if !out.status.success() {
        let err_msg = String::from_utf8_lossy(&out.stderr);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!("Git pull failed: {}", err_msg),
        ));
    }
    Ok(())
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
            crate::error::codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;
    Ok(discovered)
}

async fn update_repo_checkout(p_dir: &Path, repo: &str) -> Result<Vec<String>, StableError> {
    let path = repo_checkout_path(p_dir, repo);
    if !path.is_dir() {
        return Err(StableError::new(
            crate::error::codes::NOT_FOUND,
            "Repository checkout not found",
        ));
    }
    pull_repo_at(&path).await?;
    merge_repo_registry_if_present(p_dir, repo)
}

async fn repo_is_behind_upstream(path: &Path) -> bool {
    let mut fetch = git_command();
    fetch.current_dir(path).arg("fetch");
    let _ = run_git(fetch).await;

    let mut rev_head = git_command();
    rev_head.current_dir(path).arg("rev-parse").arg("HEAD");

    let mut rev_upstream = git_command();
    rev_upstream
        .current_dir(path)
        .arg("rev-parse")
        .arg("@{u}");

    if let (Ok(h_out), Ok(u_out)) = (run_git(rev_head).await, run_git(rev_upstream).await) {
        if h_out.status.success() && u_out.status.success() {
            let h_sha = String::from_utf8_lossy(&h_out.stdout).trim().to_string();
            let u_sha = String::from_utf8_lossy(&u_out.stdout).trim().to_string();
            return h_sha != u_sha;
        }
    }
    false
}

#[tauri::command]
pub fn get_official_plugins_repo() -> String {
    OFFICIAL_PLUGINS_REPO.to_string()
}

#[tauri::command]
pub async fn refresh_plugins_from_repos(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let mut specs = load_specs(&p_dir);
    for spec in &mut specs {
        if let Some(ref repo) = spec.repo {
            let repo_root = repo_checkout_path(&p_dir, repo);
            if repo_root.is_dir() {
                enrich_spec_from_repo_init(&repo_root, spec);
            }
        }
    }
    let lazy_config_path = p_dir.join("lazy-config.luau");
    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to write lazy-config.luau: {}", e))
    })?;
    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[tauri::command]
pub async fn open_plugins_dir(app: AppHandle) -> Result<(), StableError> {
    use tauri_plugin_opener::OpenerExt;

    let dir = plugins_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("Failed to create plugins directory: {}", e),
        )
    })?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| {
            StableError::new(
                crate::error::codes::INTERNAL,
                format!("Failed to open plugins directory: {}", e),
            )
        })?;
    Ok(())
}

#[tauri::command]
pub async fn list_plugin_commands(
    app: AppHandle,
    db: State<'_, DbInstances>,
) -> Result<Vec<PluginCommandMetadata>, StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    let disabled = get_disabled_plugins(&*db).await?;
    Ok(manager.list_plugin_commands(&disabled))
}

#[tauri::command]
pub async fn execute_plugin_command(
    app: AppHandle,
    db: State<'_, DbInstances>,
    bridge: State<'_, UiBridge>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
    plugin_id: String,
    command_id: String,
    context: serde_json::Value,
) -> Result<(), StableError> {
    let disabled = get_disabled_plugins(&*db).await?;
    if disabled.contains(&plugin_id) {
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!("Cannot execute command for deactivated plugin '{}'", plugin_id),
        ));
    }
    let p_dir = plugins_dir(&app);
    let (tx, rx) = tokio::sync::oneshot::channel();
    runtime.send(crate::lua::LuaTask::ExecuteCommand {
        plugins_dir: p_dir,
        app,
        bridge: (*bridge).clone(),
        plugin_id,
        command_id,
        context,
        tx,
    }).map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("failed to send lua command: {}", e)))?;

    rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("oneshot channel recv: {}", e)))?
}

#[tauri::command]
pub async fn list_plugins(
    app: AppHandle,
    db: State<'_, DbInstances>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
) -> Result<Vec<PluginInfo>, StableError> {
    let p_dir = plugins_dir(&app);
    let manager = PluginManager::new(p_dir);
    let disabled = get_disabled_plugins(&*db).await?;
    
    let active = runtime.active_plugins.lock().unwrap().clone();
    let times = runtime.load_times.lock().unwrap().clone();
    let mut list = manager.list_plugins(&disabled, &active, &times);

    let pool = db::sqlite_pool(&*db).await?;
    for p in &mut list {
        let scoped_key = format!("plugin:{}:active_flavor", p.id);
        if let Ok(Some(val)) = db::get_setting(&pool, &scoped_key).await {
            p.active_option = Some(val);
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn toggle_plugin(
    app: AppHandle,
    db: State<'_, DbInstances>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), StableError> {
    let mut disabled = get_disabled_plugins(&*db).await?;
    if enabled {
        disabled.remove(&plugin_id);
    } else {
        disabled.insert(plugin_id.clone());
    }
    save_disabled_plugins(&*db, &disabled).await?;

    if enabled {
        let p_dir = plugins_dir(&app);
        if let Err(e) = resolve_plugin_deps(&p_dir, &plugin_id) {
            eprintln!("[plugins] resolve deps for '{}': {}", plugin_id, e.message);
        }
    }

    let _ = app.emit("plugin:status-changed", serde_json::json!({
        "pluginId": plugin_id,
        "enabled": enabled
    }));

    Ok(())
}

#[tauri::command]
pub async fn get_tab_decorations(
    app: AppHandle,
    db: State<'_, DbInstances>,
    bridge: State<'_, UiBridge>,
    runtime: State<'_, crate::lua::LuaRuntimeState>,
    project_id: String,
    tab_id: String,
    element_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, crate::lua::loader::ElementDecorations>, StableError> {
    let p_dir = plugins_dir(&app);
    let disabled = get_disabled_plugins(&*db).await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    runtime.send(crate::lua::LuaTask::GetDecorations {
        plugins_dir: p_dir,
        app,
        bridge: (*bridge).clone(),
        disabled_ids: disabled,
        project_id,
        tab_id,
        element_ids,
        tx,
    }).map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("failed to send lua get_decorations: {}", e)))?;

    Ok(rx.await.map_err(|e| StableError::new(crate::error::codes::INTERNAL, format!("oneshot channel recv: {}", e)))?)
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
            StableError::new(crate::error::codes::INTERNAL, format!("Failed to create repos dir: {}", e))
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
                crate::error::codes::INTERNAL,
                format!("Git clone failed: {}", err_msg),
            ));
        }
    }

    if let Some(ref_val) = branch.or(tag).or(commit) {
        let mut checkout = git_command();
        checkout.current_dir(&target_path).arg("checkout").arg(ref_val);
        let _ = run_git(checkout).await;
    }

    Ok(target_path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonorepoEntryDto {
    pub id: String,
    pub dir: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonorepoDiscoveryDto {
    pub repo: String,
    pub slug: String,
    pub branch: Option<String>,
    pub tag: Option<String>,
    pub commit: Option<String>,
    pub kind: String, // "monorepo" | "single"
    pub entries: Vec<MonorepoEntryDto>,
}

fn enrich_entry_meta(target_path: &Path, entry: &PluginRegistryEntry, existing: bool) -> MonorepoEntryDto {
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
                crate::error::codes::INTERNAL,
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
            crate::error::codes::NOT_FOUND,
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
                crate::error::codes::INTERNAL,
                format!("{} parsed to zero plugins", PLUGIN_REGISTRY_FILE),
            ));
        }

        let filtered: Vec<PluginRegistryEntry> = match &selected_ids {
            Some(ids) => {
                if ids.is_empty() {
                    return Err(StableError::new(
                        crate::error::codes::EMPTY_SELECTION,
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
                crate::error::codes::EMPTY_SELECTION,
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
            crate::error::codes::NOT_FOUND,
            format!(
                "No {} or init.luau found at repository root",
                PLUGIN_REGISTRY_FILE
            ),
        ));
    }

    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to write lazy-config.luau: {}", e))
    })?;

    let _ = app.emit("plugin:reload", ());
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPluginDto {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepoDto {
    pub repo: String,
    pub slug: String,
    pub entries: Vec<DiscoveredPluginDto>,
}

#[tauri::command]
pub async fn get_pending_discoveries(app: AppHandle) -> Result<Vec<DiscoveredRepoDto>, StableError> {
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
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to write lazy-config.luau: {}", e))
    })?;

    if let Some(removed_spec) = removed {
        if let Some(ref repo) = removed_spec.repo {
            let slug = repo_slug(repo);
            let still_used = specs.iter().any(|s| {
                s.repo.as_ref().map(|r| repo_slug(r) == slug).unwrap_or(false)
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
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to write lazy-lock.json: {}", e))
    })?;

    Ok(())
}

#[tauri::command]
pub async fn restore_from_lockfile(app: AppHandle) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let lock_path = p_dir.join("lazy-lock.json");
    if !lock_path.is_file() {
        return Err(StableError::new(crate::error::codes::NOT_FOUND, "lazy-lock.json not found"));
    }

    let content = std::fs::read_to_string(&lock_path).map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("Failed to read lockfile: {}", e))
    })?;

    let lockfile: HashMap<String, serde_json::Value> = serde_json::from_str(&content).map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("Invalid lockfile JSON: {}", e))
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
                cmd.arg("clone").arg("--filter=blob:none").arg(r).arg(&target_path);
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
                show_cmd.current_dir(&path)
                    .arg("show")
                    .arg(format!("@{{u}}:{}", rel_path_str));

                if let Ok(out) = run_git(show_cmd).await {
                    if out.status.success() {
                        if let Ok(upstream_content) = String::from_utf8(out.stdout) {
                            let upstream_meta = parse_plugin_init_metadata_str(&upstream_content, None);
                            let local_meta = read_plugin_init_metadata(&local_init_path);
                            if let (Some(up_ver), Some(loc_ver)) = (upstream_meta.version, local_meta.version) {
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
            crate::error::codes::NOT_FOUND,
            format!("Plugin not found: {}", plugin_id),
        )
    })?;
    let repo = spec.repo.as_ref().ok_or_else(|| {
        StableError::new(
            crate::error::codes::NOT_FOUND,
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

#[tauri::command]
pub async fn get_plugin_load_stats(
    runtime: State<'_, crate::lua::LuaRuntimeState>,
) -> Result<HashMap<String, f64>, StableError> {
    let times = runtime.load_times.lock().unwrap().clone();
    Ok(times)
}

#[tauri::command]
pub async fn resolve_plugin_dependencies(
    app: AppHandle,
    plugin_id: String,
) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    resolve_plugin_deps(&p_dir, &plugin_id)?;
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
