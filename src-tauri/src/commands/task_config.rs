use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::models::TaskDto;
use crate::task_config::{self, ProjectTaskConfig};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTaskPayload {
    pub project_id: String,
    pub task: TaskDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskPayload {
    pub project_id: String,
    pub task: TaskDto,
}

#[tauri::command]
pub async fn read_project_task_config(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<ProjectTaskConfig, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let path = std::path::Path::new(&project.path);
    Ok(task_config::read_project_tasks(path))
}

fn merge_config_tasks(existing: &[TaskDto], config_tasks: &[TaskDto]) -> Vec<TaskDto> {
    // Keep all non-config tasks (package.json, cargo, etc.)
    let mut merged: Vec<TaskDto> = existing
        .iter()
        .filter(|t| t.kind != "mise" && t.kind != "justfile")
        .cloned()
        .collect();
    // Append current config-file tasks
    merged.extend(config_tasks.iter().cloned());
    merged
}

#[tauri::command]
pub async fn write_project_task(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: WriteTaskPayload,
) -> Result<Vec<TaskDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let path = std::path::Path::new(&project.path);

    if let Some(existing) = project.tasks.iter().find(|t| t.id == payload.task.id) {
        let _ = task_config::delete_project_task(path, existing);
    }

    task_config::write_project_task(path, &payload.task)
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))?;

    let config = task_config::read_project_tasks(path);
    let merged = merge_config_tasks(&project.tasks, &config.tasks);
    db::update_project_tasks(&pool, &payload.project_id, &merged).await?;
    crate::models::emit_project_changed(&app, &payload.project_id, "tasks");

    Ok(merged)
}

#[tauri::command]
pub async fn delete_project_task(
    app: AppHandle,
    db: State<'_, DbInstances>,
    payload: DeleteTaskPayload,
) -> Result<Vec<TaskDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &payload.project_id).await?;
    let path = std::path::Path::new(&project.path);
    task_config::delete_project_task(path, &payload.task)
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e))?;

    let config = task_config::read_project_tasks(path);
    let merged = merge_config_tasks(&project.tasks, &config.tasks);
    db::update_project_tasks(&pool, &payload.project_id, &merged).await?;
    crate::models::emit_project_changed(&app, &payload.project_id, "tasks");

    Ok(merged)
}
