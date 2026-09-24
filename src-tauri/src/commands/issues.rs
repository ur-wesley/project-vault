use crate::db::sqlite_pool;
use crate::error::Result;
use crate::issues::{CreateIssueInput, Issue, IssueManager, UpdateIssueInput};
use tauri::State;
use tauri_plugin_sql::DbInstances;

#[tauri::command]
pub async fn list_issues(project_id: String, db: State<'_, DbInstances>) -> Result<Vec<Issue>> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.list_issues(&project_id).await
}

#[tauri::command]
pub async fn get_issue(
    project_id: String,
    number: i64,
    db: State<'_, DbInstances>,
) -> Result<Issue> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.get_issue(&project_id, number).await
}

#[tauri::command]
pub async fn create_issue(
    project_id: String,
    input: CreateIssueInput,
    db: State<'_, DbInstances>,
) -> Result<Issue> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.create_issue(&project_id, input).await
}

#[tauri::command]
pub async fn update_issue(
    project_id: String,
    number: i64,
    input: UpdateIssueInput,
    db: State<'_, DbInstances>,
) -> Result<Issue> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.update_issue(&project_id, number, input).await
}

#[tauri::command]
pub async fn delete_issue(
    project_id: String,
    number: i64,
    db: State<'_, DbInstances>,
) -> Result<()> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.delete_issue(&project_id, number).await
}

#[tauri::command]
pub async fn delete_all_local_issues(project_id: String, db: State<'_, DbInstances>) -> Result<()> {
    let pool = sqlite_pool(&*db).await?;
    let manager = IssueManager::new(pool, &project_id).await?;
    manager.delete_all_issues(&project_id).await
}
