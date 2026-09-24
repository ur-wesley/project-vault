use crate::lua::deps::{
    parse_external_dependencies, parse_plugin_dependencies, ExternalDependency, PluginDependency,
};
use crate::lua::engine::LuaEngine;
use mlua::LuaSerdeExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::load::topological_sort_specs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPageMetadata {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub default_pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandMetadata {
    pub id: String,
    pub title: String,
    pub scope: String, // "global" or "project"
    #[serde(default)]
    pub plugin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locales: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub enabled: bool,
    pub commands: Vec<PluginCommandMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<PluginPageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locales: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_option: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
    // Lazy loading fields
    pub lazy: bool,
    pub active: bool,
    pub load_time_ms: f64,
    pub repo: Option<String>,
    pub dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    pub dependencies: Vec<String>,
    pub externals: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub templates: Option<Vec<crate::commands::project_wizard::TemplateSummaryDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSpec {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub repo: Option<String>,
    #[serde(default)]
    pub lazy: bool,
    pub dir: Option<String>,
    /// Absolute path to a local source folder that shadows all other
    /// locations (live-link for local plugin development, all builds).
    pub local_path: Option<String>,
    pub dependencies: Option<Vec<PluginDependency>>,
    pub externals: Option<Vec<ExternalDependency>>,
    pub commands: Option<Vec<PluginCommandMetadata>>,
    pub cmd: Option<Vec<String>>,
    pub keys: Option<Vec<String>>,
    pub event: Option<Vec<String>>,
    pub category: Option<String>,
    pub version: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub config: Option<serde_json::Value>,
    pub options: Option<serde_json::Value>,
}

fn default_true() -> bool {
    true
}

pub const PLUGIN_REGISTRY_FILE: &str = "plugins.registry.luau";

pub const OFFICIAL_PLUGINS_REPO: &str = "https://github.com/ur-wesley/pv-plugins";

pub fn repo_slug(repo: &str) -> String {
    let trimmed = repo.trim_end_matches('/').trim_end_matches(".git");
    trimmed
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("plugin-repo")
        .to_string()
}

pub fn pv_plugins_workspace_root() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("pv-plugins");
    if root.join("plugins.registry.luau").is_file() {
        Some(root)
    } else {
        None
    }
}

fn workspace_plugin_root(spec: &PluginSpec) -> Option<PathBuf> {
    let root = pv_plugins_workspace_root()?;
    let subdir = spec
        .dir
        .as_deref()
        .filter(|d| !d.is_empty())
        .unwrap_or(&spec.id);
    let candidate = root.join(subdir);
    if candidate.join("init.luau").is_file() {
        Some(candidate)
    } else {
        None
    }
}

pub fn plugin_root_candidates(plugins_dir: &Path, spec: &PluginSpec) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    // An explicit local link always wins — in every build, including over the
    // debug workspace shadow below. Stale links fall through to the rest.
    if let Some(ref linked) = spec.local_path {
        if !linked.is_empty() {
            let p = PathBuf::from(linked);
            candidates.push(if p.is_absolute() {
                p
            } else {
                plugins_dir.join(p)
            });
        }
    }
    #[cfg(debug_assertions)]
    if let Some(ws) = workspace_plugin_root(spec) {
        candidates.push(ws);
    }
    if let Some(ref repo) = spec.repo {
        let base = plugins_dir.join("repos").join(repo_slug(repo));
        if let Some(ref dir) = spec.dir {
            if !dir.is_empty() {
                candidates.push(base.join(dir));
            }
        }
        candidates.push(base);
    }
    let flat = plugins_dir.join(&spec.id);
    candidates.push(flat.clone());
    if let Some(ref dir) = spec.dir {
        let nested = flat.join(dir);
        if nested != flat {
            candidates.push(nested);
        }
    }
    candidates
}

pub fn resolve_plugin_root(plugins_dir: &Path, spec: &PluginSpec) -> PathBuf {
    for root in plugin_root_candidates(plugins_dir, spec) {
        if root.join("init.luau").is_file() {
            return root;
        }
    }
    plugin_root_candidates(plugins_dir, spec)
        .into_iter()
        .next()
        .unwrap_or_else(|| plugins_dir.join(&spec.id))
}

pub fn plugin_init_path(plugins_dir: &Path, spec: &PluginSpec) -> PathBuf {
    resolve_plugin_root(plugins_dir, spec).join("init.luau")
}

