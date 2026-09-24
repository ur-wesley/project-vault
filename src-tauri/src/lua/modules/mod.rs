use crate::lua::ui::UiBridge;
use tauri::AppHandle;

#[derive(Clone)]
pub struct ModuleContext {
    pub app: Option<AppHandle>,
    pub bridge: Option<UiBridge>,
    pub plugin_id: Option<String>,
}

pub mod app_settings;
pub mod event;
pub mod external_api;
pub mod fs;
pub mod git;
pub mod github;
pub mod i18n;
pub mod log;
pub mod mise;
pub mod notification;
pub mod plugin_api;
pub mod postgres;
pub mod process;
pub mod projects;
pub mod serialization;
pub mod settings;
pub mod shell;
pub mod store;
pub mod system;
pub mod theme;
pub mod ui_ext;
