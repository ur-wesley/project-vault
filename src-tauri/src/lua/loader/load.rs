use crate::lua::deps::{dependency_ids, external_ids, ExternalDependency, PluginDependency};
use crate::lua::plugin_install::{install_plugin_from_dependency, resolve_plugin_deps};
use crate::lua::require::{
    cache_external_module, invalidate_plugin_modules, load_file_module,
};
use crate::lua::vendor::{ensure_external_installed, vendor_checkout_path};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::runtime::emit_plugin_loaded;
use super::spec::*;

pub fn load_specs(plugins_dir: &Path) -> Vec<PluginSpec> {
    let config_path = plugins_dir.join("lazy-config.luau");
    if !config_path.is_file() {
        return Vec::new();
    }
    parse_specs_file(&config_path).unwrap_or_default()
}

pub(crate) fn load_single_plugin(
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
            format!(
                "plugin '{}' init.luau not found at {}",
                plugin_id,
                init_path.display()
            ),
        ));
    }
    lua.globals()
        .set("__current_plugin_id", plugin_id)
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    lua.globals()
        .set(
            "__current_plugin_root",
            plugin_root.to_string_lossy().to_string(),
        )
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    let _ = invalidate_plugin_modules(lua, plugin_id, &plugin_root);

    let content = std::fs::read_to_string(&init_path).map_err(|e| {
        crate::error::StableError::new(
            crate::error::codes::INTERNAL,
            format!("read init.luau: {}", e),
        )
    })?;

    // Bytecode compilation and caching
    let cache_dir = plugins_dir.join(".cache");
    if !cache_dir.is_dir() {
        let _ = std::fs::create_dir_all(&cache_dir);
    }
    let cache_file = cache_dir.join(format!("{}.luauc", plugin_id));

    let use_cache = if cache_file.is_file() {
        if let (Ok(meta_src), Ok(meta_cache)) = (
            std::fs::metadata(&init_path),
            std::fs::metadata(&cache_file),
        ) {
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
        crate::error::StableError::new(
            crate::error::codes::INTERNAL,
            format!("lua init error: {}", e),
        )
    })?;

    if let mlua::Value::Table(plugin_table) = plugin_val {
        let loaded_tbl: mlua::Table = lua.globals().get("__loaded_plugins").map_err(|e| {
            crate::error::StableError::new(
                crate::error::codes::INTERNAL,
                format!("get loaded table: {}", e),
            )
        })?;
        loaded_tbl.set(plugin_id, plugin_table).map_err(|e| {
            crate::error::StableError::new(
                crate::error::codes::INTERNAL,
                format!("set plugin in loaded table: {}", e),
            )
        })?;
        Ok(())
    } else {
        Err(crate::error::StableError::new(
            crate::error::codes::INVALID_PATH,
            format!("plugin '{}' init.luau must return a table", plugin_id),
        ))
    }
}

pub(crate) fn ensure_plugin_loaded(
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
    let spec = specs.iter().find(|s| s.id == plugin_id).ok_or_else(|| {
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
    load_times
        .lock()
        .unwrap()
        .insert(plugin_id.to_string(), duration);
    active_plugins.lock().unwrap().insert(plugin_id.to_string());
    loading_stack.remove(plugin_id);

    Ok(())
}

pub(crate) fn ensure_external_loaded(
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

pub(crate) fn register_declared_graph(
    lua: &mlua::Lua,
    plugins_dir: &Path,
    specs: &[PluginSpec],
) -> Result<(), crate::error::StableError> {
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

        let ext_ids = external_ids(
            &meta
                .externals
                .or(spec.externals.clone())
                .unwrap_or_default(),
        );
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
    lua.globals()
        .set("__plugin_declared_deps", deps_tbl)
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    lua.globals()
        .set("__plugin_declared_externals", ext_tbl)
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    Ok(())
}

pub(crate) fn setup_runtime_helpers(
    lua: &mlua::Lua,
    plugins_dir: PathBuf,
    active_plugins: Arc<Mutex<HashSet<String>>>,
    load_times: Arc<Mutex<HashMap<String, f64>>>,
    app: &tauri::AppHandle,
) -> Result<(), crate::error::StableError> {
    lua.globals()
        .set("__plugins_dir", plugins_dir.to_string_lossy().to_string())
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;

    let plugins_dir_c = plugins_dir.clone();
    let active_c = active_plugins.clone();
    let times_c = load_times.clone();
    let app_c = app.clone();
    let ensure_plugin = lua
        .create_function(move |lua, plugin_id: String| {
            let was_loaded = active_c.lock().unwrap().contains(&plugin_id);
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
            // Lazy `require` path has no other reporting point: without this
            // a require-triggered load stays invisible in the console.
            if !was_loaded {
                emit_plugin_loaded(&app_c, &plugin_id, &times_c);
            }
            Ok(())
        })
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    lua.globals()
        .set("__ensure_plugin_loaded", ensure_plugin)
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;

    let plugins_dir_e = plugins_dir.clone();
    let ensure_external = lua
        .create_function(
            move |lua, external_id: String| -> mlua::Result<mlua::Value> {
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
            },
        )
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    lua.globals()
        .set("__ensure_external_loaded", ensure_external)
        .map_err(|e| {
            crate::error::StableError::new(crate::error::codes::INTERNAL, format!("{}", e))
        })?;
    Ok(())
}

/// Escape a string for embedding in a double-quoted Luau literal.
/// Required for Windows paths (`C:\...`) in generated lazy-config entries.
fn escape_lua_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
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
        if let Some(ref local_path) = spec.local_path {
            content.push_str(&format!(
                "    local_path = \"{}\",\n",
                escape_lua_string(local_path)
            ));
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

    let specs_map: HashMap<String, &PluginSpec> =
        plugins.iter().map(|p| (p.id.clone(), p)).collect();

    fn visit(
        id: &str,
        specs_map: &HashMap<String, &PluginSpec>,
        visited: &mut HashSet<String>,
        temp: &mut HashSet<String>,
        order: &mut Vec<String>,
    ) -> Result<(), String> {
        if temp.contains(id) {
            return Err(format!(
                "Circular dependency detected involving plugin '{}'",
                id
            ));
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
    use super::super::spec::make_spec;
    use super::*;

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
    fn test_escape_lua_string_for_windows_paths() {
        assert_eq!(
            escape_lua_string("C:\\dev\\my plugin\\x"),
            "C:\\\\dev\\\\my plugin\\\\x"
        );
    }
}
