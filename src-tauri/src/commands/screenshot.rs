use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageEncoder, Rgba, RgbaImage};
use tauri::AppHandle;
use xcap::{Monitor, Window};

use crate::error::StableError;
use crate::models::{ScreenInfoDto, WindowInfoDto};

fn encode_jpeg_base64(img: &RgbaImage, quality: u8) -> Result<String, StableError> {
    // JPEG doesn't support alpha — convert to RGB first
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf: Vec<u8> = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| StableError::new("SCREENSHOT_ENCODE", format!("failed to encode JPEG: {e}")))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBoundsDto {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn list_screens() -> Result<Vec<ScreenInfoDto>, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    Ok(monitors
        .into_iter()
        .filter_map(|m| {
            let id = m.id().ok()?;
            let name = m.name().ok().unwrap_or_else(|| format!("Monitor {id}"));
            let width = m.width().ok()?;
            let height = m.height().ok()?;
            let x = m.x().ok()?;
            let y = m.y().ok()?;
            let is_primary = m.is_primary().ok().unwrap_or(false);
            Some(ScreenInfoDto { id, name, width, height, x, y, is_primary })
        })
        .collect())
}

#[tauri::command]
pub fn list_windows() -> Result<Vec<WindowInfoDto>, StableError> {
    let windows = Window::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list windows: {e}")))?;

    Ok(windows
        .into_iter()
        .filter_map(|w| {
            let id = w.id().ok()?;
            let title = w.title().ok().unwrap_or_default();
            let app_name = w.app_name().ok().unwrap_or_default();
            let width = w.width().ok()?;
            let height = w.height().ok()?;
            let x = w.x().ok()?;
            let y = w.y().ok()?;
            if title.is_empty() || w.is_minimized().ok().unwrap_or(true) {
                return None;
            }
            Some(WindowInfoDto { id, title, app_name, width, height, x, y })
        })
        .collect())
}

#[tauri::command]
pub fn get_desktop_bounds() -> Result<DesktopBoundsDto, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let x = m.x().unwrap_or(0);
        let y = m.y().unwrap_or(0);
        let w = m.width().unwrap_or(0) as i32;
        let h = m.height().unwrap_or(0) as i32;
        if x < min_x { min_x = x; }
        if y < min_y { min_y = y; }
        if x + w > max_x { max_x = x + w; }
        if y + h > max_y { max_y = y + h; }
    }

    Ok(DesktopBoundsDto {
        x: min_x,
        y: min_y,
        width: (max_x - min_x) as u32,
        height: (max_y - min_y) as u32,
    })
}

#[tauri::command]
pub fn capture_screen(monitor_id: u32) -> Result<String, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    let monitor = monitors
        .into_iter()
        .find(|m| m.id().ok() == Some(monitor_id))
        .ok_or_else(|| StableError::new("SCREENSHOT_NOT_FOUND", format!("monitor {monitor_id} not found")))?;

    let img = monitor
        .capture_image()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to capture screen: {e}")))?;

    encode_jpeg_base64(&img, 85)
}

#[tauri::command]
pub fn capture_all_screens() -> Result<String, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    if monitors.is_empty() {
        return Err(StableError::new("SCREENSHOT_CAPTURE", "no monitors found"));
    }

    // Find bounding box
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let x = m.x().unwrap_or(0);
        let y = m.y().unwrap_or(0);
        let w = m.width().unwrap_or(0) as i32;
        let h = m.height().unwrap_or(0) as i32;
        if x < min_x { min_x = x; }
        if y < min_y { min_y = y; }
        if x + w > max_x { max_x = x + w; }
        if y + h > max_y { max_y = y + h; }
    }

    let canvas_w = (max_x - min_x) as u32;
    let canvas_h = (max_y - min_y) as u32;

    // Capture each monitor into its own image (no compositing yet)
    let mut captures: Vec<(i32, i32, RgbaImage)> = Vec::new();
    for m in monitors {
        let mx = m.x().unwrap_or(0);
        let my = m.y().unwrap_or(0);
        let img = m.capture_image()
            .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("capture failed: {e}")))?;
        captures.push((mx, my, img));
    }

    // Composite all captures onto canvas
    let mut canvas = RgbaImage::from_pixel(canvas_w, canvas_h, Rgba([0, 0, 0, 255]));
    for (mx, my, img) in &captures {
        let offset_x = (*mx - min_x) as u32;
        let offset_y = (*my - min_y) as u32;
        for y in 0..img.height().min(canvas_h - offset_y) {
            for x in 0..img.width().min(canvas_w - offset_x) {
                canvas.put_pixel(offset_x + x, offset_y + y, *img.get_pixel(x, y));
            }
        }
    }

    // Use JPEG for speed (quality 85 is fast and visually good enough for selection)
    encode_jpeg_base64(&canvas, 85)
}

