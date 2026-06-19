use std::path::{Path, PathBuf};
use std::collections::{HashSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use crate::lua::deps::{
    ExternalDependency, PluginDependency, dependency_ids, external_ids,
    parse_external_dependencies, parse_plugin_dependencies,
};
use crate::lua::engine::LuaEngine;
use crate::lua::plugin_install::{install_plugin_from_dependency, resolve_plugin_deps};
use crate::lua::require::{cache_external_module, invalidate_plugin_modules, load_file_module};
use crate::lua::vendor::{ensure_external_installed, vendor_checkout_path};
use mlua::LuaSerdeExt;
use tauri::Emitter;

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

pub fn plugin_root_candidates(plugins_dir: &Path, spec: &PluginSpec) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
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

fn parse_specs_file(path: &Path) -> Option<Vec<PluginSpec>> {
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

fn parse_templates_from_table(lua: &mlua::Lua, table: &mlua::Table) -> Option<Vec<crate::commands::project_wizard::TemplateSummaryDto>> {
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
        let template_type = tmpl_table.get::<String>("type").unwrap_or_else(|_| "files".to_string());
        
        let config_val = tmpl_table.get::<mlua::Value>("config").ok()
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

pub fn parse_plugin_init_metadata_str(content: &str, current_plugin_root: Option<String>) -> PluginInitMetadata {
    let mut meta = PluginInitMetadata::default();
    let Ok(lua) = LuaEngine::create_instance() else {
        return meta;
    };
    if let Some(root) = current_plugin_root {
        let _ = lua.globals().set(
            "__current_plugin_root",
            root,
        );
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
    let Ok(mlua::Value::Table(table)) = lua.load(&chunk).eval() else {
        return meta;
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

pub fn read_plugin_init_metadata_for_spec(plugins_dir: &Path, spec: &PluginSpec) -> PluginInitMetadata {
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

pub struct PluginManager {
    pub plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    pub fn list_plugin_commands(&self, disabled_ids: &HashSet<String>) -> Vec<PluginCommandMetadata> {
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
            let externals = external_ids(&meta.externals.or(spec.externals.clone()).unwrap_or_default());

            for cmd in &mut commands {
                cmd.plugin_id = spec.id.clone();
            }

            plugins.push(PluginInfo {
                id: spec.id.clone(),
                name,
                description,
                version,
                category,
                enabled,
                commands,
                locales,
                options,
                active_option: None,
                config,
                lazy,
                active,
                load_time_ms,
                repo: spec.repo,
                dir: spec.dir,
                dependencies,
                externals,
                templates: meta.templates.clone(),
            });
        }
        plugins
    }
}

pub enum LuaTask {
    ExecuteCommand {
        plugins_dir: PathBuf,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        plugin_id: String,
        command_id: String,
        context: serde_json::Value,
        tx: tokio::sync::oneshot::Sender<Result<(), crate::error::StableError>>,
    },
    GetDecorations {
        plugins_dir: PathBuf,
        app: tauri::AppHandle,
        bridge: crate::lua::ui::UiBridge,
        disabled_ids: HashSet<String>,
        project_id: String,
        tab_id: String,
        element_ids: Vec<String>,
        tx: tokio::sync::oneshot::Sender<HashMap<String, ElementDecorations>>,
    },
}

pub struct LuaRuntimeState {
    sender: std::sync::Mutex<std::sync::mpsc::Sender<LuaTask>>,
    pub active_plugins: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    pub load_times: std::sync::Arc<std::sync::Mutex<HashMap<String, f64>>>,
}

impl LuaRuntimeState {
    pub fn new() -> Self {
        let (sender, receiver) = std::sync::mpsc::channel::<LuaTask>();
        let active_plugins = std::sync::Arc::new(std::sync::Mutex::new(HashSet::new()));
        let load_times = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        let active_plugins_c = active_plugins.clone();
        let load_times_c = load_times.clone();

        std::thread::Builder::new()
            .name("lua-worker".to_string())
            .spawn(move || {
                let mut shared_lua: Option<mlua::Lua> = None;

                while let Ok(task) = receiver.recv() {
                    match task {
                        LuaTask::ExecuteCommand { plugins_dir, app, bridge, plugin_id, command_id, context, tx } => {
                            let res = (|| {
                                let lua = match shared_lua.as_ref() {
                                    Some(l) => l,
                                    None => {
                                        let l = LuaEngine::create_instance_with_context(
                                            Some(app.clone()),
                                            Some(bridge.clone()),
                                            None,
                                        ).map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua engine setup: {}", e))
                                        })?;
                                        
                                        let loaded_tbl = l.create_table().map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("create loaded table: {}", e))
                                        })?;
                                        l.globals().set("__loaded_plugins", loaded_tbl).map_err(|e| {
                                            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set loaded table: {}", e))
                                        })?;
                                        setup_runtime_helpers(
                                            &l,
                                            plugins_dir.clone(),
                                            active_plugins_c.clone(),
                                            load_times_c.clone(),
                                        )?;
                                        
                                        shared_lua = Some(l);
                                        shared_lua.as_ref().unwrap()
                                    }
                                };

                                let specs = load_specs(&plugins_dir);
                                register_declared_graph(lua, &plugins_dir, &specs)?;

                                let is_loaded = active_plugins_c.lock().unwrap().contains(&plugin_id);
                                if !is_loaded {
                                    let mut stack = HashSet::new();
                                    ensure_plugin_loaded(
                                        lua,
                                        &plugins_dir,
                                        &plugin_id,
                                        &active_plugins_c,
                                        &load_times_c,
                                        &mut stack,
                                    )?;
                                }

                                lua.globals().set("__current_plugin_id", plugin_id.clone()).map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set current plugin: {}", e))
                                })?;

                                let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins").map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get loaded table: {}", e))
                                })?;
                                let plugin_table: mlua::Table = loaded_tbl.get(plugin_id.as_str()).map_err(|e| {
                                    crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get plugin table: {}", e))
                                })?;

                                if let Ok(execute_fn) = plugin_table.get::<mlua::Function>("execute") {
                                    let context_lua = lua.to_value(&context).map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("serialize context: {}", e))
                                    })?;
                                    
                                    let xpcall_fn: mlua::Function = lua.globals().get("xpcall").map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get xpcall: {}", e))
                                    })?;

                                    let error_handler = lua.create_function(|_, err: String| {
                                        Ok(err)
                                    }).map_err(|e| {
                                        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("create err handler: {}", e))
                                    })?;

                                    let app_err = app.clone();
                                    let pid_err = plugin_id.clone();
                                    let res_val = tauri::async_runtime::block_on(async move {
                                        xpcall_fn.call_async::<mlua::Value>((execute_fn, error_handler, command_id, context_lua)).await
                                    });

                                    match res_val {
                                        Ok(val) => {
                                            if let Ok((success, err_msg)) = lua.from_value::<(bool, Option<String>)>(val) {
                                                if !success {
                                                    let err_str = err_msg.unwrap_or_else(|| "unknown Lua error".to_string());
                                                    eprintln!("[PLUGIN:ERROR] '{}': {}", pid_err, err_str);
                                                    let _ = app_err.emit("plugin:log", serde_json::json!({
                                                        "pluginId": pid_err,
                                                        "level": "error",
                                                        "message": format!("xpcall error: {}", err_str)
                                                    }));
                                                    return Err(crate::error::StableError::new(
                                                        crate::error::codes::INTERNAL,
                                                        format!("Lua execution error: {}", err_str),
                                                    ));
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!("[PLUGIN:ERROR] '{}' execution failed: {}", pid_err, e);
                                            let _ = app_err.emit("plugin:log", serde_json::json!({
                                                "pluginId": pid_err,
                                                "level": "error",
                                                "message": format!("Execution panic: {}", e)
                                            }));
                                            return Err(crate::error::StableError::new(
                                                crate::error::codes::INTERNAL,
                                                format!("Lua execution panic: {}", e),
                                            ));
                                        }
                                    }
                                    Ok(())
                                } else {
                                    // Some plugins (like themes) don't have execute functions, they just return config.
                                    // That is valid. Let's return Ok.
                                    Ok(())
                                }
                            })();
                            let _ = tx.send(res);
                        }
                        LuaTask::GetDecorations { plugins_dir, app, bridge, disabled_ids, project_id, tab_id, element_ids, tx } => {
                            let mut merged = HashMap::new();
                            let _ = (|| {
                                let lua = match shared_lua.as_ref() {
                                    Some(l) => l,
                                    None => {
                                        let l = LuaEngine::create_instance_with_context(
                                            Some(app.clone()),
                                            Some(bridge.clone()),
                                            None,
                                        ).ok()?;
                                        let loaded_tbl = l.create_table().ok()?;
                                        l.globals().set("__loaded_plugins", loaded_tbl).ok()?;
                                        let _ = setup_runtime_helpers(
                                            &l,
                                            plugins_dir.clone(),
                                            active_plugins_c.clone(),
                                            load_times_c.clone(),
                                        );
                                        shared_lua = Some(l);
                                        shared_lua.as_ref().unwrap()
                                    }
                                };

                                let specs = load_specs(&plugins_dir);
                                let _ = register_declared_graph(lua, &plugins_dir, &specs);
                                
                                for spec in &specs {
                                    let plugin_id = spec.id.clone();
                                    if disabled_ids.contains(&plugin_id) || !spec.enabled {
                                        continue;
                                    }
                                    
                                    let is_loaded = active_plugins_c.lock().unwrap().contains(&plugin_id);
                                    if !is_loaded {
                                        let mut stack = HashSet::new();
                                        if ensure_plugin_loaded(
                                            lua,
                                            &plugins_dir,
                                            &plugin_id,
                                            &active_plugins_c,
                                            &load_times_c,
                                            &mut stack,
                                        ).is_err() {
                                            continue;
                                        }
                                    }

                                    let _ = lua.globals().set("__current_plugin_id", plugin_id.clone());

                                    let loaded_tbl: mlua::Table = match lua.globals().get("__loaded_plugins") {
                                        Ok(t) => t,
                                        Err(_) => continue,
                                    };
                                    let plugin_table: mlua::Table = match loaded_tbl.get(plugin_id.as_str()) {
                                        Ok(t) => t,
                                        Err(_) => continue,
                                    };

                                    if let Ok(get_decs_fn) = plugin_table.get::<mlua::Function>("get_decorations") {
                                        let ids_lua = match lua.to_value(&element_ids) {
                                            Ok(v) => v,
                                            Err(_) => continue,
                                        };
                                        let project_id_c = project_id.clone();
                                        let tab_id_c = tab_id.clone();
                                        
                                        let res_lua: Option<mlua::Value> = tauri::async_runtime::block_on(async {
                                            get_decs_fn.call_async::<mlua::Value>((project_id_c, tab_id_c, ids_lua)).await.ok()
                                        });

                                        if let Some(res_val) = res_lua {
                                            if let Ok(decs_map) = lua.from_value::<HashMap<String, ElementDecorations>>(res_val) {
                                                for (el_id, mut dec) in decs_map {
                                                    if let Some(ref mut before) = dec.before {
                                                        for item in before {
                                                            item.plugin_id = plugin_id.clone();
                                                        }
                                                    }
                                                    if let Some(ref mut after) = dec.after {
                                                        for item in after {
                                                            item.plugin_id = plugin_id.clone();
                                                        }
                                                    }

                                                    let entry = merged.entry(el_id).or_insert_with(ElementDecorations::default);
                                                    if let Some(mut b) = dec.before {
                                                        if let Some(ref mut eb) = entry.before {
                                                            eb.append(&mut b);
                                                        } else {
                                                            entry.before = Some(b);
                                                        }
                                                    }
                                                    if let Some(mut a) = dec.after {
                                                        if let Some(ref mut ea) = entry.after {
                                                            ea.append(&mut a);
                                                        } else {
                                                            entry.after = Some(a);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Some(())
                            })();
                            let _ = tx.send(merged);
                        }
                    }
                }
            })
            .expect("Failed to spawn lua-worker thread");

        Self {
            sender: std::sync::Mutex::new(sender),
            active_plugins,
            load_times,
        }
    }

    pub fn send(&self, task: LuaTask) -> Result<(), std::sync::mpsc::SendError<LuaTask>> {
        let guard = self.sender.lock().unwrap();
        guard.send(task)
    }
}

pub fn load_specs(plugins_dir: &Path) -> Vec<PluginSpec> {
    let config_path = plugins_dir.join("lazy-config.luau");
    if !config_path.is_file() {
        return Vec::new();
    }
    parse_specs_file(&config_path).unwrap_or_default()
}

fn load_single_plugin(
    lua: &mlua::Lua,
    plugins_dir: &Path,
    plugin_id: &str,
    specs: &[PluginSpec],
) -> Result<(), crate::error::StableError> {
    let spec = spec_for_plugin_id(plugins_dir, plugin_id, specs).ok_or_else(|| {
        crate::error::StableError::new(
            crate::error::codes::NOT_FOUND,
            format!("plugin '{}' not found in lazy-config", plugin_id),
        )
    })?;
    let plugin_root = resolve_plugin_root(plugins_dir, spec);
    let init_path = plugin_root.join("init.luau");
    if !init_path.is_file() {
        return Err(crate::error::StableError::new(
            crate::error::codes::NOT_FOUND,
            format!("plugin '{}' init.luau not found at {}", plugin_id, init_path.display()),
        ));
    }
    lua.globals()
        .set("__current_plugin_id", plugin_id)
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;
    lua.globals()
        .set(
            "__current_plugin_root",
            plugin_root.to_string_lossy().to_string(),
        )
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;
    let _ = invalidate_plugin_modules(lua, plugin_id, &plugin_root);

    let content = std::fs::read_to_string(&init_path).map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("read init.luau: {}", e))
    })?;

    // Bytecode compilation and caching
    let cache_dir = plugins_dir.join(".cache");
    if !cache_dir.is_dir() {
        let _ = std::fs::create_dir_all(&cache_dir);
    }
    let cache_file = cache_dir.join(format!("{}.luauc", plugin_id));
    
    let use_cache = if cache_file.is_file() {
        if let (Ok(meta_src), Ok(meta_cache)) = (std::fs::metadata(&init_path), std::fs::metadata(&cache_file)) {
            if let (Ok(time_src), Ok(time_cache)) = (meta_src.modified(), meta_cache.modified()) {
                time_cache > time_src
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    let bytecode = if use_cache {
        std::fs::read(&cache_file).unwrap_or_default()
    } else {
        let compiler = mlua::Compiler::new().set_optimization_level(2);
        match compiler.compile(&content) {
            Ok(bc) => {
                let _ = std::fs::write(&cache_file, &bc);
                bc
            }
            Err(e) => {
                return Err(crate::error::StableError::new(
                    crate::error::codes::INTERNAL,
                    format!("bytecode compilation error: {}", e),
                ));
            }
        }
    };

    let plugin_val: mlua::Value = lua.load(&bytecode).eval().map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("lua init error: {}", e))
    })?;

    if let mlua::Value::Table(plugin_table) = plugin_val {
        let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins").map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("get loaded table: {}", e))
        })?;
        loaded_tbl.set(plugin_id, plugin_table).map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("set plugin in loaded table: {}", e))
        })?;
        Ok(())
    } else {
        Err(crate::error::StableError::new(
            crate::error::codes::INVALID_PATH,
            format!("plugin '{}' init.luau must return a table", plugin_id),
        ))
    }
}

