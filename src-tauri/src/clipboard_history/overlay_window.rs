use tauri::WebviewWindow;

use crate::error::StableError;

#[cfg(target_os = "windows")]
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;

#[cfg(target_os = "windows")]
const DWMWCP_ROUND: u32 = 2;

#[cfg(target_os = "windows")]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: isize,
        attribute: u32,
        value: *const std::ffi::c_void,
        size: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
fn activate_overlay(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::AttachThreadInput;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    unsafe {
        let overlay = HWND(hwnd as *mut _);
        let foreground = GetForegroundWindow();
        let overlay_thread = GetWindowThreadProcessId(overlay, None);
        let fore_thread = GetWindowThreadProcessId(foreground, None);
        let attached = !foreground.0.is_null()
            && overlay_thread != fore_thread
            && AttachThreadInput(overlay_thread, fore_thread, true).as_bool();

        let _ = SetForegroundWindow(overlay);

        if attached {
            let _ = AttachThreadInput(overlay_thread, fore_thread, false);
        }
    }
}

#[cfg(target_os = "windows")]
fn root_hwnd_val(hwnd: windows::Win32::Foundation::HWND) -> isize {
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};

    unsafe {
        let root = GetAncestor(hwnd, GA_ROOT);
        if root.0.is_null() {
            hwnd.0 as isize
        } else {
            root.0 as isize
        }
    }
}

#[cfg(target_os = "windows")]
fn watch_foreground_loss(window: &WebviewWindow) {
    use std::time::Duration;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let overlay_root = root_hwnd_val(HWND(hwnd.0 as *mut _));
    let window = window.clone();

    std::thread::spawn(move || {
        for _ in 0..100 {
            if window.is_visible().unwrap_or(false) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(200));

        loop {
            match window.is_visible() {
                Ok(true) => {}
                _ => break,
            }

            let fg = unsafe { GetForegroundWindow() };
            if !fg.0.is_null() && root_hwnd_val(fg) != overlay_root {
                let _ = window.destroy();
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
}

pub fn apply_overlay_effects(window: &WebviewWindow) -> Result<(), StableError> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;

        apply_acrylic(window, Some((18, 18, 18, 140)))
            .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;

        if let Ok(hwnd) = window.hwnd() {
            let round = DWMWCP_ROUND;
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as isize,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    &round as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }
            activate_overlay(hwnd.0 as isize);
        }
        watch_foreground_loss(window);
    }

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            None,
            None,
        )
        .map_err(|e| StableError::new(crate::error::codes::INTERNAL, e.to_string()))?;
    }

    let _ = window;
    Ok(())
}
