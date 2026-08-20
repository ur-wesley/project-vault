mod commands;
mod notifications;
mod process_util;
pub mod db;
pub mod discovery;
mod disk_volume;
pub mod error;
mod fs_scope_util;
pub mod issues;
pub mod lua;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ide;
pub mod location_watcher;
pub mod git_watcher;
pub mod clipboard_history;
pub mod models;
pub mod project_move;
pub mod search;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shells;
mod spawn;
pub mod task_config;
pub mod tunnel;
pub mod mise_tools;
mod screenshot_overlay;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tools;



use tauri::{Manager, Emitter};
use tauri_plugin_sql::{Builder as SqlPluginBuilder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            SqlPluginBuilder::default()
                .add_migrations(
                    db::DB_URL,
                    vec![
                        Migration {
                            version: 1,
                            description: "initial",
                            sql: include_str!("../migrations/001_initial.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "github_info",
                            sql: include_str!("../migrations/002_github_info.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "file_count",
                            sql: include_str!("../migrations/003_file_count.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "last_edited",
                            sql: include_str!("../migrations/004_last_edited.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "task_runtime",
                            sql: include_str!("../migrations/005_task_runtime.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 6,
                            description: "size_bytes",
                            sql: include_str!("../migrations/006_size_bytes.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 7,
                            description: "issues",
                            sql: include_str!("../migrations/007_issues.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 8,
                            description: "clipboard_history",
                            sql: include_str!("../migrations/008_clipboard_history.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 9,
                            description: "clipboard_history_unique_hash",
                            sql: include_str!("../migrations/009_clipboard_history_unique_hash.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 10,
                            description: "icon_path",
                            sql: include_str!("../migrations/010_icon_path.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 11,
                            description: "last_viewed",
                            sql: include_str!("../migrations/011_last_viewed.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
            for arg in args {
                if arg.starts_with("vault://") || arg.starts_with("project-vault://") {
                    let _ = app.emit("deep-link:install-plugin", arg);
                }
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(crate::spawn::EmbeddedTerminals::default())
        .manage(crate::spawn::TerminalBuffers::default())
        .manage(crate::spawn::ProjectIdeSessions::default())
        .manage(crate::spawn::TaskMonitors::default())
        .manage(crate::tunnel::TunnelState::default())
        .manage(std::sync::Arc::new(crate::clipboard_history::ClipboardWatcherState::new()))
        .setup(|app| {
            #[cfg(windows)]
            if let Err(e) = crate::notifications::register_windows_notifications(app.handle()) {
                eprintln!("[notifications] Windows registration failed: {e}");
            }

            let p_dir = crate::commands::plugins::plugins_dir(app.handle());
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
            let _ = std::fs::write(vault_luau_path, include_str!("../lua-sdk/vault.luau"));

            // Spawn plugins file watcher for hot-reloading
            let handle_for_watcher = app.handle().clone();
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

                // Keep the watcher alive in this thread/task
                let _watcher_holder = watcher;

                // Debounce map/state to avoid double reloading
                let mut last_reload = std::time::Instant::now();
                while let Some(event) = rx.recv().await {
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

            use tauri_plugin_cli::CliExt;
            if let Ok(matches) = app.cli().matches() {
                let db_instances = app.state::<tauri_plugin_sql::DbInstances>();
                tauri::async_runtime::block_on(async {
                    if let Ok(pool) = db::sqlite_pool(&*db_instances).await {
                        let _ = crate::issues::cli::handle_cli_matches(matches, pool).await;
                    }
                });
            }

            let handle = app.handle().clone();
            let db = app.state::<tauri_plugin_sql::DbInstances>();
            let monitors = app.state::<crate::spawn::TaskMonitors>().clone();
            tauri::async_runtime::block_on(async {
                if let Ok(pool) = db::sqlite_pool(&*db).await {
                    let orphans = db::list_active_sessions_for_project_all(&pool).await.ok().unwrap_or_default();
                    let mut sys = sysinfo::System::new_all();
                    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                    for s in orphans {
                        let alive = s.root_pid.map(|pid| sys.process(sysinfo::Pid::from(pid as usize)).is_some()).unwrap_or(false);
                        if alive {
                            let _ = crate::spawn::task_monitor::reregister_task(
                                &handle,
                                &monitors,
                                s.id.clone(),
                                s.project_id.clone(),
                                s.command.clone(),
                                s.root_pid,
                                s.started_at_ms,
                            );
                        } else {
                            let now = db::now_ms();
                            let _ = sqlx::query("UPDATE sessions SET ended_at_ms = ?1, state = 'error', stop_reason = COALESCE(stop_reason, 'Process not found on startup'), last_event_at_ms = ?1 WHERE id = ?2")
                                .bind(now)
                                .bind(&s.id)
                                .execute(&pool)
                                .await;
                        }
                    }

                    // Start background playtime tracker
                    let pool_for_tracker = pool.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(10));
                        loop {
                            ticker.tick().await;
                            let _ = db::increment_active_projects_playtime(&pool_for_tracker, 10000).await;
                        }
                    });

                    if let Ok(locs) = db::list_locations(&pool).await {
                        for loc in locs {
                            let _ = fs_scope_util::allow_library_root(&handle, &loc.path);
                        }
                    }
                }
            });

            let watcher = crate::location_watcher::LocationWatcher::new(handle.clone());
            let watcher_spawn = watcher.clone();
            tauri::async_runtime::spawn(async move {
                watcher_spawn.watch_all_enabled().await;
            });
            app.manage(watcher);

            let git_watcher = crate::git_watcher::GitWatcher::new(handle.clone());
            app.manage(git_watcher);

            crate::search::background::start_background_scanner(handle.clone(), 15);
            crate::clipboard_history::start_watcher(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::locations::list_locations,
            commands::locations::add_location,
            commands::locations::remove_location,
            commands::locations::update_location,
            commands::locations::reorder_locations,
            commands::volumes::disk_space_for_paths,
            commands::git::get_git_status,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_fetch,
            commands::git::git_incoming,
            commands::git::git_init,
            commands::git::git_tag_and_push,
            commands::git::git_preview_versions,
            commands::git::git_discover_version_files,
            commands::git::git_bump_version_and_tag,
            commands::git::git_clean_preview,
            commands::git::git_clean_execute,
            commands::git::start_git_watcher,
            commands::git::stop_git_watcher,
            commands::projects::import_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::move_project,
            commands::projects::delete_project,
            commands::project_cleaner::project_cleaner_scan,
            commands::project_cleaner::project_cleaner_execute,
            commands::projects::set_project_favorite,
            commands::projects::set_project_tag,
            commands::projects::remove_project_tag,
            commands::projects::touch_project_opened,
            commands::projects::touch_project_viewed,

            commands::projects::refresh_project,
            commands::projects::move_project,
            commands::projects::get_project_languages,
            commands::projects::get_project_mise_tools,
            commands::projects::suggest_mise_tools,
            commands::projects::pin_mise_tools,
            commands::sessions::start_session,
            commands::sessions::end_session,
            commands::sessions::list_sessions_for_project,
            commands::sessions::list_active_sessions,
            commands::sessions::list_all_active_sessions,
            commands::sessions::recover_orphan_sessions,
            commands::sessions::clear_sessions_for_project,
            commands::sessions::get_session_count_for_project,
            commands::sessions::list_all_processes,
            commands::sessions::stop_all_project_processes,
            commands::scan::scan_library_location,
            commands::scan::debug_detect_project,
            commands::scan::debug_scan_location,
            commands::locations::pick_library_folder,
            commands::locations::pick_project_parent_folder,
            commands::project_wizard::list_project_templates,
            commands::project_wizard::save_project_templates,
            commands::project_wizard::create_project_from_template,
            commands::project_wizard::run_template_command,
            commands::github_device::is_github_device_configured,
            commands::github_device::start_github_device_flow,
            commands::github_device::wait_github_device_flow,
            commands::github_remote::get_github_repo_for_project,
            commands::github_remote::get_git_remote_url,
            commands::notifications::show_system_notification,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::list_settings,
            commands::settings::get_app_data_dir,
            commands::settings::export_library_snapshot,
            commands::task_runner::spawn_project_task,
            commands::task_runner::open_project_shell,
            commands::task_runner::stop_project_task,
            commands::task_runner::open_shell_at_path,
            commands::task_config::read_project_task_config,
            commands::task_config::write_project_task,
            commands::task_config::delete_project_task,
            commands::ide::list_discovered_ides,
            commands::ide::list_running_projects,
            commands::ide::open_project_in_ide,
            commands::ide::stop_project_ide,
            commands::ide::is_project_ide_running,
            commands::embedded_terminal::embedded_terminal_spawn,
            commands::embedded_terminal::global_terminal_spawn,
            commands::embedded_terminal::list_available_shells,
            commands::tools::list_discovered_tools,
            commands::embedded_terminal::embedded_terminal_write,
            commands::embedded_terminal::embedded_terminal_resize,
            commands::embedded_terminal::embedded_terminal_kill,
            commands::embedded_terminal::embedded_terminal_is_alive,
            commands::embedded_terminal::embedded_terminal_get_buffer,
            commands::embedded_terminal::embedded_terminal_clear_buffer,
            commands::search::search_project,
            commands::search::index_project,
            commands::search::rebuild_index,
            commands::search::get_index_meta,
            commands::search::delete_index,
            commands::search::delete_all_indices,
            commands::search::update_index_for_file,
            commands::screenshot::list_screens,
            commands::screenshot::list_windows,
            commands::screenshot::get_desktop_bounds,
            commands::screenshot::capture_screen,
            commands::screenshot::capture_all_screens,
            commands::screenshot::capture_window,
            commands::screenshot::capture_region,
            commands::screenshot::save_screenshot,
            commands::screenshot::pick_screenshot_directory,
            commands::screenshot::select_region,
            commands::clipboard_history::list_clipboard_history,
            commands::clipboard_history::delete_clipboard_entry,
            commands::clipboard_history::clear_clipboard_history,
            commands::clipboard_history::update_clipboard_entry,
            commands::clipboard_history::toggle_clipboard_pin,
            commands::clipboard_history::apply_clipboard_entry,
            commands::clipboard_history::get_clipboard_history_settings,
            commands::clipboard_history::set_clipboard_history_settings,
            commands::clipboard_history::save_clipboard_foreground_window,
            commands::clipboard_history::capture_clipboard_overlay_anchor,
            commands::clipboard_history::get_clipboard_overlay_position,
            commands::clipboard_history::get_clipboard_entry_thumbnail,
            commands::clipboard_history::close_clipboard_overlay,
            commands::clipboard_history::prepare_clipboard_overlay_window,
            commands::updater::check_for_updates,
            commands::updater::install_update,
            commands::issues::list_issues,
            commands::issues::get_issue,
            commands::issues::create_issue,
            commands::issues::update_issue,
            commands::issues::delete_issue,
            commands::issues::delete_all_local_issues,
            commands::sizes::get_location_project_sizes,
            commands::sizes::get_largest_entries,
            commands::sizes::get_dir_size_breakdown,
            tunnel::commands::check_tunnel_available,
            tunnel::commands::trust_portless_ca,
            tunnel::commands::start_tunnel_proxy,
            tunnel::commands::stop_tunnel_proxy,
            tunnel::commands::enable_tunnel,
            tunnel::commands::disable_tunnel,
            tunnel::commands::get_tunnel_status,
            lua::ui::resolve_plugin_ui,
            lua::ui::set_active_project,
            commands::plugins::list_plugin_commands,
            commands::plugins::execute_plugin_command,
            commands::plugins::list_plugins,
            commands::plugins::toggle_plugin,
            commands::plugins::get_tab_decorations,
            commands::plugins::get_official_plugins_repo,
            commands::plugins::open_plugins_dir,
            commands::plugins::refresh_plugins_from_repos,
            commands::plugins::install_plugin_git,
            commands::plugins::discover_monorepo,
            commands::plugins::get_pending_discoveries,
            commands::plugins::uninstall_plugin,
            commands::plugins::sync_lockfile,
            commands::plugins::restore_from_lockfile,
            commands::plugins::check_plugin_updates,
            commands::plugins::update_plugin_git,
            commands::plugins::update_all_plugins,
            commands::plugins::get_plugin_load_stats,
            commands::plugins::resolve_plugin_dependencies,
            commands::plugins::sync_vendor_lockfile_cmd,
            commands::plugins::restore_vendor_lockfile_cmd,
        ])
        .manage(lua::ui::UiBridge::default())
        .manage(crate::lua::LuaRuntimeState::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
