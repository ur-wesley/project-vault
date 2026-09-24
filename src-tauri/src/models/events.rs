use serde::Serialize;

use tauri::{AppHandle, Emitter};
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChangedEmit {
    pub project_id: String,
    pub change_type: String,
}

pub fn emit_project_changed(app: &AppHandle, project_id: &str, change_type: &str) {
    let _ = app.emit(
        "project:changed",
        ProjectChangedEmit {
            project_id: project_id.to_string(),
            change_type: change_type.to_string(),
        },
    );
}

pub fn notify_git_status_changed(app: &AppHandle, project_id: &str, change_type: &str) {
    let payload = ProjectChangedEmit {
        project_id: project_id.to_string(),
        change_type: change_type.to_string(),
    };
    let _ = app.emit("project:changed", &payload);
    let _ = app.emit("git:status-changed", payload);
}


