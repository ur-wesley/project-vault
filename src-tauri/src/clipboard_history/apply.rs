use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

use super::store;
use super::types::ClipboardEntryKind;
use super::watcher::ClipboardWatcherState;

pub async fn apply_entry(app: &AppHandle, id: &str) -> Result<(), StableError> {
    let pool = {
        let db = app.state::<DbInstances>();
        db::sqlite_pool(&*db).await?
    };

    let entry = store::get_entry(&pool, id)
        .await?
        .ok_or_else(|| StableError::new(codes::NOT_FOUND, "clipboard entry not found"))?;

    let state = app.state::<Arc<ClipboardWatcherState>>();
    state.set_ignore(true);

    let kind = ClipboardEntryKind::parse(&entry.kind)
        .ok_or_else(|| StableError::new(codes::INTERNAL, "unknown entry kind"))?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| StableError::new(codes::INTERNAL, format!("app data dir: {e}")))?;

    {
        let mut clipboard = Clipboard::new()
            .map_err(|e| StableError::new("CLIPBOARD", format!("open clipboard: {e}")))?;

        match kind {
            ClipboardEntryKind::Text | ClipboardEntryKind::Html => {
                let text = entry.content_text.ok_or_else(|| {
                    StableError::new(codes::INTERNAL, "text entry missing content")
                })?;
                clipboard
                    .set()
                    .text(text)
                    .map_err(|e| StableError::new("CLIPBOARD", format!("set text: {e}")))?;
            }
            ClipboardEntryKind::Files => {
                let paths: Vec<PathBuf> = entry
                    .meta
                    .file_paths
                    .iter()
                    .map(PathBuf::from)
                    .filter(|p| p.exists())
                    .collect();
                if paths.is_empty() {
                    return Err(StableError::new(
                        codes::NOT_FOUND,
                        "file paths no longer exist",
                    ));
                }
                clipboard.set().file_list(&paths).map_err(|e| {
                    StableError::new("CLIPBOARD", format!("set file list: {e}"))
                })?;
            }
            ClipboardEntryKind::Image => {
                let rel = entry.payload_path.ok_or_else(|| {
                    StableError::new(codes::INTERNAL, "image entry missing payload")
                })?;
                let full = app_data.join(rel);
                let bytes = std::fs::read(&full).map_err(|e| {
                    StableError::new(codes::INTERNAL, format!("read image blob: {e}"))
                })?;
                let width = entry.meta.width.unwrap_or(1) as usize;
                let height = entry.meta.height.unwrap_or(1) as usize;
                let img = ImageData {
                    width,
                    height,
                    bytes: bytes.into(),
                };
                clipboard
                    .set()
                    .image(img)
                    .map_err(|e| StableError::new("CLIPBOARD", format!("set image: {e}")))?;
            }
        }
    }

    if let Some(w) = app.get_webview_window("clipboard-overlay") {
        let _ = w.hide();
    }
    thread::sleep(Duration::from_millis(80));
    restore_foreground_window(app, None);
    thread::sleep(Duration::from_millis(50));

    if let Err(e) = simulate_paste() {
        eprintln!("[clipboard] paste simulation failed: {}", e.message);
    }

    if let Some(w) = app.get_webview_window("clipboard-overlay") {
        let _ = w.destroy();
    }

    Ok(())
}

fn simulate_paste() -> Result<(), StableError> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| StableError::new("CLIPBOARD", format!("enigo init: {e}")))?;

    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| StableError::new("CLIPBOARD", format!("ctrl press: {e}")))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| StableError::new("CLIPBOARD", format!("v click: {e}")))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| StableError::new("CLIPBOARD", format!("ctrl release: {e}")))?;

    Ok(())
}

#[cfg(windows)]
fn restore_foreground_window(app: &AppHandle, hwnd: Option<isize>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let target = hwnd.or_else(|| {
        let state = app.state::<Arc<ClipboardWatcherState>>();
        state.saved_foreground_hwnd.lock().ok().and_then(|g| *g)
    });

    let Some(h) = target else {
        return;
    };

    unsafe {
        let hwnd = HWND(h as *mut _);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}

#[cfg(not(windows))]
fn restore_foreground_window(_app: &AppHandle, _hwnd: Option<isize>) {}
