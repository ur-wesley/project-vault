mod commands;
pub mod db;
pub mod discovery;
mod disk_volume;
pub mod error;
mod fs_scope_util;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ide;
pub mod models;
pub mod project_move;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shells;
mod spawn;

use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlPluginBuilder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
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
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(crate::spawn::EmbeddedTerminals::default())
        .manage(crate::spawn::ProjectIdeSessions::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let db = app.state::<tauri_plugin_sql::DbInstances>();
            tauri::async_runtime::block_on(async {
                if let Ok(pool) = db::sqlite_pool(&*db).await {
                    let _ = db::recover_orphan_sessions(&pool).await;
                    if let Ok(locs) = db::list_locations(&pool).await {
                        for loc in locs {
                            let _ = fs_scope_util::allow_library_root(&handle, &loc.path);
                        }
                    }
                }
            });
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
            commands::projects::import_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::delete_project,
            commands::projects::get_project_languages,
            commands::projects::set_project_favorite,
            commands::projects::touch_project_opened,
            commands::projects::move_project,
            commands::projects::get_project_mise_tools,
            commands::sessions::start_session,
            commands::sessions::end_session,
            commands::sessions::list_sessions_for_project,
            commands::sessions::list_active_sessions,
            commands::sessions::recover_orphan_sessions,
            commands::scan::scan_library_location,
            commands::scan::debug_detect_project,
            commands::locations::pick_library_folder,
            commands::locations::pick_project_parent_folder,
            commands::project_wizard::list_project_templates,
            commands::project_wizard::create_project_from_template,
            commands::github_device::is_github_device_configured,
            commands::github_device::start_github_device_flow,
            commands::github_device::wait_github_device_flow,
            commands::github_remote::get_github_repo_for_project,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::list_settings,
            commands::settings::export_library_snapshot,
            commands::task_runner::spawn_project_task,
            commands::task_runner::open_project_shell,
            commands::ide::list_discovered_ides,
            commands::ide::list_running_projects,
            commands::ide::open_project_in_ide,
            commands::ide::stop_project_ide,
            commands::ide::is_project_ide_running,
            commands::embedded_terminal::embedded_terminal_spawn,
            commands::embedded_terminal::list_available_shells,
            commands::embedded_terminal::embedded_terminal_write,
            commands::embedded_terminal::embedded_terminal_resize,
            commands::embedded_terminal::embedded_terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
