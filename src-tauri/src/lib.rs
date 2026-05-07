mod commands;
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
pub mod models;
pub mod project_move;
pub mod search;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shells;
mod spawn;
pub mod task_config;
pub mod tunnel;
pub mod mise_tools;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tools;



use tauri::Manager;
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
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_fs::init())
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
        .manage(crate::spawn::EmbeddedTerminals::default())
        .manage(crate::spawn::TerminalBuffers::default())
        .manage(crate::spawn::ProjectIdeSessions::default())
        .manage(crate::spawn::TaskMonitors::default())
        .manage(crate::tunnel::TunnelState::default())
        .setup(|app| {
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

            crate::search::background::start_background_scanner(handle, 15);
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
            commands::projects::set_project_favorite,
            commands::projects::set_project_tag,
            commands::projects::remove_project_tag,
            commands::projects::touch_project_opened,

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
            tunnel::commands::check_tunnel_available,
            tunnel::commands::trust_portless_ca,
            tunnel::commands::start_tunnel_proxy,
            tunnel::commands::stop_tunnel_proxy,
            tunnel::commands::enable_tunnel,
            tunnel::commands::disable_tunnel,
            tunnel::commands::get_tunnel_status,
            lua::ui::resolve_plugin_ui,
        ])
        .manage(lua::ui::UiBridge::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
