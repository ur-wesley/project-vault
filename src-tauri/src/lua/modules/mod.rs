use tauri::AppHandle;
use crate::lua::ui::UiBridge;

#[derive(Clone)]
pub struct ModuleContext {
    pub app: Option<AppHandle>,
    pub bridge: Option<UiBridge>,
    pub plugin_id: Option<String>,
}

pub mod external_api;
pub mod plugin_api;
pub mod log;
pub mod notification;
pub mod settings;
pub mod theme;
pub mod i18n;
pub mod projects;
pub mod mise;
pub mod fs;
pub mod serialization;
pub mod ui_ext;
pub mod git;
pub mod github;
pub mod event;
pub mod process;
pub mod shell;