fn ensure_plugin_loaded(
    lua: &mlua::Lua,
    plugins_dir: &Path,
    plugin_id: &str,
    active_plugins: &Arc<Mutex<HashSet<String>>>,
    load_times: &Arc<Mutex<HashMap<String, f64>>>,
    loading_stack: &mut HashSet<String>,
) -> Result<(), crate::error::StableError> {
    if active_plugins.lock().unwrap().contains(plugin_id) {
        return Ok(());
    }
    if loading_stack.contains(plugin_id) {
        return Err(crate::error::StableError::new(
            crate::error::codes::INTERNAL,
            format!("Circular plugin dependency involving '{}'", plugin_id),
        ));
    }
    loading_stack.insert(plugin_id.to_string());

    let _ = resolve_plugin_deps(plugins_dir, plugin_id);

    let specs = load_specs(plugins_dir);
    let spec = specs
        .iter()
        .find(|s| s.id == plugin_id)
        .ok_or_else(|| {
            crate::error::StableError::new(
                crate::error::codes::NOT_FOUND,
                format!("plugin '{}' not found in lazy-config", plugin_id),
            )
        })?;

    if let Some(deps) = &spec.dependencies {
        for dep in deps {
            install_plugin_from_dependency(plugins_dir, dep)?;
            ensure_plugin_loaded(
                lua,
                plugins_dir,
                dep.id(),
                active_plugins,
                load_times,
                loading_stack,
            )?;
        }
    }

    let meta = read_plugin_init_metadata_for_spec(plugins_dir, spec);
    if let Some(exts) = meta.externals.or(spec.externals.clone()) {
        for ext in &exts {
            ensure_external_loaded(lua, plugins_dir, ext)?;
        }
    }

    let start_time = Instant::now();
    load_single_plugin(lua, plugins_dir, plugin_id, &specs)?;
    let duration = start_time.elapsed().as_secs_f64() * 1000.0;
    load_times.lock().unwrap().insert(plugin_id.to_string(), duration);
    active_plugins.lock().unwrap().insert(plugin_id.to_string());
    loading_stack.remove(plugin_id);

    Ok(())
}

