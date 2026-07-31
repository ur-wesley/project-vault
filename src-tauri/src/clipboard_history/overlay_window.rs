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
        }
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
