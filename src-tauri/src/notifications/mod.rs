#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::{register_windows_notifications, show};

#[cfg(not(windows))]
pub fn register_windows_notifications(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn show(title: &str, body: Option<&str>, app_id: &str) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification.summary(title);
    if let Some(text) = body.filter(|s| !s.is_empty()) {
        notification.body(text);
    }
    notification.auto_icon();

    #[cfg(target_os = "macos")]
    {
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            app_id
        });
    }

    notification
        .show()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