fn ensure_external_loaded(
    lua: &mlua::Lua,
    plugins_dir: &Path,
    dep: &ExternalDependency,
) -> Result<(), crate::error::StableError> {
    let entry = ensure_external_installed(plugins_dir, dep)?;
    let checkout = vendor_checkout_path(plugins_dir, &entry.id);
    let main_path = checkout.join(&entry.main);
    if !main_path.is_file() {
        return Err(crate::error::StableError::new(
            crate::error::codes::NOT_FOUND,
            format!("external main not found: {}", main_path.display()),
        ));
    }
    let module = load_file_module(lua, &main_path).map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    cache_external_module(lua, &entry.id, module).map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    Ok(())
}

fn register_declared_graph(lua: &mlua::Lua, plugins_dir: &Path, specs: &[PluginSpec]) -> Result<(), crate::error::StableError> {
    let deps_tbl = lua.create_table().map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    let ext_tbl = lua.create_table().map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    for spec in specs {
        let meta = read_plugin_init_metadata_for_spec(plugins_dir, spec);
        let dep_ids = dependency_ids(
            &meta
                .dependencies
                .or(spec.dependencies.clone())
                .unwrap_or_default(),
        );
        let dep_list = lua.create_table().map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
        for (i, id) in dep_ids.iter().enumerate() {
            dep_list.raw_set(i + 1, id.as_str()).map_err(|e| {
                crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
            })?;
        }
        deps_tbl.set(spec.id.as_str(), dep_list).map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;

        let ext_ids = external_ids(&meta.externals.or(spec.externals.clone()).unwrap_or_default());
        let ext_list = lua.create_table().map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
        for (i, id) in ext_ids.iter().enumerate() {
            ext_list.raw_set(i + 1, id.as_str()).map_err(|e| {
                crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
            })?;
        }
        ext_tbl.set(spec.id.as_str(), ext_list).map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    }
    lua.globals().set("__plugin_declared_deps", deps_tbl).map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    lua.globals().set("__plugin_declared_externals", ext_tbl).map_err(|e| {
        crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
    })?;
    Ok(())
}

