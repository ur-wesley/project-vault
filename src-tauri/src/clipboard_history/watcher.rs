use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;

use super::store::{self, ensure_blobs_dir, md5_hash};
use super::types::{
    preview_for_files, truncate_preview, ClipboardEntryKind, ClipboardEntryMeta, MAX_TEXT_BYTES,
};

pub struct ClipboardWatcherState {
    pub ignore_next_change: AtomicBool,
    #[cfg(windows)]
    pub saved_foreground_hwnd: std::sync::Mutex<Option<isize>>,
    #[cfg(windows)]
    pub saved_caret_anchor: std::sync::Mutex<Option<(i32, i32, i32)>>,
}

impl ClipboardWatcherState {
    pub fn new() -> Self {
        Self {
            ignore_next_change: AtomicBool::new(false),
            #[cfg(windows)]
            saved_foreground_hwnd: std::sync::Mutex::new(None),
            #[cfg(windows)]
            saved_caret_anchor: std::sync::Mutex::new(None),
        }
    }

    pub fn set_ignore(&self, ignore: bool) {
        self.ignore_next_change.store(ignore, Ordering::SeqCst);
    }

    pub fn should_ignore(&self) -> bool {
        self.ignore_next_change.load(Ordering::SeqCst)
    }
}

pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_fingerprint: Option<String> = None;
        let mut ticker = tokio::time::interval(Duration::from_millis(400));

        loop {
            ticker.tick().await;

            let settings = match load_settings_for_watcher(&app).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[clipboard] failed to load settings: {}", e.message);
                    continue;
                }
            };

            if !settings.enabled {
                last_fingerprint = None;
                continue;
            }

            let fingerprint = match read_clipboard_fingerprint() {
                Ok(fp) => fp,
                Err(_) => continue,
            };

            let Some(fp) = fingerprint else {
                continue;
            };

            if last_fingerprint.as_ref() == Some(&fp) {
                continue;
            }
            last_fingerprint = Some(fp.clone());

            if let Err(e) = capture_clipboard_change(&app, &settings).await {
                eprintln!("[clipboard] capture failed: {}", e.message);
            }
        }
    });
}

fn read_clipboard_fingerprint() -> Result<Option<String>, StableError> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| StableError::new("CLIPBOARD", format!("clipboard open: {e}")))?;

    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            let joined: String = paths
                .iter()
                .map(|p| p.to_string_lossy())
                .collect::<Vec<_>>()
                .join("\n");
            return Ok(Some(format!("files:{:x}", md5_hash(joined.as_bytes()))));
        }
    }

    if let Ok(text) = clipboard.get().text() {
        if !text.is_empty() {
            return Ok(Some(format!("text:{:x}", md5_hash(text.as_bytes()))));
        }
    }

    if let Ok(img) = clipboard.get().image() {
        return Ok(Some(format!(
            "image:{:x}:{}x{}",
            md5_hash(&img.bytes),
            img.width,
            img.height
        )));
    }

    Ok(None)
}

async fn load_settings_for_watcher(
    app: &AppHandle,
) -> Result<super::types::ClipboardHistorySettingsDto, StableError> {
    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;
    store::load_settings(&pool).await
}

async fn capture_clipboard_change(
    app: &AppHandle,
    settings: &super::types::ClipboardHistorySettingsDto,
) -> Result<(), StableError> {
    let state = app.state::<Arc<ClipboardWatcherState>>();
    if state.should_ignore() {
        state.set_ignore(false);
        return Ok(());
    }

    let mut clipboard = Clipboard::new()
        .map_err(|e| StableError::new("CLIPBOARD", format!("clipboard open: {e}")))?;

    let source_app = current_source_app();

    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            return persist_files(app, settings, paths, source_app).await;
        }
    }

    if let Ok(text) = clipboard.get().text() {
        if !text.is_empty() {
            return persist_text(app, settings, ClipboardEntryKind::Text, text, source_app).await;
        }
    }

    if let Ok(img) = clipboard.get().image() {
        return persist_image(app, settings, img, source_app).await;
    }

    Ok(())
}

