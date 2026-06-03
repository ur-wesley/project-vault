use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::{ImageBuffer, Rgba};
use tauri::{AppHandle, Manager};
use tauri_winrt_notification::Toast;
use windows_registry::CURRENT_USER;

static TOAST_ICON: OnceLock<PathBuf> = OnceLock::new();

pub fn register_windows_notifications(app: &AppHandle) -> Result<(), String> {
    let app_id = app.config().identifier.clone();
    let display_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Project Vault".to_string());
    let icon_path = resolve_icon_path(app);
    if let Some(ref path) = icon_path {
        let _ = TOAST_ICON.set(path.clone());
    }

    set_process_app_id(&app_id)?;
    register_app_model_registry(&app_id, &display_name, icon_path.as_deref())?;
    register_notification_settings(&app_id)?;
    install_start_menu_shortcut(app, &app_id, &display_name, icon_path.as_deref())?;

    Ok(())
}

pub fn show(title: &str, body: Option<&str>, app_id: &str) -> Result<(), String> {
    let mut toast = Toast::new(app_id).title(title);
    if let Some(text) = body.filter(|s| !s.is_empty()) {
        toast = toast.text1(text);
    }
    toast.show().map_err(|e| e.to_string())
}

fn set_process_app_id(app_id: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let wide: Vec<u16> = OsStr::new(app_id).encode_wide().chain(Some(0)).collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(PCWSTR(wide.as_ptr()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn register_app_model_registry(
    app_id: &str,
    display_name: &str,
    icon_path: Option<&Path>,
) -> Result<(), String> {
    let key = CURRENT_USER
        .create(format!(r"Software\Classes\AppUserModelId\{app_id}"))
        .map_err(|e| e.to_string())?;
    key.set_string("DisplayName", display_name)
        .map_err(|e| e.to_string())?;
    key.set_string("IconBackgroundColor", "0")
        .map_err(|e| e.to_string())?;
    if let Some(icon) = icon_path {
        key.set_string("IconUri", &file_uri(icon))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn register_notification_settings(app_id: &str) -> Result<(), String> {
    let key = CURRENT_USER
        .create(format!(
            r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{app_id}"
        ))
        .map_err(|e| e.to_string())?;
    key.set_u32("Enabled", 1).map_err(|e| e.to_string())?;
    Ok(())
}

fn install_start_menu_shortcut(
    _app: &AppHandle,
    app_id: &str,
    display_name: &str,
    icon_path: Option<&Path>,
) -> Result<(), String> {
    let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
    let shortcut_path = start_menu_shortcut_path(display_name);
    if let Some(parent) = shortcut_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let shortcut_icon = icon_path
        .and_then(shortcut_icon_path)
        .or_else(|| tauri::utils::platform::current_exe().ok());
    create_shell_link(
        &shortcut_path,
        &exe,
        display_name,
        app_id,
        shortcut_icon.as_deref(),
    )?;
    Ok(())
}

fn start_menu_shortcut_path(display_name: &str) -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(appdata)
        .join(r"Microsoft\Windows\Start Menu\Programs")
        .join(format!("{display_name}.lnk"))
}

fn resolve_icon_path(app: &AppHandle) -> Option<PathBuf> {
    icon_from_resource_dir(app)
        .or_else(icon_from_manifest_dir)
        .or_else(|| icon_from_embedded(app))
}

fn icon_from_resource_dir(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    for candidate in [
        "icons/icon.ico",
        "icon.ico",
        "icons/128x128.png",
        "icons/32x32.png",
    ] {
        if let Some(path) = canonicalize_if_exists(&resource_dir.join(candidate)) {
            return Some(path);
        }
    }
    None
}

fn icon_from_manifest_dir() -> Option<PathBuf> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for candidate in [
        "icons/icon.ico",
        "icons/128x128.png",
        "icons/32x32.png",
    ] {
        if let Some(path) = canonicalize_if_exists(&base.join(candidate)) {
            return Some(path);
        }
    }
    None
}

fn icon_from_embedded(app: &AppHandle) -> Option<PathBuf> {
    let icon = app.default_window_icon()?;
    let cache_dir = app.path().app_cache_dir().ok()?;
    let path = cache_dir.join("notification-toast-icon.png");
    if path.is_file() {
        return canonicalize_if_exists(&path);
    }
    std::fs::create_dir_all(&cache_dir).ok()?;
    write_icon_png(&path, icon).ok()?;
    canonicalize_if_exists(&path)
}

fn shortcut_icon_path(path: &Path) -> Option<PathBuf> {
    if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("ico")) {
        return canonicalize_if_exists(path);
    }
    None
}

fn write_icon_png(path: &Path, icon: &tauri::image::Image<'_>) -> Result<(), String> {
    let width = icon.width();
    let height = icon.height();
    let buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, icon.rgba().to_vec())
        .ok_or_else(|| "invalid embedded icon dimensions".to_string())?;
    buffer.save(path).map_err(|e| e.to_string())
}

fn canonicalize_if_exists(path: &Path) -> Option<PathBuf> {
    if !path.is_file() {
        return None;
    }
    path.canonicalize().ok().map(|p| {
        let p_str = p.to_string_lossy();
        if p_str.starts_with(r"\\?\") {
            PathBuf::from(&p_str[4..])
        } else {
            p
        }
    })
}

fn file_uri(path: &Path) -> String {
    let abs = path
        .canonicalize()
        .ok()
        .map(|p| {
            let p_str = p.to_string_lossy();
            if p_str.starts_with(r"\\?\") {
                PathBuf::from(&p_str[4..])
            } else {
                p
            }
        })
        .unwrap_or_else(|| path.to_path_buf());
    let normalized = abs.display().to_string().replace('\\', "/");
    if normalized.starts_with("//") {
        format!("file:{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

fn create_shell_link(
    shortcut_path: &Path,
    exe_path: &Path,
    description: &str,
    app_id: &str,
    icon_path: Option<&Path>,
) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR, PROPVARIANT};
    use windows::Win32::Foundation::TRUE;
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, IPersistFile,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let result = (|| -> Result<(), String> {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;

            let exe_wide = wide(&exe_path.to_string_lossy());
            link.SetPath(PCWSTR(exe_wide.as_ptr()))
                .map_err(|e| e.to_string())?;

            let desc_wide = wide(description);
            link.SetDescription(PCWSTR(desc_wide.as_ptr()))
                .map_err(|e| e.to_string())?;

            if let Some(icon) = icon_path {
                let icon_wide = wide(&icon.to_string_lossy());
                link.SetIconLocation(PCWSTR(icon_wide.as_ptr()), 0)
                    .map_err(|e| e.to_string())?;
            }

            let property_store: IPropertyStore = link.cast().map_err(|e| e.to_string())?;
            let prop = PROPVARIANT::from(app_id);
            property_store
                .SetValue(&PKEY_AppUserModel_ID, &prop)
                .map_err(|e| e.to_string())?;
            property_store.Commit().map_err(|e| e.to_string())?;

            let persist: IPersistFile = link.cast().map_err(|e| e.to_string())?;
            let shortcut_wide = wide(&shortcut_path.to_string_lossy());
            persist
                .Save(PCWSTR(shortcut_wide.as_ptr()), TRUE)
                .map_err(|e| e.to_string())?;

            Ok(())
        })();

        CoUninitialize();
        result
    }
}