fn setup_runtime_helpers(
    lua: &mlua::Lua,
    plugins_dir: PathBuf,
    active_plugins: Arc<Mutex<HashSet<String>>>,
    load_times: Arc<Mutex<HashMap<String, f64>>>,
) -> Result<(), crate::error::StableError> {
    lua.globals()
        .set("__plugins_dir", plugins_dir.to_string_lossy().to_string())
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;

    let plugins_dir_c = plugins_dir.clone();
    let active_c = active_plugins.clone();
    let times_c = load_times.clone();
    let ensure_plugin = lua
        .create_function(move |lua, plugin_id: String| {
            let mut stack = HashSet::new();
            ensure_plugin_loaded(
                lua,
                &plugins_dir_c,
                &plugin_id,
                &active_c,
                &times_c,
                &mut stack,
            )
            .map_err(|e| mlua::Error::RuntimeError(e.message))?;
            Ok(())
        })
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;
    lua.globals()
        .set("__ensure_plugin_loaded", ensure_plugin)
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;

    let plugins_dir_e = plugins_dir.clone();
    let ensure_external = lua
        .create_function(move |lua, external_id: String| -> mlua::Result<mlua::Value> {
            let specs = load_specs(&plugins_dir_e);
            let mut found: Option<ExternalDependency> = None;
            for spec in specs {
                let meta = read_plugin_init_metadata_for_spec(&plugins_dir_e, &spec);
                if let Some(exts) = meta.externals.or(spec.externals) {
                    for ext in exts {
                        if ext.id() == external_id {
                            found = Some(ext);
                            break;
                        }
                    }
                }
                if found.is_some() {
                    break;
                }
            }
            let dep = found.ok_or_else(|| {
                mlua::Error::RuntimeError(format!("unknown external '{}'", external_id))
            })?;
            ensure_external_loaded(lua, &plugins_dir_e, &dep)
                .map_err(|e| mlua::Error::RuntimeError(e.message))?;
            let package: mlua::Table = lua.globals().get("package")?;
            let loaded: mlua::Table = package.get("loaded")?;
            loaded
                .get(format!("@external/{}", external_id))
                .map_err(|e| mlua::Error::RuntimeError(format!("{}", e)))
        })
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;
    lua.globals()
        .set("__ensure_external_loaded", ensure_external)
        .map_err(|e| crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e)))?;
    Ok(())
}

