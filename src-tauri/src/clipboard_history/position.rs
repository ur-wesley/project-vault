use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::StableError;

#[cfg(windows)]
use super::caret::{resolve_caret_anchor, CaretAnchor};
use super::watcher::ClipboardWatcherState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardOverlayPositionDto {
    pub window_x: i32,
    pub window_y: i32,
    pub window_width: u32,
    pub window_height: u32,
    pub panel_x: i32,
    pub panel_y: i32,
}

const GAP_PX: i32 = 10;

#[cfg(windows)]
struct MonitorWorkArea {
    scale: f64,
    work_left: i32,
    work_top: i32,
    work_right: i32,
    work_bottom: i32,
}

#[cfg(windows)]
pub fn capture_overlay_anchor(app: &AppHandle) -> Result<(), StableError> {
    save_foreground_hwnd(app);
    if let Some(anchor) = resolve_caret_anchor(app) {
        let state = app.state::<Arc<ClipboardWatcherState>>();
        if let Ok(mut guard) = state.saved_caret_anchor.lock() {
            *guard = Some(anchor);
        };
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn capture_overlay_anchor(_app: &AppHandle) -> Result<(), StableError> {
    Ok(())
}

#[cfg(windows)]
pub fn compute_overlay_position(
    app: &AppHandle,
    width: u32,
    height: u32,
) -> Result<ClipboardOverlayPositionDto, StableError> {
    let anchor = take_saved_caret_anchor(app).or_else(|| resolve_caret_anchor(app));

    unsafe {
        match anchor {
            Some(anchor) => panel_origin_for_anchor(anchor, width, height),
            None => panel_origin_centered_on_focus_monitor(app, width, height),
        }
    }
}

#[cfg(not(windows))]
pub fn compute_overlay_position(
    _app: &AppHandle,
    _width: u32,
    _height: u32,
) -> Result<ClipboardOverlayPositionDto, StableError> {
    Err(StableError::new(
        "UNSUPPORTED",
        "caret positioning is only available on Windows",
    ))
}

#[cfg(windows)]
unsafe fn panel_origin_for_anchor(
    anchor: CaretAnchor,
    width: u32,
    height: u32,
) -> Result<ClipboardOverlayPositionDto, StableError> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};

    let (anchor_x, anchor_y, caret_top) = anchor;
    let point = POINT {
        x: anchor_x,
        y: anchor_y,
    };
    let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
    let work = monitor_work_area(monitor)?;

    let panel_w_phys = (width as f64 * work.scale).round() as i32;
    let panel_h_phys = (height as f64 * work.scale).round() as i32;

    let mut x = anchor_x;
    let mut y = anchor_y + GAP_PX;

    if y + panel_h_phys > work.work_bottom {
        y = caret_top - panel_h_phys - GAP_PX;
    }
    if y < work.work_top {
        y = work.work_top;
    }
    if y + panel_h_phys > work.work_bottom {
        y = work.work_bottom - panel_h_phys;
    }

    if x + panel_w_phys > work.work_right {
        x = work.work_right - panel_w_phys;
    }
    if x < work.work_left {
        x = work.work_left;
    }

    Ok(layout_from_work_area(work, x, y))
}

#[cfg(windows)]
unsafe fn panel_origin_centered_on_focus_monitor(
    app: &AppHandle,
    width: u32,
    height: u32,
) -> Result<ClipboardOverlayPositionDto, StableError> {
    use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = foreground_hwnd(app)
        .filter(|h| !h.0.is_null())
        .unwrap_or(GetForegroundWindow());

    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    let work = monitor_work_area(monitor)?;

    let panel_w_phys = (width as f64 * work.scale).round() as i32;
    let panel_h_phys = (height as f64 * work.scale).round() as i32;
    let work_w = work.work_right - work.work_left;
    let work_h = work.work_bottom - work.work_top;

    let x = work.work_left + (work_w - panel_w_phys) / 2;
    let y = work.work_top + (work_h - panel_h_phys) / 2;

    Ok(layout_from_work_area(work, x, y))
}

#[cfg(windows)]
fn layout_from_work_area(work: MonitorWorkArea, panel_x_phys: i32, panel_y_phys: i32) -> ClipboardOverlayPositionDto {
    let window_x = (work.work_left as f64 / work.scale).round() as i32;
    let window_y = (work.work_top as f64 / work.scale).round() as i32;
    let window_width = ((work.work_right - work.work_left) as f64 / work.scale).round() as u32;
    let window_height = ((work.work_bottom - work.work_top) as f64 / work.scale).round() as u32;
    let panel_x = (panel_x_phys as f64 / work.scale).round() as i32 - window_x;
    let panel_y = (panel_y_phys as f64 / work.scale).round() as i32 - window_y;

    ClipboardOverlayPositionDto {
        window_x,
        window_y,
        window_width,
        window_height,
        panel_x,
        panel_y,
    }
}

#[cfg(windows)]
unsafe fn monitor_work_area(
    monitor: windows::Win32::Graphics::Gdi::HMONITOR,
) -> Result<MonitorWorkArea, StableError> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !GetMonitorInfoW(monitor, &mut info).as_bool() {
        return Err(StableError::new("CLIPBOARD", "GetMonitorInfoW failed"));
    }

    let work: RECT = info.rcWork;
    let scale = monitor_scale(monitor)?;

    Ok(MonitorWorkArea {
        scale,
        work_left: work.left,
        work_top: work.top,
        work_right: work.right,
        work_bottom: work.bottom,
    })
}

#[cfg(windows)]
fn take_saved_caret_anchor(app: &AppHandle) -> Option<CaretAnchor> {
    let state = app.state::<Arc<ClipboardWatcherState>>();
    state
        .saved_caret_anchor
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

#[cfg(windows)]
fn foreground_hwnd(app: &AppHandle) -> Option<windows::Win32::Foundation::HWND> {
    let state = app.state::<Arc<ClipboardWatcherState>>();
    state
        .saved_foreground_hwnd
        .lock()
        .ok()
        .and_then(|guard| guard.map(|h| windows::Win32::Foundation::HWND(h as *mut _)))
}

#[cfg(windows)]
pub fn save_foreground_hwnd(app: &AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let state = app.state::<Arc<ClipboardWatcherState>>();
    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.0.is_null() {
            if let Ok(mut guard) = state.saved_foreground_hwnd.lock() {
                *guard = Some(hwnd.0 as isize);
            }
        }
    }
}

#[cfg(windows)]
unsafe fn monitor_scale(monitor: windows::Win32::Graphics::Gdi::HMONITOR) -> Result<f64, StableError> {
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    let mut dpi_x = 0u32;
    let mut dpi_y = 0u32;
    GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
        .map_err(|e| StableError::new("CLIPBOARD", format!("GetDpiForMonitor: {e}")))?;
    Ok(dpi_x.max(dpi_y) as f64 / 96.0)
}
