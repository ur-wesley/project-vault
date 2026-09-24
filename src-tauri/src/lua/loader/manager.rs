use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use crate::lua::deps::{dependency_ids, external_ids};

use super::load::*;
use super::spec::*;

pub struct PluginManager {
    pub plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    pub fn list_plugin_commands(
        &self,
        disabled_ids: &HashSet<String>,
    ) -> Vec<PluginCommandMetadata> {
        let specs = load_specs(&self.plugins_dir);
        let mut commands = Vec::new();
        for spec in specs {
            if disabled_ids.contains(&spec.id) || !spec.enabled {
                continue;
            }
            let meta = read_plugin_init_metadata_for_spec(&self.plugins_dir, &spec);
            if meta.category.as_deref() == Some("library") {
                continue;
            }
            let mut cmds = spec.commands.clone().unwrap_or_default();
            if cmds.is_empty() {
                if let Some(from_init) = meta.commands {
                    cmds = from_init;
                }
            }
            for cmd in &mut cmds {
                cmd.plugin_id = spec.id.clone();
            }
            commands.extend(cmds);
        }
        commands
    }

    pub fn list_plugins(
        &self,
        disabled_ids: &HashSet<String>,
        active_plugins: &HashSet<String>,
        load_times: &HashMap<String, f64>,
    ) -> Vec<PluginInfo> {
        let specs = load_specs(&self.plugins_dir);
        let mut plugins = Vec::new();
        for spec in specs {
            let enabled = !disabled_ids.contains(&spec.id) && spec.enabled;
            let active = active_plugins.contains(&spec.id);
            let load_time_ms = load_times.get(&spec.id).copied().unwrap_or(0.0);

            let meta = read_plugin_init_metadata_for_spec(&self.plugins_dir, &spec);
            let name = meta
                .name
                .clone()
                .or(spec.name.clone())
                .unwrap_or_else(|| spec.id.clone());
            let description = meta.description.or(spec.description);
            let version = meta.version.or(spec.version);
            let category = meta.category.or(spec.category);
            let options = meta.options.or(spec.options);
            let config = meta.config.or(spec.config);
            let locales = meta.locales;
            let mut commands = spec.commands.clone().unwrap_or_default();
            if commands.is_empty() {
                if let Some(from_init) = meta.commands {
                    commands = from_init;
                }
            }
            let lazy = meta.lazy.unwrap_or(spec.lazy);
            let dependencies = dependency_ids(
                &meta
                    .dependencies
                    .or(spec.dependencies.clone())
                    .unwrap_or_default(),
            );
            let externals = external_ids(
                &meta
                    .externals
                    .or(spec.externals.clone())
                    .unwrap_or_default(),
            );

            for cmd in &mut commands {
                cmd.plugin_id = spec.id.clone();
            }

            let pages = meta.pages.clone().unwrap_or_default();

            plugins.push(PluginInfo {
                id: spec.id.clone(),
                name,
                description,
                version,
                category,
                enabled,
                commands,
                pages,
                locales,
                options,
                active_option: None,
                config,
                lazy,
                active,
                load_time_ms,
                repo: spec.repo,
                dir: spec.dir,
                local_path: spec.local_path,
                dependencies,
                externals,
                templates: meta.templates.clone(),
            });
        }
        plugins
    }
}
