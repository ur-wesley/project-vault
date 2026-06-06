use std::path::Path;

use crate::error::StableError;
use crate::lua::deps::{PluginDependency, dependency_ids, external_ids};
use crate::lua::loader::{
    PluginRegistryEntry, PluginSpec,     enrich_spec_from_repo_init, load_registry_entries, load_specs,
    merge_registry_into_lazy_config, read_plugin_init_metadata_for_spec,
    registry_entry_to_spec, repo_slug, topological_sort_specs, write_specs_to_file,
    PLUGIN_REGISTRY_FILE,
};
use crate::lua::plugin_git::{checkout_ref, clone_repo};
use crate::lua::vendor::ensure_external_installed;

fn repos_dir(plugins_dir: &Path) -> std::path::PathBuf {
    plugins_dir.join("repos")
}

fn repo_checkout_path(plugins_dir: &Path, repo: &str) -> std::path::PathBuf {
    repos_dir(plugins_dir).join(repo_slug(repo))
}

pub fn spec_exists(plugins_dir: &Path, plugin_id: &str) -> bool {
    load_specs(plugins_dir)
        .iter()
        .any(|s| s.id == plugin_id)
}

pub fn install_plugin_from_dependency(
    plugins_dir: &Path,
    dep: &PluginDependency,
) -> Result<(), StableError> {
    let PluginDependency::Spec(spec) = dep else {
        return Ok(());
    };
    let Some(repo) = &spec.repo else {
        return Ok(());
    };
    if spec_exists(plugins_dir, &spec.id) {
        return Ok(());
    }

    let target_path = repo_checkout_path(plugins_dir, repo);
    clone_repo(repo, &target_path)?;
    if let Some(pin) = dep.pin_ref() {
        checkout_ref(&target_path, pin)?;
    }

    let registry_path = target_path.join(PLUGIN_REGISTRY_FILE);
    let root_init = target_path.join("init.luau");
    let mut specs = load_specs(plugins_dir);

    if registry_path.is_file() {
        let registry_entries = load_registry_entries(&target_path);
        if registry_entries.is_empty() {
            return Err(StableError::new(
                crate::error::codes::INTERNAL,
                format!("{} parsed to zero plugins", PLUGIN_REGISTRY_FILE),
            ));
        }
        merge_registry_into_lazy_config(&mut specs, registry_entries, repo, &target_path);
    } else if root_init.is_file() {
        let mut single = registry_entry_to_spec(
            &PluginRegistryEntry {
                id: spec.id.clone(),
                dir: spec.dir.clone(),
            },
            repo,
        );
        enrich_spec_from_repo_init(&target_path, &mut single);
        if let Some(idx) = specs.iter().position(|s| s.id == single.id) {
            specs[idx].repo = Some(repo.clone());
            specs[idx].dir = single.dir.clone();
            enrich_spec_from_repo_init(&target_path, &mut specs[idx]);
        } else {
            specs.push(single);
        }
    } else if let Some(dir) = &spec.dir {
        let init_path = target_path.join(dir).join("init.luau");
        if !init_path.is_file() {
            return Err(StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("dependency init not found at {}", init_path.display()),
            ));
        }
        let mut single = registry_entry_to_spec(
            &PluginRegistryEntry {
                id: spec.id.clone(),
                dir: Some(dir.clone()),
            },
            repo,
        );
        enrich_spec_from_repo_init(&target_path, &mut single);
        specs.push(single);
    } else {
        return Err(StableError::new(
            crate::error::codes::NOT_FOUND,
            format!("No plugin manifest found for dependency repo {}", repo),
        ));
    }

    let _ = topological_sort_specs(&mut specs);
    write_specs_to_file(&plugins_dir.join("lazy-config.luau"), &specs).map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("write lazy-config: {}", e),
        )
    })?;
    Ok(())
}

pub fn resolve_plugin_deps(plugins_dir: &Path, plugin_id: &str) -> Result<(), StableError> {
    let specs = load_specs(plugins_dir);
    let spec = specs
        .iter()
        .find(|s| s.id == plugin_id)
        .ok_or_else(|| {
            StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("plugin '{}' not in lazy-config", plugin_id),
            )
        })?
        .clone();

    let meta = read_plugin_init_metadata_for_spec(plugins_dir, &spec);
    let deps = meta
        .dependencies
        .or(spec.dependencies)
        .unwrap_or_default();
    for dep in &deps {
        install_plugin_from_dependency(plugins_dir, dep)?;
    }

    let externals = meta.externals.unwrap_or_default();
    for ext in &externals {
        ensure_external_installed(plugins_dir, ext)?;
    }
    Ok(())
}

pub fn declared_dep_ids_for_spec(plugins_dir: &Path, spec: &PluginSpec) -> Vec<String> {
    let meta = read_plugin_init_metadata_for_spec(plugins_dir, spec);
    let deps = meta.dependencies.or(spec.dependencies.clone()).unwrap_or_default();
    dependency_ids(&deps)
}

pub fn declared_external_ids_for_spec(plugins_dir: &Path, spec: &PluginSpec) -> Vec<String> {
    let meta = read_plugin_init_metadata_for_spec(plugins_dir, spec);
    let exts = meta.externals.unwrap_or_default();
    external_ids(&exts)
}
