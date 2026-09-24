use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use crate::error::{codes, StableError};
use crate::lua::loader::{
    load_registry_entries, load_specs, read_plugin_init_metadata, topological_sort_specs,
    write_specs_to_file, PLUGIN_REGISTRY_FILE,
};
use crate::lua::plugin_install::resolve_plugin_deps;

use super::dto::{LocalFolderDiscoveryDto, LocalFolderEntryDto};
use super::paths::plugins_dir;

fn sanitize_local_plugin_id(raw: &str) -> Result<String, StableError> {
    let trimmed = raw.trim();
    let base = trimmed
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    let collapsed = {
        let mut out = String::with_capacity(cleaned.len());
        let mut last_dash = false;
        for c in cleaned.chars() {
            if c == '-' {
                if !last_dash {
                    out.push(c);
                }
                last_dash = true;
            } else {
                out.push(c);
                last_dash = false;
            }
        }
        out
    };
    if collapsed.is_empty() || collapsed.len() > 64 {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Could not derive a valid plugin id from the folder name (use a-z, 0-9, '-')",
        ));
    }
    Ok(collapsed)
}

fn resolve_local_source_root(src_path: &str) -> Result<PathBuf, StableError> {
    let src = PathBuf::from(src_path);
    if !src.exists() {
        return Err(StableError::new(
            codes::NOT_FOUND,
            format!("Local plugin path not found: {}", src_path),
        ));
    }
    if src.is_file() {
        if src
            .file_name()
            .is_some_and(|n| n == "init.luau" || n == "init.lua")
        {
            return Ok(src.parent().unwrap_or(Path::new(".")).to_path_buf());
        }
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Pick a plugin folder containing init.luau (or the init.luau file itself)",
        ));
    }
    Ok(src)
}

fn apply_local_init_hints(spec: &mut crate::lua::loader::PluginSpec, dest_root: &Path) {
    let meta = read_plugin_init_metadata(&dest_root.join("init.luau"));
    spec.lazy = meta.lazy.unwrap_or(false);
    spec.cmd = meta.cmd;
    spec.keys = meta.keys;
    spec.event = meta.event;
    spec.dependencies = meta.dependencies;
    spec.externals = meta.externals;
}

fn write_linked_plugin_spec(
    p_dir: &Path,
    plugin_id: &str,
    link_root: &Path,
) -> Result<(), StableError> {
    let link_str = link_root.to_string_lossy().to_string();
    let mut specs = load_specs(p_dir);
    if let Some(existing) = specs.iter_mut().find(|s| s.id == plugin_id) {
        existing.repo = None;
        existing.dir = None;
        existing.local_path = Some(link_str);
        existing.enabled = true;
        apply_local_init_hints(existing, link_root);
    } else {
        let mut spec = crate::lua::loader::PluginSpec {
            id: plugin_id.to_string(),
            name: None,
            description: None,
            repo: None,
            lazy: false,
            dir: None,
            local_path: Some(link_str),
            dependencies: None,
            externals: None,
            commands: None,
            cmd: None,
            keys: None,
            event: None,
            category: None,
            version: None,
            enabled: true,
            config: None,
            options: None,
        };
        apply_local_init_hints(&mut spec, link_root);
        specs.push(spec);
        let _ = topological_sort_specs(&mut specs);
    }
    let lazy_config_path = p_dir.join("lazy-config.luau");
    write_specs_to_file(&lazy_config_path, &specs).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to write lazy-config.luau: {}", e),
        )
    })?;
    Ok(())
}

fn require_plugin_root_with_init(src_root: &Path) -> Result<(), StableError> {
    if src_root.join("init.luau").is_file() {
        return Ok(());
    }
    if src_root.join("plugins.registry.luau").is_file() {
        return Err(StableError::new(
            codes::NOT_FOUND,
            "This is a monorepo root (plugins.registry.luau). Pick one of its plugin subfolders, or use folder discovery to choose.",
        ));
    }
    Err(StableError::new(
        codes::NOT_FOUND,
        "No init.luau found in the selected folder. Pick a plugin folder with init.luau at its root.",
    ))
}

/// Link a local folder as a real plugin: the spec stores `local_path` and the
/// loader reads the sources live (edits hot-reload, debug and release builds).
/// Same id replaces any installed (store or local) plugin.
/// Returns the installed plugin id.

#[tauri::command]
pub async fn install_plugin_local(
    app: AppHandle,
    src_path: String,
    plugin_id: Option<String>,
    overwrite: Option<bool>,
    subdir: Option<String>,
) -> Result<String, StableError> {
    let p_dir = plugins_dir(&app);
    std::fs::create_dir_all(&p_dir).map_err(|e| {
        StableError::new(
            codes::INTERNAL,
            format!("Failed to create plugins directory: {}", e),
        )
    })?;

    let mut src_root = resolve_local_source_root(&src_path)?;
    if let Some(sub) = subdir {
        if !sub.is_empty() {
            src_root = src_root.join(sub);
        }
    }
    require_plugin_root_with_init(&src_root)?;

    let default_id = src_root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let wanted = plugin_id.unwrap_or(default_id);
    let id = sanitize_local_plugin_id(&wanted)?;

    if !overwrite.unwrap_or(false) {
        let specs = load_specs(&p_dir);
        if specs.iter().any(|s| s.id == id) {
            return Err(StableError::new(
                codes::ALREADY_EXISTS,
                format!(
                    "Plugin '{}' is already installed. Link with overwrite to replace it.",
                    id
                ),
            ));
        }
    }

    write_linked_plugin_spec(&p_dir, &id, &src_root)?;

    let cache_file = p_dir.join(".cache").join(format!("{}.luauc", id));
    let _ = std::fs::remove_file(cache_file);

    if let Err(e) = resolve_plugin_deps(&p_dir, &id) {
        eprintln!(
            "[plugins] resolve deps for local '{}': {}",
            id, e.message
        );
    }

    let _ = app.emit("plugin:reload", ());
    Ok(id)
}