pub fn write_specs_to_file(path: &Path, specs: &[PluginSpec]) -> Result<(), std::io::Error> {
    let mut content = String::new();
    content.push_str("--!strict\n-- Auto-generated by lazy.vault\nreturn {\n");
    for spec in specs {
        content.push_str("  {\n");
        content.push_str(&format!("    id = \"{}\",\n", spec.id));
        if let Some(ref repo) = spec.repo {
            content.push_str(&format!("    repo = \"{}\",\n", repo));
        }
        content.push_str(&format!("    lazy = {},\n", spec.lazy));
        if let Some(ref dir) = spec.dir {
            content.push_str(&format!("    dir = \"{}\",\n", dir));
        }
        if let Some(ref deps) = spec.dependencies {
            if !deps.is_empty() {
                content.push_str("    dependencies = {\n");
                for dep in deps {
                    match dep {
                        PluginDependency::Id(id) => {
                            content.push_str(&format!("      \"{}\",\n", id));
                        }
                        PluginDependency::Spec(spec_dep) => {
                            content.push_str("      {\n");
                            content.push_str(&format!("        id = \"{}\",\n", spec_dep.id));
                            if let Some(ref repo) = spec_dep.repo {
                                content.push_str(&format!("        repo = \"{}\",\n", repo));
                            }
                            if let Some(ref dir) = spec_dep.dir {
                                content.push_str(&format!("        dir = \"{}\",\n", dir));
                            }
                            if let Some(ref branch) = spec_dep.branch {
                                content.push_str(&format!("        branch = \"{}\",\n", branch));
                            }
                            if let Some(ref tag) = spec_dep.tag {
                                content.push_str(&format!("        tag = \"{}\",\n", tag));
                            }
                            if let Some(ref commit) = spec_dep.commit {
                                content.push_str(&format!("        commit = \"{}\",\n", commit));
                            }
                            content.push_str("      },\n");
                        }
                    }
                }
                content.push_str("    },\n");
            }
        }
        if let Some(ref cmd) = spec.cmd {
            if !cmd.is_empty() {
                content.push_str("    cmd = {\n");
                for c in cmd {
                    content.push_str(&format!("      \"{}\",\n", c));
                }
                content.push_str("    },\n");
            }
        }
        if let Some(ref keys) = spec.keys {
            if !keys.is_empty() {
                content.push_str("    keys = {\n");
                for k in keys {
                    content.push_str(&format!("      \"{}\",\n", k));
                }
                content.push_str("    },\n");
            }
        }
        if let Some(ref evs) = spec.event {
            if !evs.is_empty() {
                content.push_str("    event = {\n");
                for e in evs {
                    content.push_str(&format!("      \"{}\",\n", e));
                }
                content.push_str("    },\n");
            }
        }
        content.push_str(&format!("    enabled = {},\n", spec.enabled));
        content.push_str("  },\n");
    }
    content.push_str("}\n");
    std::fs::write(path, content)
}

