use tauri::AppHandle;

#[tauri::command]
pub async fn show_system_notification(
    app: AppHandle,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    let app_id = app.config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::notifications::show(&title, body.as_deref(), &app_id)
    })
        .await
        .map_err(|e| e.to_string())?
}
