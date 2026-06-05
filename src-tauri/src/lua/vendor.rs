use std::collections::HashMap;
use std::path::{Path, PathBuf};

use mlua::Lua;

use crate::error::StableError;
use crate::lua::deps::{
    ExternalDependency, ExternalLockEntry, VENDOR_LOCK_FILE, is_allowed_git_url,
    load_vendor_lock, write_vendor_lock,
};
use crate::lua::plugin_git::{checkout_ref, clone_repo, rev_parse_head};

pub fn vendor_dir(plugins_dir: &Path) -> PathBuf {
    plugins_dir.join("vendor")
}

pub fn vendor_checkout_path(plugins_dir: &Path, id: &str) -> PathBuf {
    vendor_dir(plugins_dir).join(id)
}

pub fn vendor_lock_path(plugins_dir: &Path) -> PathBuf {
    plugins_dir.join(VENDOR_LOCK_FILE)
}

pub fn merge_vendor_lock(
    plugins_dir: &Path,
    dep: &ExternalDependency,
    commit: &str,
) -> Result<(), StableError> {
    let lua = crate::lua::engine::LuaEngine::create_instance().map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("lua init: {}", e))
    })?;
    let lock_path = vendor_lock_path(plugins_dir);
    let mut entries = load_vendor_lock(&lua, &lock_path);
    let new_entry = {
        let mut entry = dep.to_lock_entry(Some(commit.to_string()));
        if entry.repo.is_empty() {
            if let Some(existing) = entries.iter().find(|e| e.id == entry.id) {
                entry.repo = existing.repo.clone();
                if entry.main == "init.luau" && !existing.main.is_empty() {
                    entry.main = existing.main.clone();
                }
            }
        }
        entry
    };

    if let Some(existing) = entries.iter().find(|e| e.id == new_entry.id) {
        if !existing.repo.is_empty()
            && !new_entry.repo.is_empty()
            && existing.repo != new_entry.repo
        {
            return Err(StableError::new(
                crate::error::codes::INTERNAL,
                format!(
                    "Conflicting repos for external '{}': '{}' vs '{}'",
                    new_entry.id, existing.repo, new_entry.repo
                ),
            ));
        }
    }

    entries.retain(|e| e.id != new_entry.id);
    entries.push(new_entry);
    write_vendor_lock(&lock_path, &entries).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("write vendor-lock: {}", e),
        )
    })?;
    Ok(())
}

pub fn resolve_external_spec(
    plugins_dir: &Path,
    dep: &ExternalDependency,
) -> Result<ExternalLockEntry, StableError> {
    let lua = crate::lua::engine::LuaEngine::create_instance().map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("lua init: {}", e))
    })?;
    let lock_path = vendor_lock_path(plugins_dir);
    let entries = load_vendor_lock(&lua, &lock_path);

    match dep {
        ExternalDependency::Id(id) => entries
            .into_iter()
            .find(|e| e.id == *id)
            .ok_or_else(|| {
                StableError::new(
                    crate::error::codes::NOT_FOUND,
                    format!("external '{}' not found in vendor-lock", id),
                )
            }),
        ExternalDependency::Spec(spec) => {
            if let Some(repo) = &spec.repo {
                if !is_allowed_git_url(repo) {
                    return Err(StableError::new(
                        crate::error::codes::INVALID_PATH,
                        format!("external repo URL not allowed: {}", repo),
                    ));
                }
                let checkout = vendor_checkout_path(plugins_dir, &spec.id);
                clone_repo(repo, &checkout)?;
                if let Some(pin) = dep.pin_ref() {
                    checkout_ref(&checkout, pin)?;
                }
                let commit = rev_parse_head(&checkout)?;
                merge_vendor_lock(plugins_dir, dep, &commit)?;
                Ok(ExternalLockEntry {
                    id: spec.id.clone(),
                    repo: repo.clone(),
                    main: spec.main.clone().unwrap_or_else(|| "init.luau".to_string()),
                    commit,
                })
            } else if let Some(existing) = entries.iter().find(|e| e.id == spec.id) {
                Ok(existing.clone())
            } else {
                Err(StableError::new(
                    crate::error::codes::NOT_FOUND,
                    format!("external '{}' has no repo and is not in vendor-lock", spec.id),
                ))
            }
        }
    }
}

pub fn ensure_external_installed(
    plugins_dir: &Path,
    dep: &ExternalDependency,
) -> Result<ExternalLockEntry, StableError> {
    let entry = resolve_external_spec(plugins_dir, dep)?;
    let checkout = vendor_checkout_path(plugins_dir, &entry.id);
    if !checkout.is_dir() {
        if entry.repo.is_empty() {
            return Err(StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("vendor checkout missing for external '{}'", entry.id),
            ));
        }
        clone_repo(&entry.repo, &checkout)?;
    }
    if !entry.commit.is_empty() {
        let _ = checkout_ref(&checkout, &entry.commit);
    }
    Ok(entry)
}

pub fn sync_vendor_lockfile(plugins_dir: &Path) -> Result<Vec<ExternalLockEntry>, StableError> {
    let lua = crate::lua::engine::LuaEngine::create_instance().map_err(|e| {
        StableError::new(crate::error::codes::INTERNAL, format!("lua init: {}", e))
    })?;
    let lock_path = vendor_lock_path(plugins_dir);
    let entries = load_vendor_lock(&lua, &lock_path);
    let mut updated = Vec::new();
    for entry in entries {
        let checkout = vendor_checkout_path(plugins_dir, &entry.id);
        if checkout.is_dir() {
            let commit = rev_parse_head(&checkout)?;
            let mut next = entry.clone();
            next.commit = commit;
            updated.push(next);
        } else {
            updated.push(entry);
        }
    }
    write_vendor_lock(&lock_path, &updated).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("write vendor-lock: {}", e),
        )
    })?;
    Ok(updated)
}

pub fn restore_vendor_lockfile(plugins_dir: &Path) -> Result<(), StableError> {
    let lua = Lua::new();
    let entries = load_vendor_lock(&lua, &vendor_lock_path(plugins_dir));
    let mut seen: HashMap<String, bool> = HashMap::new();
    for entry in entries {
        if entry.repo.is_empty() {
            continue;
        }
        let checkout = vendor_checkout_path(plugins_dir, &entry.id);
        if seen.get(&entry.id).copied().unwrap_or(false) {
            if !entry.commit.is_empty() {
                let _ = checkout_ref(&checkout, &entry.commit);
            }
            continue;
        }
        clone_repo(&entry.repo, &checkout)?;
        if !entry.commit.is_empty() {
            checkout_ref(&checkout, &entry.commit)?;
        }
        seen.insert(entry.id, true);
    }
    Ok(())
}
