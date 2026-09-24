pub mod clipboard_history;
mod commands;
pub mod common;
pub mod db;
pub mod discovery;
mod disk_volume;
pub mod dokploy;
pub mod error;
mod file_watcher;
pub mod files;
mod fs_scope_util;
pub mod git_watcher;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ide;
pub mod issues;
pub mod kanban;
pub mod linguist;
pub mod location_watcher;
pub mod lua;
pub mod mcp;
pub mod mise_tools;
pub mod models;
mod notifications;
pub mod plugins;
pub mod postgres;
mod process_util;
pub mod project_move;
mod screenshot_overlay;
pub mod setup;
pub mod search;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shells;
mod spawn;
pub mod task_config;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tools;
pub mod tunnel;
pub mod workspaces;

use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Builder as SqlPluginBuilder, Migration, MigrationKind};

fn sql_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial",
            sql: db::normalize_sql(include_str!("../migrations/001_initial.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "github_info",
            sql: db::normalize_sql(include_str!("../migrations/002_github_info.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "file_count",
            sql: db::normalize_sql(include_str!("../migrations/003_file_count.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "last_edited",
            sql: db::normalize_sql(include_str!("../migrations/004_last_edited.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "task_runtime",
            sql: db::normalize_sql(include_str!("../migrations/005_task_runtime.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "size_bytes",
            sql: db::normalize_sql(include_str!("../migrations/006_size_bytes.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "issues",
            sql: db::normalize_sql(include_str!("../migrations/007_issues.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "clipboard_history",
            sql: db::normalize_sql(include_str!("../migrations/008_clipboard_history.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "clipboard_history_unique_hash",
            sql: db::normalize_sql(include_str!(
                "../migrations/009_clipboard_history_unique_hash.sql"
            )),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "icon_path",
            sql: db::normalize_sql(include_str!("../migrations/010_icon_path.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "last_viewed",
            sql: db::normalize_sql(include_str!("../migrations/011_last_viewed.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "canvas",
            sql: db::normalize_sql(include_str!("../migrations/012_canvas.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "canvas_v2",
            sql: db::normalize_sql(include_str!("../migrations/013_canvas_v2.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "workspaces",
            sql: db::normalize_sql(include_str!("../migrations/014_workspaces.sql")),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = sql_migrations();
    let eol_pairs: Vec<(i64, &str)> = migrations.iter().map(|m| (m.version, m.sql)).collect();
    db::repair_applied_migration_eols(&eol_pairs);

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            SqlPluginBuilder::default()
                .add_migrations(db::DB_URL, migrations)
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
        .manage(crate::mcp::McpServerState::default())
        .setup(|app| {
            #[cfg(windows)]
            if let Err(e) = crate::notifications::register_windows_notifications(app.handle()) {
                eprintln!("[notifications] Windows registration failed: {e}");
            }

            let p_dir = crate::plugins::paths::plugins_dir(app.handle());
            crate::setup::plugins::bootstrap_plugin_dir(app.handle());
            crate::setup::plugins::spawn_plugin_watcher(app.handle().clone(), p_dir);

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
            tauri::async_runtime::block_on(async {
                crate::setup::orphans::recover_orphans(&handle).await;
            });

            crate::setup::watchers::start_watchers(app, &handle)?;
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
            commands::git::get_git_statuses,
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
            commands::git::git_changed_files,
            commands::git::git_file_diff,
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
            dokploy::commands::dokploy_api_version,
            dokploy::commands::dokploy_test_connection,
            dokploy::commands::dokploy_list_matches,
            dokploy::commands::dokploy_debug_scan,
            dokploy::commands::dokploy_git_providers,
            dokploy::commands::dokploy_list_services,
            dokploy::commands::dokploy_link_github,
            dokploy::commands::dokploy_service_status,
            dokploy::commands::dokploy_redeploy,
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
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::file_stat,
            commands::files::create_project_file,
            commands::files::create_project_folder,
            commands::files::rename_project_path,
            commands::files::delete_project_path,
            file_watcher::watch_project_files,
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
            commands::kanban::kanban_list_boards,
            commands::kanban::kanban_get_board,
            commands::kanban::kanban_create_board,
            commands::kanban::kanban_create_card,
            commands::kanban::kanban_update_card,
            commands::kanban::kanban_move_card,
            commands::kanban::kanban_list_cards,
            commands::kanban::kanban_delete_card,
            commands::kanban::kanban_delete_board,
            commands::kanban::kanban_list_tags,
            commands::kanban::kanban_set_tag_color,
            commands::workspaces::workspace_list,
            commands::workspaces::workspace_get,
            commands::workspaces::workspace_create,
            commands::workspaces::workspace_delete,
            commands::workspaces::workspace_archive,
            commands::workspaces::workspace_link_card,
            commands::workspaces::workspace_changes,
            commands::workspaces::workspace_file_diff,
            commands::workspaces::session_create,
            commands::workspaces::session_list,
            commands::workspaces::session_prompt,
            commands::workspaces::session_stop,
            commands::workspaces::session_get,
            commands::workspaces::executors_list,
            commands::workspaces::workspace_push,
            commands::workspaces::workspace_git_info,
            commands::workspaces::pr_create,
            commands::workspaces::pr_status,
            commands::workspaces::pr_merge,
            commands::sizes::get_location_project_sizes,
            commands::sizes::get_largest_entries,
            commands::sizes::get_dir_size_breakdown,
            commands::sizes::get_dir_size_tree,
            tunnel::commands::check_tunnel_available,
            tunnel::commands::trust_portless_ca,
            tunnel::commands::start_tunnel_proxy,
            tunnel::commands::stop_tunnel_proxy,
            tunnel::commands::enable_tunnel,
            tunnel::commands::disable_tunnel,
            tunnel::commands::get_tunnel_status,
            lua::ui::resolve_plugin_ui,
            lua::ui::set_active_project,
            plugins::repo::list_plugin_commands,
            plugins::repo::execute_plugin_command,
            plugins::repo::get_plugin_logs,
            plugins::repo::emit_test_plugin_logs,
            plugins::repo::list_plugins,
            plugins::repo::toggle_plugin,
            plugins::repo::get_tab_decorations,
            plugins::repo::get_official_plugins_repo,
            plugins::repo::open_plugins_dir,
            plugins::repo::refresh_plugins_from_repos,
            plugins::monorepo::install_plugin_git,
            plugins::link::install_plugin_local,
            plugins::link::reimport_plugin_local,
            plugins::link::discover_local_folder,
            plugins::monorepo::discover_monorepo,
            plugins::monorepo::get_pending_discoveries,
            plugins::monorepo::uninstall_plugin,
            plugins::lockfile::sync_lockfile,
            plugins::lockfile::restore_from_lockfile,
            plugins::updates::check_plugin_updates,
            plugins::updates::update_plugin_git,
            plugins::updates::update_all_plugins,
            plugins::repo::get_plugin_load_stats,
            plugins::repo::resolve_plugin_dependencies,
            plugins::lockfile::sync_vendor_lockfile_cmd,
            plugins::lockfile::restore_vendor_lockfile_cmd,
            commands::canvas::get_canvas_layout,
            commands::canvas::save_canvas_layout,
            commands::canvas::web_preview_ping,
            commands::canvas::list_canvas_blueprints,
            commands::canvas::save_canvas_blueprint,
            commands::canvas::delete_canvas_blueprint,
            crate::mcp::commands::get_mcp_server_status,
            crate::mcp::commands::start_mcp_server,
            crate::mcp::commands::stop_mcp_server,
            crate::mcp::commands::generate_mcp_token,
            crate::mcp::commands::save_mcp_settings,
            crate::mcp::commands::list_mcp_tools,
            crate::mcp::commands::list_mcp_resources,
        ])
        .manage(lua::ui::UiBridge::default())
        .manage(lua::ui::PluginStoreState::new())
        .manage(crate::lua::LuaRuntimeState::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