async fn persist_text(
    app: &AppHandle,
    settings: &super::types::ClipboardHistorySettingsDto,
    kind: ClipboardEntryKind,
    text: String,
    source_app: Option<String>,
) -> Result<(), StableError> {
    let bounded: String = text.chars().take(MAX_TEXT_BYTES).collect();
    let hash = format!("{:x}", md5_hash(bounded.as_bytes()));
    let preview = truncate_preview(&bounded, 120);

    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;

    if let Some(existing_id) = store::touch_duplicate(&pool, &hash, settings.dedup_seconds).await?
    {
        if let Some(entry) = store::get_entry(&pool, &existing_id).await? {
            let _ = app.emit("clipboard:entry-added", &entry);
        }
        return Ok(());
    }

    let app_data = app_data_path(app)?;
    let entry = store::insert_entry(
        &pool,
        &app_data,
        kind,
        Some(bounded),
        hash,
        None,
        ClipboardEntryMeta::default(),
        preview,
        if settings.show_source { source_app } else { None },
        settings.max_entries,
    )
    .await?;

    let _ = app.emit("clipboard:entry-added", &entry);
    Ok(())
}

async fn persist_files(
    app: &AppHandle,
    settings: &super::types::ClipboardHistorySettingsDto,
    paths: Vec<PathBuf>,
    source_app: Option<String>,
) -> Result<(), StableError> {
    let path_strings: Vec<String> = paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let hash = format!("{:x}", md5_hash(path_strings.join("\n").as_bytes()));
    let preview = preview_for_files(&path_strings);
    let meta = ClipboardEntryMeta {
        file_paths: path_strings,
        ..Default::default()
    };

    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;

    if let Some(existing_id) = store::touch_duplicate(&pool, &hash, settings.dedup_seconds).await?
    {
        if let Some(entry) = store::get_entry(&pool, &existing_id).await? {
            let _ = app.emit("clipboard:entry-added", &entry);
        }
        return Ok(());
    }

    let app_data = app_data_path(app)?;
    let entry = store::insert_entry(
        &pool,
        &app_data,
        ClipboardEntryKind::Files,
        None,
        hash,
        None,
        meta,
        preview,
        if settings.show_source { source_app } else { None },
        settings.max_entries,
    )
    .await?;

    let _ = app.emit("clipboard:entry-added", &entry);
    Ok(())
}

async fn persist_image(
    app: &AppHandle,
    settings: &super::types::ClipboardHistorySettingsDto,
    img: ImageData<'_>,
    source_app: Option<String>,
) -> Result<(), StableError> {
    let byte_size = img.bytes.len() as u64;
    if byte_size > settings.max_image_bytes {
        return Ok(());
    }

    let hash = format!("{:x}", md5_hash(&img.bytes));
    let app_data = app_data_path(app)?;
    let blobs = ensure_blobs_dir(&app_data)?;
    let id = uuid::Uuid::new_v4().to_string();
    let rel = format!("clipboard-history/blobs/{id}.rgba");
    let full_path = blobs.join(format!("{id}.rgba"));

    std::fs::write(&full_path, &img.bytes)
        .map_err(|e| StableError::new("CLIPBOARD", format!("write image blob: {e}")))?;

    let preview = format!("Image {}×{}", img.width, img.height);
    let meta = ClipboardEntryMeta {
        width: Some(img.width as u32),
        height: Some(img.height as u32),
        byte_size: Some(byte_size),
        mime: Some("image/rgba".to_string()),
        ..Default::default()
    };

    let db = app.state::<DbInstances>();
    let pool = db::sqlite_pool(&*db).await?;

    if let Some(existing_id) = store::touch_duplicate(&pool, &hash, settings.dedup_seconds).await?
    {
        let _ = std::fs::remove_file(&full_path);
        if let Some(entry) = store::get_entry(&pool, &existing_id).await? {
            let _ = app.emit("clipboard:entry-added", &entry);
        }
        return Ok(());
    }

    let entry = store::insert_entry(
        &pool,
        &app_data,
        ClipboardEntryKind::Image,
        None,
        hash,
        Some(rel),
        meta,
        preview,
        if settings.show_source { source_app } else { None },
        settings.max_entries,
    )
    .await?;

    let _ = app.emit("clipboard:entry-added", &entry);
    Ok(())
}

fn app_data_path(app: &AppHandle) -> Result<PathBuf, StableError> {
    app.path()
        .app_data_dir()
        .map_err(|e| StableError::new("INTERNAL", format!("app data dir: {e}")))
}

#[cfg(windows)]
fn current_source_app() -> Option<String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::DataExchange::GetClipboardOwner;

    unsafe {
        let owner: HWND = GetClipboardOwner().ok()?;
        if owner.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        let _ = windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            owner,
            Some(&mut pid),
        );
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size).ok()?;
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        path.rsplit(['\\', '/']).next().map(|s| s.to_string())
    }
}

#[cfg(not(windows))]
fn current_source_app() -> Option<String> {
    None
}
