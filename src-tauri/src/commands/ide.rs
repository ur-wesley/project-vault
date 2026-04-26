use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::error::StableError;
use crate::models::IdeCandidateDto;
use crate::spawn::ProjectIdeSessions;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectIdePayload {
    pub project_id: String,
    pub executable: String,
}

#[tauri::command]
pub fn list_discovered_ides() -> Vec<IdeCandidateDto> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        vec![]
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::ide::discover_ides()
    }
}

#[tauri::command]
pub async fn open_project_in_ide(
    app: AppHandle,
    _db: State<'_, DbInstances>,
    sessions: State<'_, ProjectIdeSessions>,
    payload: OpenProjectIdePayload,
) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (&app, &_db, &sessions, &payload);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "opening projects in an external IDE is not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::spawn::ide_session::start_ide_session(app, &sessions, payload.project_id, payload.executable).await
    }
}

#[tauri::command]
pub async fn stop_project_ide(
    sessions: State<'_, ProjectIdeSessions>,
    project_id: String,
) -> Result<(), StableError> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::spawn::ide_session::stop_ide_session(&sessions, &project_id)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (sessions, project_id);
        Ok(())
    }
}

#[tauri::command]
pub fn is_project_ide_running(
    sessions: State<'_, ProjectIdeSessions>,
    project_id: String,
) -> bool {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::spawn::ide_session::is_ide_running(&sessions, &project_id)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (sessions, project_id);
        false
    }
}

#[tauri::command]
pub fn list_running_projects(
    sessions: State<'_, ProjectIdeSessions>,
) -> Vec<String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::spawn::ide_session::list_running_project_ids(&sessions)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = sessions;
        vec![]
    }
}
