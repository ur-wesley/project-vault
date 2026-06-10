use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::DbInstances;

use crate::clipboard_history::{
    apply_entry, capture_overlay_anchor, clear_entries, compute_overlay_position, delete_entry,
    entry_thumbnail_data_url, get_entry, list_entries, load_settings, save_settings, toggle_pin,
    update_text_entry, ClearClipboardHistoryArgs, ClipboardEntryDto, ClipboardHistorySettingsDto,
    ClipboardOverlayPositionDto, ListClipboardHistoryArgs, UpdateClipboardEntryArgs,
};
use crate::clipboard_history::save_foreground_hwnd;
use crate::db;
use crate::error::StableError;

#[tauri::command]
pub async fn list_clipboard_history(
    db: State<'_, DbInstances>,
    args: ListClipboardHistoryArgs,
) -> Result<Vec<ClipboardEntryDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let limit = args.limit.unwrap_or(200).min(500);
    let offset = args.offset.unwrap_or(0);
    list_entries(
        &pool,
        args.query.as_deref(),
        args.kind.as_deref(),
        limit,
        offset,
    )
    .await
}

#[tauri::command]
pub async fn delete_clipboard_entry(
    app: AppHandle,
    db: State<'_, DbInstances>,
    id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    delete_entry(&pool, &id, &app_data).await
}

#[tauri::command]
pub async fn clear_clipboard_history(
    app: AppHandle,
    db: State<'_, DbInstances>,
    args: ClearClipboardHistoryArgs,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    clear_entries(&pool, &app_data, args.keep_pinned.unwrap_or(false)).await
}

#[tauri::command]
pub async fn update_clipboard_entry(
    db: State<'_, DbInstances>,
    args: UpdateClipboardEntryArgs,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    update_text_entry(&pool, &args.id, &args.text).await
}

#[tauri::command]
pub async fn toggle_clipboard_pin(
    db: State<'_, DbInstances>,
    id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    toggle_pin(&pool, &id).await
}

#[tauri::command]
pub async fn apply_clipboard_entry(app: AppHandle, id: String) -> Result<(), StableError> {
    apply_entry(&app, &id).await
}

#[tauri::command]
pub async fn get_clipboard_history_settings(
    db: State<'_, DbInstances>,
) -> Result<ClipboardHistorySettingsDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    load_settings(&pool).await
}

#[tauri::command]
pub async fn set_clipboard_history_settings(
    db: State<'_, DbInstances>,
    settings: ClipboardHistorySettingsDto,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    save_settings(&pool, &settings).await
}

#[tauri::command]
pub async fn close_clipboard_overlay(app: AppHandle) -> Result<(), StableError> {
    if let Some(w) = app.get_webview_window("clipboard-overlay") {
        let _ = w.hide();
        w.destroy()
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn capture_clipboard_overlay_anchor(app: AppHandle) -> Result<(), StableError> {
    capture_overlay_anchor(&app)
}

#[tauri::command]
pub fn get_clipboard_overlay_position(
    app: AppHandle,
    width: u32,
    height: u32,
) -> Result<ClipboardOverlayPositionDto, StableError> {
    compute_overlay_position(&app, width, height)
}

#[tauri::command]
pub async fn get_clipboard_entry_thumbnail(
    app: AppHandle,
    db: State<'_, DbInstances>,
    id: String,
    max_size: Option<u32>,
) -> Result<Option<String>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let entry = get_entry(&pool, &id).await?;
    let Some(entry) = entry else {
        return Ok(None);
    };
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    let size = max_size.unwrap_or(56).clamp(24, 128);
    entry_thumbnail_data_url(&app_data, &entry, size)
}

#[tauri::command]
pub async fn save_clipboard_foreground_window(app: AppHandle) -> Result<(), StableError> {
    save_foreground_hwnd(&app);
    Ok(())
}