pub fn spec_for_plugin_id<'a>(
    _plugins_dir: &Path,
    plugin_id: &str,
    specs: &'a [PluginSpec],
) -> Option<&'a PluginSpec> {
    specs.iter().find(|s| s.id == plugin_id)
}

pub(crate) fn parse_specs_file(path: &Path) -> Option<Vec<PluginSpec>> {
    let content = std::fs::read_to_string(path).ok()?;
    let lua = LuaEngine::create_instance().ok()?;
    let val: mlua::Value = lua.load(&content).eval().ok()?;
    let mut specs: Vec<PluginSpec> = lua.from_value(val).ok()?;
    let _ = topological_sort_specs(&mut specs);
    Some(specs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistryEntry {
    pub id: String,
    pub dir: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PluginInitMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub commands: Option<Vec<PluginCommandMetadata>>,
    pub pages: Option<Vec<PluginPageMetadata>>,
    pub locales: Option<serde_json::Value>,
    pub options: Option<serde_json::Value>,
    pub config: Option<serde_json::Value>,
    pub lazy: Option<bool>,
    pub cmd: Option<Vec<String>>,
    pub keys: Option<Vec<String>>,
    pub event: Option<Vec<String>>,
    pub dependencies: Option<Vec<PluginDependency>>,
    pub externals: Option<Vec<ExternalDependency>>,
    pub templates: Option<Vec<crate::commands::project_wizard::TemplateSummaryDto>>,
}

pub fn merge_registry_into_lazy_config(
    existing: &mut Vec<PluginSpec>,
    entries: Vec<PluginRegistryEntry>,
    repo_url: &str,
    repo_root: &Path,
) {
    for entry in entries {
        let mut new_spec = registry_entry_to_spec(&entry, repo_url);
        enrich_spec_from_repo_init(repo_root, &mut new_spec);
        if let Some(idx) = existing.iter().position(|s| s.id == new_spec.id) {
            existing[idx].repo = Some(repo_url.to_string());
            existing[idx].dir = new_spec.dir.clone();
            enrich_spec_from_repo_init(repo_root, &mut existing[idx]);
        } else {
            existing.push(new_spec);
        }
    }
    let _ = topological_sort_specs(existing);
}

fn parse_registry_file(path: &Path) -> Option<Vec<PluginRegistryEntry>> {
    let content = std::fs::read_to_string(path).ok()?;
    let lua = LuaEngine::create_instance().ok()?;
    let val: mlua::Value = lua.load(&content).eval().ok()?;
    let mut entries: Vec<PluginRegistryEntry> = lua.from_value(val).ok()?;
    for entry in &mut entries {
        if entry.dir.is_none() {
            entry.dir = Some(entry.id.clone());
        }
    }
    Some(entries)
}

pub fn load_registry_entries(repo_root: &Path) -> Vec<PluginRegistryEntry> {
    let registry_path = repo_root.join(PLUGIN_REGISTRY_FILE);
    if !registry_path.is_file() {
        return Vec::new();
    }
    parse_registry_file(&registry_path).unwrap_or_default()
}

/// Compare a registry's entry ids against the currently installed specs and
/// return the subset of ids that are NOT yet present. Used by update flows to
/// surface newly-discovered plugins without auto-installing them.
pub fn diff_registry_against_specs(
    entries: &[PluginRegistryEntry],
    specs: &[PluginSpec],
) -> Vec<String> {
    let existing: HashSet<String> = specs.iter().map(|s| s.id.clone()).collect();
    entries
        .iter()
        .filter(|e| !existing.contains(&e.id))
        .map(|e| e.id.clone())
        .collect()
}

pub fn registry_entry_to_spec(entry: &PluginRegistryEntry, repo_url: &str) -> PluginSpec {
    PluginSpec {
        id: entry.id.clone(),
        name: None,
        description: None,
        repo: Some(repo_url.to_string()),
        lazy: true,
        dir: entry.dir.clone(),
        local_path: None,
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
    }
}

fn parse_pages_from_table(table: &mlua::Table) -> Option<Vec<PluginPageMetadata>> {
    let pages_tbl: mlua::Table = table.get("pages").ok()?;
    let mut pages = Vec::new();
    for page_table in pages_tbl.sequence_values::<mlua::Table>().flatten() {
        let Ok(id) = page_table.get::<String>("id") else {
            continue;
        };
        let title = page_table
            .get::<String>("title")
            .unwrap_or_else(|_| id.clone());
        let icon = page_table.get::<String>("icon").ok();
        let default_pinned = page_table
            .get::<bool>("defaultPinned")
            .or_else(|_| page_table.get::<bool>("default_pinned"))
            .unwrap_or(false);
        let command = page_table.get::<String>("command").ok();
        pages.push(PluginPageMetadata {
            id,
            title,
            icon,
            default_pinned,
            command,
        });
    }
    if pages.is_empty() {
        None
    } else {
        Some(pages)
    }
}

fn parse_commands_from_table(table: &mlua::Table) -> Option<Vec<PluginCommandMetadata>> {
    let commands_tbl: mlua::Table = table.get("commands").ok()?;
    let mut commands = Vec::new();
    for cmd_table in commands_tbl.sequence_values::<mlua::Table>().flatten() {
        let Ok(id) = cmd_table.get::<String>("id") else {
            continue;
        };
        let title = cmd_table
            .get::<String>("title")
            .unwrap_or_else(|_| id.clone());
        let scope = cmd_table
            .get::<String>("scope")
            .unwrap_or_else(|_| "global".to_string());
        commands.push(PluginCommandMetadata {
            id,
            title,
            scope,
            plugin_id: String::new(),
            locales: None,
        });
    }
    if commands.is_empty() {
        None
    } else {
        Some(commands)
    }
}

fn parse_string_list(table: &mlua::Table, key: &str) -> Option<Vec<String>> {
    let list_tbl: mlua::Table = table.get(key).ok()?;
    let mut values = Vec::new();
    for value in list_tbl.sequence_values::<String>().flatten() {
        values.push(value);
    }
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn parse_templates_from_table(
    lua: &mlua::Lua,
    table: &mlua::Table,
) -> Option<Vec<crate::commands::project_wizard::TemplateSummaryDto>> {
    let templates_tbl: mlua::Table = table.get("templates").ok()?;
    let mut templates = Vec::new();
    for tmpl_table in templates_tbl.sequence_values::<mlua::Table>().flatten() {
        let Ok(id) = tmpl_table.get::<String>("id") else {
            continue;
        };
        let Ok(name) = tmpl_table.get::<String>("name") else {
            continue;
        };
        let description = tmpl_table.get::<String>("description").unwrap_or_default();
        let template_type = tmpl_table
            .get::<String>("type")
            .unwrap_or_else(|_| "files".to_string());

        let config_val = tmpl_table
            .get::<mlua::Value>("config")
            .ok()
            .and_then(|v| lua.from_value::<serde_json::Value>(v).ok())
            .unwrap_or(serde_json::json!({}));

        templates.push(crate::commands::project_wizard::TemplateSummaryDto {
            id,
            name,
            description,
            template_type,
            config: config_val,
        });
    }
    if templates.is_empty() {
        None
    } else {
        Some(templates)
    }
}

pub fn parse_plugin_init_metadata_str(
    content: &str,
    current_plugin_root: Option<String>,
) -> PluginInitMetadata {
    let mut meta = PluginInitMetadata::default();
    let Ok(lua) = LuaEngine::create_instance() else {
        return meta;
    };
    if let Some(root) = current_plugin_root {
        let _ = lua.globals().set("__current_plugin_root", root);
    }
    if let Ok(vault_tbl) = lua.globals().get::<mlua::Table>("vault") {
        let plugin_tbl = lua.create_table().ok();
        let external_tbl = lua.create_table().ok();
        if let (Some(p), Some(e)) = (plugin_tbl, external_tbl) {
            if let Ok(plugin_req) = lua.create_function(|lua, _: String| lua.create_table()) {
                let _ = p.set("require", plugin_req);
            }
            if let Ok(ext_req) = lua.create_function(|lua, _: String| lua.create_table()) {
                let _ = e.set("require", ext_req);
            }
            let _ = vault_tbl.set("plugin", p);
            let _ = vault_tbl.set("external", e);
        }
    }
    let chunk = format!("return (function()\n{}\nend)()", content);
    let table = match lua.load(&chunk).eval() {
        Ok(mlua::Value::Table(table)) => table,
        Ok(_) => {
            eprintln!("[plugins] failed to evaluate init metadata: expected plugin table");
            return meta;
        }
        Err(e) => {
            eprintln!("[plugins] failed to evaluate init metadata chunk: {e}");
            return meta;
        }
    };
    if let Ok(n) = table.get::<String>("name") {
        meta.name = Some(n);
    }
    if let Ok(desc) = table.get::<String>("description") {
        meta.description = Some(desc);
    }
    if let Ok(ver) = table.get::<String>("version") {
        meta.version = Some(ver);
    }
    if let Ok(cat) = table.get::<String>("category") {
        meta.category = Some(cat);
    }
    meta.locales = table
        .get::<mlua::Value>("locales")
        .ok()
        .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
    meta.options = table
        .get::<mlua::Value>("options")
        .ok()
        .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
    meta.config = table
        .get::<mlua::Value>("config")
        .ok()
        .and_then(|v| lua.from_value::<serde_json::Value>(v).ok());
    meta.commands = parse_commands_from_table(&table);
    meta.pages = parse_pages_from_table(&table);
    if let Ok(lazy) = table.get::<bool>("lazy") {
        meta.lazy = Some(lazy);
    }
    meta.cmd = parse_string_list(&table, "cmd");
    meta.keys = parse_string_list(&table, "keys");
    meta.event = parse_string_list(&table, "event");
    meta.dependencies = parse_plugin_dependencies(&table);
    meta.externals = parse_external_dependencies(&table);
    meta.templates = parse_templates_from_table(&lua, &table);
    meta
}

pub fn read_plugin_init_metadata(init_path: &Path) -> PluginInitMetadata {
    if !init_path.is_file() {
        return PluginInitMetadata::default();
    }
    let Ok(content) = std::fs::read_to_string(init_path) else {
        return PluginInitMetadata::default();
    };
    let parent = init_path.parent().map(|p| p.to_string_lossy().to_string());
    let meta = parse_plugin_init_metadata_str(&content, parent);
    if meta.name.is_none() && meta.version.is_none() {
        eprintln!(
            "[plugins] failed to evaluate init metadata from {}",
            init_path.display()
        );
    }
    meta
}

pub fn read_plugin_init_metadata_for_spec(
    plugins_dir: &Path,
    spec: &PluginSpec,
) -> PluginInitMetadata {
    read_plugin_init_metadata(&plugin_init_path(plugins_dir, spec))
}

fn apply_init_lazy_fields(spec: &mut PluginSpec, meta: &PluginInitMetadata) {
    if let Some(lazy) = meta.lazy {
        spec.lazy = lazy;
    }
    if meta.dependencies.is_some() {
        spec.dependencies = meta.dependencies.clone();
    }
    if meta.externals.is_some() {
        spec.externals = meta.externals.clone();
    }
    if meta.cmd.is_some() {
        spec.cmd = meta.cmd.clone();
    }
    if meta.keys.is_some() {
        spec.keys = meta.keys.clone();
    }
    if meta.event.is_some() {
        spec.event = meta.event.clone();
    }
}

pub fn enrich_spec_from_repo_init(repo_root: &Path, spec: &mut PluginSpec) {
    let dir = spec.dir.as_deref().unwrap_or(&spec.id);
    let init_path = repo_root.join(dir).join("init.luau");
    let meta = read_plugin_init_metadata(&init_path);
    apply_init_lazy_fields(spec, &meta);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecorationItem {
    pub icon: Option<String>,
    pub label: Option<String>,
    pub color: Option<String>,
    pub tooltip: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ElementDecorations {
    pub before: Option<Vec<DecorationItem>>,
    pub after: Option<Vec<DecorationItem>>,
}

#[cfg(test)]
pub(crate) fn pv_plugins_fixture_root() -> Option<PathBuf> {
    pv_plugins_workspace_root()
}

#[cfg(test)]
pub(crate) fn make_spec(id: &str, deps: Option<Vec<&str>>) -> PluginSpec {
    PluginSpec {
        id: id.to_string(),
        name: None,
        description: None,
        repo: None,
        lazy: false,
        dir: None,
        local_path: None,
        dependencies: deps.map(|v| {
            v.into_iter()
                .map(|s| PluginDependency::Id(s.to_string()))
                .collect()
        }),
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_registry_entries_parses_pv_plugins_template() {
        let Some(repo_root) = pv_plugins_fixture_root() else {
            eprintln!("skipping: pv-plugins submodule not initialized");
            return;
        };
        let entries = load_registry_entries(&repo_root);
        assert!(!entries.is_empty());
        let harpoon = entries
            .iter()
            .find(|e| e.id == "harpoon")
            .expect("harpoon entry");
        assert_eq!(harpoon.dir.as_deref(), Some("harpoon"));
    }

    #[test]
    fn test_registry_entry_to_spec_minimal() {
        let entry = PluginRegistryEntry {
            id: "harpoon".to_string(),
            dir: Some("harpoon".to_string()),
        };
        let spec = registry_entry_to_spec(&entry, "https://github.com/ur-wesley/pv-plugins");
        assert_eq!(spec.id, "harpoon");
        assert_eq!(
            spec.repo.as_deref(),
            Some("https://github.com/ur-wesley/pv-plugins")
        );
        assert!(spec.commands.is_none());
        assert!(spec.options.is_none());
        assert!(spec.lazy);
        assert!(spec.enabled);
    }

    #[test]
    fn test_read_plugin_init_metadata_harpoon_commands() {
        let Some(repo_root) = pv_plugins_fixture_root() else {
            eprintln!("skipping: pv-plugins submodule not initialized");
            return;
        };
        let init_path = repo_root.join("harpoon").join("init.luau");
        let meta = read_plugin_init_metadata(&init_path);
        assert_eq!(meta.name.as_deref(), Some("Project Harpoon"));
        let commands = meta.commands.expect("commands from init.luau");
        assert!(commands.iter().any(|c| c.id == "mark_project"));
        assert!(commands.iter().any(|c| c.id == "quick_menu"));
    }

    #[test]
    fn test_read_plugin_init_metadata_git_hygiene_pages() {
        let Some(repo_root) = pv_plugins_fixture_root() else {
            eprintln!("skipping: pv-plugins submodule not initialized");
            return;
        };
        let init_path = repo_root.join("git-hygiene").join("init.luau");
        if !init_path.is_file() {
            eprintln!("skipping: git-hygiene init.luau not present");
            return;
        }
        let meta = read_plugin_init_metadata(&init_path);
        let pages = meta.pages.expect("pages from init.luau");
        let dirty = pages.iter().find(|p| p.id == "dirty").expect("dirty page");
        assert_eq!(dirty.title, "Git Hygiene");
        assert!(dirty.default_pinned);
        assert_eq!(dirty.command.as_deref(), Some("show_dirty"));
    }

    #[test]
    fn test_resolve_plugin_root_monorepo() {
        let plugins_dir = std::path::Path::new("/data/plugins");
        let spec = PluginSpec {
            id: "harpoon".to_string(),
            repo: Some("https://github.com/ur-wesley/pv-plugins".to_string()),
            dir: Some("harpoon".to_string()),
            ..make_spec("harpoon", None)
        };
        let root = resolve_plugin_root(plugins_dir, &spec);
        assert!(root.ends_with("repos/pv-plugins/harpoon"));
    }

    #[test]
    fn test_resolve_plugin_root_legacy_flat() {
        let plugins_dir = std::path::Path::new("/data/plugins");
        let spec = make_spec("harpoon", None);
        let root = resolve_plugin_root(plugins_dir, &spec);
        assert!(root.ends_with("harpoon"));
    }

    #[test]
    fn test_local_path_wins_over_repo_and_flat() {
        let plugins_dir = std::path::Path::new("/data/plugins");
        let mut spec = make_spec("git-hygiene", None);
        spec.repo = Some("https://github.com/ur-wesley/pv-plugins".to_string());
        spec.dir = Some("git-hygiene".to_string());
        spec.local_path = Some("/dev/pv-plugins-fork/git-hygiene".to_string());
        let candidates = plugin_root_candidates(plugins_dir, &spec);
        assert_eq!(
            candidates.first().unwrap(),
            &PathBuf::from("/dev/pv-plugins-fork/git-hygiene")
        );
    }

    #[test]
    fn test_parse_templates_from_table() {
        let lua = LuaEngine::create_instance().unwrap();
        let chunk = r#"
        return {
            templates = {
                {
                    id = "my-custom-template",
                    name = "My Custom Template",
                    description = "Custom description",
                    type = "plugin",
                    config = {
                        pluginId = "my-plugin",
                        commandId = "my-cmd"
                    }
                }
            }
        }
        "#;
        let table: mlua::Table = lua.load(chunk).eval().unwrap();
        let templates = parse_templates_from_table(&lua, &table).unwrap();
        assert_eq!(templates.len(), 1);
        let t = &templates[0];
        assert_eq!(t.id, "my-custom-template");
        assert_eq!(t.name, "My Custom Template");
        assert_eq!(t.description, "Custom description");
        assert_eq!(t.template_type, "plugin");
        assert_eq!(t.config["pluginId"], "my-plugin");
        assert_eq!(t.config["commandId"], "my-cmd");
    }
}
