use std::path::Path;

pub use draft::ProjectDraft;

pub mod detectors;
pub mod draft;
pub mod paths;
pub mod project_icon;
pub mod registry;
pub mod skip;
pub mod walk;
pub mod workspace;
pub mod workspace_manifest;

pub use paths::path_key;
pub use project_icon::find_project_icon;
pub use registry::DetectorRegistry;
pub use walk::{
    collect_projects_under_root, filter_workspaces_and_outermost, filter_outermost_projects,
};
use tauri::Manager;

pub fn detectors_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("detectors")
}

pub trait ProjectDetector: Send + Sync {
    fn id(&self) -> &'static str;
    fn priority(&self) -> i32;
    fn markers(&self) -> &'static [&'static str];
    fn detect(&self, path: &Path) -> Option<ProjectDraft>;
}