#[tauri::command]
pub fn capture_window(window_id: u32) -> Result<String, StableError> {
    let windows = Window::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list windows: {e}")))?;

    let window = windows
        .into_iter()
        .find(|w| w.id().ok() == Some(window_id))
        .ok_or_else(|| StableError::new("SCREENSHOT_NOT_FOUND", format!("window {window_id} not found")))?;

    let img = window
        .capture_image()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to capture window: {e}")))?;

    encode_jpeg_base64(&img, 85)
}

#[tauri::command]
pub fn capture_region(monitor_id: u32, x: u32, y: u32, width: u32, height: u32) -> Result<String, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    let monitor = monitors
        .into_iter()
        .find(|m| m.id().ok() == Some(monitor_id))
        .ok_or_else(|| StableError::new("SCREENSHOT_NOT_FOUND", format!("monitor {monitor_id} not found")))?;

    let img = monitor
        .capture_region(x, y, width, height)
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to capture region: {e}")))?;

    encode_jpeg_base64(&img, 85)
}

#[tauri::command]
pub fn save_screenshot(path: String, data: Vec<u8>) -> Result<String, StableError> {
    let path_buf = std::path::PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            StableError::new("SCREENSHOT_SAVE", format!("failed to create directory: {e}"))
        })?;
    }
    std::fs::write(&path_buf, &data)
        .map_err(|e| StableError::new("SCREENSHOT_SAVE", format!("failed to write file: {e}")))?;
    Ok(path_buf.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn pick_screenshot_directory(app: AppHandle) -> Result<Option<String>, StableError> {
    use tauri_plugin_dialog::DialogExt;
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
pub fn select_region() -> Result<Option<crate::models::RegionSelectionResultDto>, StableError> {
    let monitors = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;

    if monitors.is_empty() {
        return Err(StableError::new("SCREENSHOT_CAPTURE", "no monitors found"));
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let x = m.x().unwrap_or(0);
        let y = m.y().unwrap_or(0);
        let w = m.width().unwrap_or(0) as i32;
        let h = m.height().unwrap_or(0) as i32;
        if x < min_x { min_x = x; }
        if y < min_y { min_y = y; }
        if x + w > max_x { max_x = x + w; }
        if y + h > max_y { max_y = y + h; }
    }

    let canvas_w = (max_x - min_x) as u32;
    let canvas_h = (max_y - min_y) as u32;

    // Collect monitor info (positions) before spawning thread — Monitor isn't Send
    let mut monitor_info: Vec<(i32, i32)> = Vec::new();
    for m in &monitors {
        monitor_info.push((m.x().unwrap_or(0), m.y().unwrap_or(0)));
    }

    // Channel for passing captured image to overlay
    let (img_tx, img_rx) = std::sync::mpsc::channel();

    // Spawn capture in background thread — overlay appears immediately
    std::thread::spawn(move || {
        let mut captures: Vec<(i32, i32, RgbaImage)> = Vec::new();
        for (mx, my) in monitor_info {
            // Re-enumerate monitors in the thread (Monitor isn't Send)
            if let Ok(all) = Monitor::all() {
                for m in all {
                    if m.x().unwrap_or(0) == mx && m.y().unwrap_or(0) == my {
                        if let Ok(img) = m.capture_image() {
                            captures.push((mx, my, img));
                        }
                        break;
                    }
                }
            }
        }

        let mut canvas = RgbaImage::from_pixel(canvas_w, canvas_h, Rgba([0, 0, 0, 255]));
        let canvas_stride = canvas_w as usize * 4;

        for (mx, my, img) in &captures {
            let offset_x = (*mx - min_x) as u32;
            let offset_y = (*my - min_y) as u32;
            let copy_w = img.width().min(canvas_w - offset_x) as usize;
            let copy_h = img.height().min(canvas_h - offset_y) as usize;
            let src_stride = img.width() as usize * 4;

            for row in 0..copy_h {
                let src_start = row * src_stride;
                let dst_start = ((offset_y as usize + row) * canvas_stride) + (offset_x as usize * 4);
                let src_end = src_start + copy_w * 4;
                let dst_end = dst_start + copy_w * 4;
                let buf: &mut [u8] = canvas.as_mut();
                buf[dst_start..dst_end].copy_from_slice(&img.as_raw()[src_start..src_end]);
            }
        }

        let rgba = canvas.into_raw();
        let _ = img_tx.send((rgba, canvas_w, canvas_h));
    });

    // Show overlay immediately — it displays "Capturing..." until image arrives
    let selection = crate::screenshot_overlay::run_selection_overlay(img_rx)
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", e.message))?;

    let Some(sel) = selection else { return Ok(None) };

    // Zero-dimension = clipboard copy or file save (already handled in overlay)
    if sel.width == 0 || sel.height == 0 {
        return Ok(Some(crate::models::RegionSelectionResultDto {
            x: 0, y: 0, width: 0, height: 0,
            image_base64: String::new(),
            image_width: 0,
            image_height: 0,
        }));
    }

    // Re-capture for annotation (fast single-monitor capture, or we could cache)
    // For now, capture all screens again — this is fast since it's a single xcap call
    let monitors2 = Monitor::all()
        .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("failed to list monitors: {e}")))?;
    let mut captures2: Vec<(i32, i32, RgbaImage)> = Vec::new();
    for m in monitors2 {
        let mx = m.x().unwrap_or(0);
        let my = m.y().unwrap_or(0);
        let img = m.capture_image()
            .map_err(|e| StableError::new("SCREENSHOT_CAPTURE", format!("capture failed: {e}")))?;
        captures2.push((mx, my, img));
    }
    let mut canvas2 = RgbaImage::from_pixel(canvas_w, canvas_h, Rgba([0, 0, 0, 255]));
    let canvas_stride2 = canvas_w as usize * 4;
    for (mx, my, img) in &captures2 {
        let offset_x = (*mx - min_x) as u32;
        let offset_y = (*my - min_y) as u32;
        let copy_w = img.width().min(canvas_w - offset_x) as usize;
        let copy_h = img.height().min(canvas_h - offset_y) as usize;
        let src_stride = img.width() as usize * 4;
        for row in 0..copy_h {
            let src_start = row * src_stride;
            let dst_start = ((offset_y as usize + row) * canvas_stride2) + (offset_x as usize * 4);
            let src_end = src_start + copy_w * 4;
            let dst_end = dst_start + copy_w * 4;
            let buf: &mut [u8] = canvas2.as_mut();
            buf[dst_start..dst_end].copy_from_slice(&img.as_raw()[src_start..src_end]);
        }
    }

    let jpeg_base64 = encode_jpeg_base64(&canvas2, 85)?;

    Ok(Some(crate::models::RegionSelectionResultDto {
        x: sel.x,
        y: sel.y,
        width: sel.width,
        height: sel.height,
        image_base64: jpeg_base64,
        image_width: canvas_w,
        image_height: canvas_h,
    }))
}
