//! Plugin directory bootstrap + hot-reload watcher.
//! (Extracted verbatim from the `run()` setup closure in `lib.rs`.)

use tauri::{AppHandle, Emitter};

/// Ensure `plugins/`, a default `lazy-config.luau`, and a fresh IDE
/// `vault.luau` snapshot exist; drop legacy declaration files.
pub fn bootstrap_plugin_dir(handle: &AppHandle) {
    let p_dir = crate::plugins::paths::plugins_dir(handle);
    if !p_dir.is_dir() {
        let _ = std::fs::create_dir_all(&p_dir);
    }

    let lazy_config_path = p_dir.join("lazy-config.luau");
    if !lazy_config_path.is_file() {
        let _ = std::fs::write(
            &lazy_config_path,
            "--!strict\n-- User plugin configuration (merged on install from plugins.registry.luau)\nreturn {}\n",
        );
    }

    let old_d_lua_path = p_dir.join("vault.d.lua");
    if old_d_lua_path.is_file() {
        let _ = std::fs::remove_file(old_d_lua_path);
    }
    let old_d_luau_path = p_dir.join("vault.d.luau");
    if old_d_luau_path.is_file() {
        let _ = std::fs::remove_file(old_d_luau_path);
    }
    let vault_luau_path = p_dir.join("vault.luau");
    let _ = std::fs::write(vault_luau_path, include_str!("../../lua-sdk/vault.luau"));
}

/// Spawn the plugins file watcher for hot-reloading.
pub fn spawn_plugin_watcher(handle: AppHandle, p_dir: std::path::PathBuf) {
    // Spawn plugins file watcher for hot-reloading
    let handle_for_watcher = handle.clone();
    let p_dir_for_watcher = p_dir.clone();
    tauri::async_runtime::spawn(async move {
        use notify::{Watcher, RecursiveMode, EventKind};
        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let mut watcher = match notify::recommended_watcher(move |res| {
            if let Ok(event) = res {
                let _ = tx.blocking_send(event);
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[watcher] Failed to create plugin watcher: {:?}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&p_dir_for_watcher, RecursiveMode::Recursive) {
            eprintln!("[watcher] Failed to watch plugin dir: {:?}", e);
            return;
        }

        #[cfg(debug_assertions)]
        if let Some(ws_root) = crate::lua::loader::pv_plugins_workspace_root() {
            if let Err(e) = watcher.watch(&ws_root, RecursiveMode::Recursive) {
                eprintln!("[watcher] Failed to watch pv-plugins workspace: {:?}", e);
            }
        }

        // Linked local plugin folders (spec `local_path`) live outside
        // `plugins/` — watch them too so edits hot-reload. Re-synced
        // on a timer since links can be added at runtime.
        let mut watched_local: std::collections::HashSet<std::path::PathBuf> =
            std::collections::HashSet::new();
        let sync_local_watches = |watcher: &mut notify::RecommendedWatcher,
                                  watched: &mut std::collections::HashSet<
            std::path::PathBuf,
        >| {
            let specs = crate::lua::loader::load_specs(&p_dir_for_watcher);
            for spec in &specs {
                let Some(ref linked) = spec.local_path else {
                    continue;
                };
                if linked.is_empty() {
                    continue;
                }
                let p = std::path::PathBuf::from(linked);
                let abs = if p.is_absolute() {
                    p
                } else {
                    p_dir_for_watcher.join(p)
                };
                if !abs.is_dir() || !watched.insert(abs.clone()) {
                    continue;
                }
                if let Err(e) = watcher.watch(&abs, RecursiveMode::Recursive) {
                    eprintln!(
                        "[watcher] Failed to watch linked plugin dir {}: {:?}",
                        abs.display(),
                        e
                    );
                }
            }
        };
        sync_local_watches(&mut watcher, &mut watched_local);

        // Debounce map/state to avoid double reloading
        let mut last_reload = std::time::Instant::now();
        loop {
            let event =
                match tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv()).await
                {
                    Ok(ev) => ev,
                    Err(_) => {
                        sync_local_watches(&mut watcher, &mut watched_local);
                        continue;
                    }
                };
            let Some(event) = event else { break };
            let is_luau = event.paths.iter().any(|p| {
                p.extension().and_then(|ext| ext.to_str()) == Some("luau")
            });
            if is_luau {
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                        if last_reload.elapsed() > std::time::Duration::from_millis(500) {
                            println!("[watcher] Plugin changes detected. Requesting frontend reload.");
                            let _ = handle_for_watcher.emit("plugin:reload", ());
                            last_reload = std::time::Instant::now();
                        }
                    }
                    _ => {}
                }
            }
        }
    });
}