pub fn topological_sort_specs(plugins: &mut Vec<PluginSpec>) -> Result<(), String> {
    let mut order = Vec::new();
    let mut visited = HashSet::new();
    let mut temp = HashSet::new();
    
    let specs_map: HashMap<String, &PluginSpec> = plugins.iter().map(|p| (p.id.clone(), p)).collect();
    
    fn visit(
        id: &str,
        specs_map: &HashMap<String, &PluginSpec>,
        visited: &mut HashSet<String>,
        temp: &mut HashSet<String>,
        order: &mut Vec<String>,
    ) -> Result<(), String> {
        if temp.contains(id) {
            return Err(format!("Circular dependency detected involving plugin '{}'", id));
        }
        if !visited.contains(id) {
            temp.insert(id.to_string());
            if let Some(spec) = specs_map.get(id) {
                if let Some(deps) = &spec.dependencies {
                    for dep in deps {
                        visit(dep.id(), specs_map, visited, temp, order)?;
                    }
                }
            }
            temp.remove(id);
            visited.insert(id.to_string());
            order.push(id.to_string());
        }
        Ok(())
    }
    
    for p in plugins.iter() {
        visit(&p.id, &specs_map, &mut visited, &mut temp, &mut order)?;
    }
    
    let mut position_map = HashMap::new();
    for (i, id) in order.iter().enumerate() {
        position_map.insert(id.clone(), i);
    }
    plugins.sort_by_key(|p| position_map.get(&p.id).copied().unwrap_or(usize::MAX));
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn pv_plugins_fixture_root() -> Option<PathBuf> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pv-plugins");
        if root.join("plugins.registry.luau").is_file() {
            Some(root)
        } else {
            None
        }
    }

    fn make_spec(id: &str, deps: Option<Vec<&str>>) -> PluginSpec {
        PluginSpec {
            id: id.to_string(),
            name: None,
            description: None,
            repo: None,
            lazy: false,
            dir: None,
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

    #[test]
    fn test_topological_sort_success() {
        let mut specs = vec![
            make_spec("c", Some(vec!["b"])),
            make_spec("b", Some(vec!["a"])),
            make_spec("a", None),
        ];

        let res = topological_sort_specs(&mut specs);
        assert!(res.is_ok());

        let ids: Vec<String> = specs.into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_topological_sort_circular_dependency() {
        let mut specs = vec![
            make_spec("a", Some(vec!["b"])),
            make_spec("b", Some(vec!["a"])),
        ];

        let res = topological_sort_specs(&mut specs);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Circular dependency"));
    }

    #[test]
    fn test_load_registry_entries_parses_pv_plugins_template() {
        let Some(repo_root) = pv_plugins_fixture_root() else {
            eprintln!("skipping: pv-plugins submodule not initialized");
            return;
        };
        let entries = load_registry_entries(&repo_root);
        assert!(!entries.is_empty());
        let harpoon = entries.iter().find(|e| e.id == "harpoon").expect("harpoon entry");
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
        assert_eq!(spec.repo.as_deref(), Some("https://github.com/ur-wesley/pv-plugins"));
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