/// Point an already-linked local plugin at a (possibly different) source folder.
#[tauri::command]
pub async fn reimport_plugin_local(
    app: AppHandle,
    plugin_id: String,
    src_path: String,
) -> Result<(), StableError> {
    let p_dir = plugins_dir(&app);
    let specs = load_specs(&p_dir);
    let spec = specs.iter().find(|s| s.id == plugin_id).ok_or_else(|| {
        StableError::new(
            codes::NOT_FOUND,
            format!("Plugin not found: {}", plugin_id),
        )
    })?;
    if spec.repo.is_some() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "Plugin was installed from git; link a local folder to override it instead",
        ));
    }

    let src_root = resolve_local_source_root(&src_path)?;
    require_plugin_root_with_init(&src_root)?;

    write_linked_plugin_spec(&p_dir, &plugin_id, &src_root)?;

    let cache_file = p_dir.join(".cache").join(format!("{}.luauc", plugin_id));
    let _ = std::fs::remove_file(cache_file);

    if let Err(e) = resolve_plugin_deps(&p_dir, &plugin_id) {
        eprintln!(
            "[plugins] resolve deps for local '{}': {}",
            plugin_id, e.message
        );
    }

    let _ = app.emit("plugin:reload", ());
    Ok(())
}

/// Inspect a local folder: single plugin (root init.luau) or monorepo
/// (plugins.registry.luau) with per-entry metadata. Used by the
/// "Load local folder" flow so users can pick a repo root or a subfolder.
#[tauri::command]
pub async fn discover_local_folder(
    app: AppHandle,
    src_path: String,
) -> Result<LocalFolderDiscoveryDto, StableError> {
    let p_dir = plugins_dir(&app);
    let src_root = resolve_local_source_root(&src_path)?;
    let specs = load_specs(&p_dir);
    let installed_ids: HashSet<String> = specs.iter().map(|s| s.id.clone()).collect();
    let src_display = src_root.to_string_lossy().to_string();

    if src_root.join("init.luau").is_file() {
        let meta = read_plugin_init_metadata(&src_root.join("init.luau"));
        let default_id = src_root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let id = sanitize_local_plugin_id(&default_id)?;
        return Ok(LocalFolderDiscoveryDto {
            src_path: src_display,
            kind: "single".to_string(),
            entries: vec![LocalFolderEntryDto {
                id: id.clone(),
                dir: None,
                name: meta.name,
                description: meta.description,
                version: meta.version,
                category: meta.category,
                existing: installed_ids.contains(&id),
            }],
        });
    }

    if src_root.join(PLUGIN_REGISTRY_FILE).is_file() {
        let entries = load_registry_entries(&src_root);
        if entries.is_empty() {
            return Err(StableError::new(
                codes::INTERNAL,
                format!("{} parsed to zero plugins", PLUGIN_REGISTRY_FILE),
            ));
        }
        let dtos: Vec<LocalFolderEntryDto> = entries
            .iter()
            .map(|e| {
                let dir = e.dir.as_deref().unwrap_or(&e.id);
                let meta = read_plugin_init_metadata(&src_root.join(dir).join("init.luau"));
                LocalFolderEntryDto {
                    id: e.id.clone(),
                    dir: e.dir.clone(),
                    name: meta.name,
                    description: meta.description,
                    version: meta.version,
                    category: meta.category,
                    existing: installed_ids.contains(&e.id),
                }
            })
            .collect();
        return Ok(LocalFolderDiscoveryDto {
            src_path: src_display,
            kind: "monorepo".to_string(),
            entries: dtos,
        });
    }

    Err(StableError::new(
        codes::NOT_FOUND,
        "No init.luau or plugins.registry.luau found in the selected folder. Pick a plugin folder or a monorepo root.",
    ))
}

#[cfg(test)]
mod local_install_tests {
    use super::*;

    #[test]
    fn sanitize_derives_id_from_folder_name() {
        assert_eq!(
            sanitize_local_plugin_id("git-hygiene").unwrap(),
            "git-hygiene"
        );
        assert_eq!(
            sanitize_local_plugin_id("My Cool Plugin!").unwrap(),
            "my-cool-plugin"
        );
        assert_eq!(
            sanitize_local_plugin_id("C:\\dev\\my_plugin").unwrap(),
            "my-plugin"
        );
    }

    #[test]
    fn sanitize_rejects_empty() {
        assert!(sanitize_local_plugin_id("!!!").is_err());
        assert!(sanitize_local_plugin_id("").is_err());
    }

    #[test]
    fn require_init_rejects_monorepo_root_with_hint() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("repo");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("plugins.registry.luau"), "return {}").unwrap();

        let err = require_plugin_root_with_init(&dir).unwrap_err();
        assert!(err.message.contains("monorepo"));
    }

    #[test]
    fn source_root_accepts_init_file_directly() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("plug");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("init.luau"), "return {}").unwrap();
        let file = dir.join("init.luau").to_string_lossy().to_string();

        let resolved = resolve_local_source_root(&file).unwrap();
        assert_eq!(resolved, dir);
        assert!(resolve_local_source_root(tmp.path().join("missing").to_str().unwrap()).is_err());
    }
}
