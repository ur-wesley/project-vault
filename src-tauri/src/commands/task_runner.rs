use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::spawn::embedded;
use crate::spawn::{
    argv_needs_confirmation, open_interactive_shell, spawn_in_new_console, use_mise_for_project,
    EmbeddedTerminals,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnProjectTaskPayload {
    pub project_id: String,
    pub argv: Vec<String>,
    pub acknowledge_risk: bool,
    pub session_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnProjectTaskResponse {
    pub session_id: String,
    pub stream_output: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectShellPayload {
    pub project_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEmit {
    session_id: String,
    project_id: String,
}

#[tauri::command]
pub async fn spawn_project_task(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    payload: SpawnProjectTaskPayload,
) -> Result<SpawnProjectTaskResponse, StableError> {
    if payload.argv.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "argv empty"));
    }
    if argv_needs_confirmation(&payload.argv) && !payload.acknowledge_risk {
        return Err(StableError::new(
            codes::CONFIRM_REQUIRED,
            "high-risk command needs confirmation",
        ));
    }
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let cwd = std::path::PathBuf::from(&project.path);
    if !cwd.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project path not a directory",
        ));
    }
    let use_mise = use_mise_for_project(&cwd);
    let cmd_line = payload.argv.join(" ");

    let shell_pref = {
        let custom = db::get_setting(&pool, "shell_path")
            .await?
            .filter(|s| !s.trim().is_empty());
        if custom.is_some() {
            custom
        } else {
            db::get_setting(&pool, "default_shell_path")
                .await?
                .filter(|s| !s.trim().is_empty())
        }
    };

    let session = db::start_session(&pool, &payload.project_id, Some(cmd_line), payload.session_id).await?;
    let session_id = session.id.clone();
    let response_session_id = session_id.clone();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if embedded::spawn_task_in_pty(
            app.clone(),
            &terms,
            &cwd,
            &payload.argv,
            use_mise,
            session_id.clone(),
            project.runtime_hint.clone(),
            project.stack.clone(),
            shell_pref,
        )
        .is_ok()
        {
            return Ok(SpawnProjectTaskResponse {
                session_id: response_session_id,
                stream_output: true,
            });
        }
    }
    let mut child = match spawn_in_new_console(
        &cwd,
        &payload.argv,
        use_mise,
        project.runtime_hint.as_deref(),
        &project.stack,
    ) {
        Ok(c) => c,
        Err(e) => {
            let _ = db::end_session(&pool, &session_id).await;
            return Err(e);
        }
    };
    let app_h = app.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        tauri::async_runtime::block_on(async move {
            let db = app_h.state::<DbInstances>();
            if let Ok(pool) = db::sqlite_pool(&*db).await {
                if let Ok(s) = db::end_session(&pool, &session_id).await {
                    let _ = app_h.emit(
                        "session:ended",
                        SessionEndedEmit {
                            session_id: s.id,
                            project_id: s.project_id,
                        },
                    );
                }
            }
        });
    });
    Ok(SpawnProjectTaskResponse {
        session_id: response_session_id,
        stream_output: false,
    })
}

#[tauri::command]
pub async fn open_project_shell(
    db: State<'_, DbInstances>,
    payload: OpenProjectShellPayload,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let cwd = std::path::PathBuf::from(&project.path);
    if !cwd.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project path not a directory",
        ));
    }
    let shell_pref = db::get_setting(&pool, "shell_path")
        .await?
        .filter(|s| !s.trim().is_empty());
    open_interactive_shell(&cwd, shell_pref.as_deref())?;
    db::touch_project_opened(&pool, &payload.project_id).await?;
    Ok(())
}
