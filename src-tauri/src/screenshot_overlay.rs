use std::sync::mpsc;

use eframe::egui;
use image::ImageEncoder;

use crate::error::StableError;

const OVERLAY_ALPHA: u8 = 140;
const SELECTION_COLOR: egui::Color32 = egui::Color32::from_rgb(59, 130, 246);
const HANDLE_SIZE: f32 = 10.0;
const MIN_SELECTION: f32 = 10.0;

#[derive(Debug, Clone)]
pub struct SelectionResult {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, PartialEq)]
enum Handle {
    Nw, N, Ne, E, Se, S, Sw, W,
}

#[derive(Clone, Copy, PartialEq)]
enum DragMode {
    Create,
    Move,
    Resize(Handle),
}

struct DragStart {
    pos: egui::Pos2,
    orig_rect: egui::Rect,
}

enum OverlayImage {
    Loading,
    Ready {
        rgba: Vec<u8>,
        w: u32,
        h: u32,
    },
}

struct SelectionOverlay {
    texture: Option<egui::TextureHandle>,
    image: OverlayImage,
    image_rx: mpsc::Receiver<(Vec<u8>, u32, u32)>,

    selection: Option<egui::Rect>,
    drag_mode: DragMode,
    drag_start: Option<DragStart>,

    img_rect: Option<egui::Rect>,
    img_scale_x: f32,
    img_scale_y: f32,

    tx: mpsc::Sender<Option<SelectionResult>>,
}

impl SelectionOverlay {
    fn new(
        image_rx: mpsc::Receiver<(Vec<u8>, u32, u32)>,
        tx: mpsc::Sender<Option<SelectionResult>>,
    ) -> Self {
        Self {
            texture: None,
            image: OverlayImage::Loading,
            image_rx,
            selection: None,
            drag_mode: DragMode::Create,
            drag_start: None,
            img_rect: None,
            img_scale_x: 1.0,
            img_scale_y: 1.0,
            tx,
        }
    }

    fn mouse_pos(&self, ui: &egui::Ui) -> Option<egui::Pos2> {
        ui.input(|i| i.pointer.hover_pos())
    }

    fn handle_rect(pos: egui::Pos2) -> egui::Rect {
        egui::Rect::from_center_size(pos, egui::vec2(HANDLE_SIZE, HANDLE_SIZE))
    }

    fn handle_cursor(handle: Handle) -> egui::CursorIcon {
        match handle {
            Handle::Nw => egui::CursorIcon::ResizeNwSe,
            Handle::N => egui::CursorIcon::ResizeVertical,
            Handle::Ne => egui::CursorIcon::ResizeNeSw,
            Handle::E => egui::CursorIcon::ResizeHorizontal,
            Handle::Se => egui::CursorIcon::ResizeNwSe,
            Handle::S => egui::CursorIcon::ResizeVertical,
            Handle::Sw => egui::CursorIcon::ResizeNeSw,
            Handle::W => egui::CursorIcon::ResizeHorizontal,
        }
    }

    fn hit_handle(&self, pos: egui::Pos2) -> Option<Handle> {
        let r = self.selection?;
        let handles: [(Handle, egui::Pos2); 8] = [
            (Handle::Nw, r.left_top()),
            (Handle::N, r.center_top()),
            (Handle::Ne, r.right_top()),
            (Handle::E, r.right_center()),
            (Handle::Se, r.right_bottom()),
            (Handle::S, r.center_bottom()),
            (Handle::Sw, r.left_bottom()),
            (Handle::W, r.left_center()),
        ];
        for (h, p) in handles {
            if Self::handle_rect(p).contains(pos) {
                return Some(h);
            }
        }
        None
    }

    fn apply_resize(rect: egui::Rect, handle: Handle, delta: egui::Vec2) -> egui::Rect {
        let mut r = rect;
        match handle {
            Handle::Nw => { r.min.x += delta.x; r.min.y += delta.y; }
            Handle::N => { r.min.y += delta.y; }
            Handle::Ne => { r.max.x += delta.x; r.min.y += delta.y; }
            Handle::E => { r.max.x += delta.x; }
            Handle::Se => { r.max.x += delta.x; r.max.y += delta.y; }
            Handle::S => { r.max.y += delta.y; }
            Handle::Sw => { r.min.x += delta.x; r.max.y += delta.y; }
            Handle::W => { r.min.x += delta.x; }
        }
        if r.width() < MIN_SELECTION {
            if matches!(handle, Handle::Nw | Handle::Sw | Handle::W) {
                r.min.x = r.max.x - MIN_SELECTION;
            } else {
                r.max.x = r.min.x + MIN_SELECTION;
            }
        }
        if r.height() < MIN_SELECTION {
            if matches!(handle, Handle::Nw | Handle::Ne | Handle::N) {
                r.min.y = r.max.y - MIN_SELECTION;
            } else {
                r.max.y = r.min.y + MIN_SELECTION;
            }
        }
        r
    }

    fn selection_to_physical(&self, rect: egui::Rect) -> SelectionResult {
        let r = self.img_rect.unwrap_or(egui::Rect::ZERO);
        let x = ((rect.min.x - r.min.x) * self.img_scale_x).round().max(0.0) as u32;
        let y = ((rect.min.y - r.min.y) * self.img_scale_y).round().max(0.0) as u32;
        let w = (rect.width() * self.img_scale_x).round().max(1.0) as u32;
        let h = (rect.height() * self.img_scale_y).round().max(1.0) as u32;
        SelectionResult { x, y, width: w, height: h }
    }

    fn confirm(&self, ctx: &egui::Context) {
        if let Some(sel) = self.selection {
            let result = self.selection_to_physical(sel);
            let _ = self.tx.send(Some(result));
        }
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }

    fn cancel(&self, ctx: &egui::Context) {
        let _ = self.tx.send(None);
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }

    fn image_rgba(&self) -> Option<&[u8]> {
        match &self.image {
            OverlayImage::Ready { rgba, .. } => Some(rgba),
            _ => None,
        }
    }

    fn image_dims(&self) -> Option<(u32, u32)> {
        match &self.image {
            OverlayImage::Ready { w, h, .. } => Some((*w, *h)),
            _ => None,
        }
    }

    fn crop_rgba(&self, rect: egui::Rect) -> Option<(Vec<u8>, u32, u32)> {
        let r = self.img_rect?;
        let rgba = self.image_rgba()?;
        let (img_w, _) = self.image_dims()?;
        let sx = self.img_scale_x;
        let sy = self.img_scale_y;

        let x = ((rect.min.x - r.min.x) * sx).round().max(0.0) as u32;
        let y = ((rect.min.y - r.min.y) * sy).round().max(0.0) as u32;
        let w = (rect.width() * sx).round().max(1.0) as u32;
        let h = (rect.height() * sy).round().max(1.0) as u32;

        let mut cropped = Vec::with_capacity((w * h * 4) as usize);
        let stride = img_w as usize * 4;
        let w_bytes = w as usize * 4;
        for row in 0..h as usize {
            let src_start = (y as usize + row) * stride + x as usize * 4;
            let src_end = src_start + w_bytes;
            if src_end <= rgba.len() {
                cropped.extend_from_slice(&rgba[src_start..src_end]);
            }
        }
        Some((cropped, w, h))
    }

    fn copy_selection(&self, rect: egui::Rect, ctx: &egui::Context) {
        let crop = self.crop_rgba(rect);
        match crop {
            Some((rgba, w, h)) => {
                // Keep clipboard context alive — dropping it calls CloseClipboard() on Windows
                // which must happen BEFORE we close the viewport
                match arboard::Clipboard::new() {
                    Ok(mut clipboard) => {
                        match clipboard.set_image(arboard::ImageData {
                            width: w as usize,
                            height: h as usize,
                            bytes: rgba.into(),
                        }) {
                            Ok(()) => eprintln!("[screenshot] copied {w}x{h} to clipboard"),
                            Err(e) => eprintln!("[screenshot] clipboard set_image failed: {e}"),
                        }
                        // Explicit drop to flush clipboard before closing viewport
                        drop(clipboard);
                    }
                    Err(e) => eprintln!("[screenshot] clipboard open failed: {e}"),
                }
            }
            None => eprintln!("[screenshot] crop_rgba returned None — image not loaded?"),
        }
        let _ = self.tx.send(Some(SelectionResult { x: 0, y: 0, width: 0, height: 0 }));
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }

    fn save_selection(&self, rect: egui::Rect, ctx: &egui::Context) {
        if let Some((rgba, w, h)) = self.crop_rgba(rect) {
            let mut png_buf = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new(&mut png_buf);
            if let Some(img) = image::RgbaImage::from_raw(w, h, rgba) {
                let _ = encoder.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8);
            }
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let filename = format!("screenshot-{}.png", timestamp);
            let dir = std::env::var("USERPROFILE")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("Pictures");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join(filename);
            match std::fs::write(&path, &png_buf) {
                Ok(()) => {
                    eprintln!("[screenshot] saved to {}", path.display());
                    let _ = self.tx.send(Some(SelectionResult { x: 0, y: 0, width: 0, height: 0 }));
                }
                Err(e) => {
                    eprintln!("[screenshot] save failed: {e}");
                }
            }
        }
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }
}

impl eframe::App for SelectionOverlay {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        // Check if image arrived from background capture
        if matches!(self.image, OverlayImage::Loading) {
            if let Ok((rgba, w, h)) = self.image_rx.try_recv() {
                let color_image = egui::ColorImage::from_rgba_unmultiplied(
                    [w as usize, h as usize],
                    &rgba,
                );
                let tex = ctx.load_texture(
                    "screenshot",
                    color_image,
                    egui::TextureOptions {
                        magnification: egui::TextureFilter::Linear,
                        minification: egui::TextureFilter::Linear,
                        ..Default::default()
                    },
                );
                self.texture = Some(tex);

                let rect = ui.max_rect();
                self.img_rect = Some(rect);
                self.img_scale_x = w as f32 / rect.width();
                self.img_scale_y = h as f32 / rect.height();

                self.image = OverlayImage::Ready { rgba, w, h };
                ctx.request_repaint();
            }
        }

        let img_rect = self.img_rect.unwrap_or(ui.max_rect());

        // Draw background
        if let Some(tex) = &self.texture {
            ui.painter().image(
                tex.id(),
                img_rect,
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1.0, 1.0)),
                egui::Color32::WHITE,
            );
        } else {
            ui.painter().rect_filled(img_rect, 0.0, egui::Color32::from_rgb(20, 20, 20));
        }

        // Dark overlay
        ui.painter().rect_filled(
            img_rect,
            0.0,
            egui::Color32::from_rgba_unmultiplied(0, 0, 0, OVERLAY_ALPHA),
        );

        // Draw selection area
        if let (Some(tex), Some(sel)) = (&self.texture, self.selection) {
            if sel.width() > 1.0 && sel.height() > 1.0 {
                let uv_min = egui::pos2(
                    (sel.min.x - img_rect.min.x) / img_rect.width(),
                    (sel.min.y - img_rect.min.y) / img_rect.height(),
                );
                let uv_max = egui::pos2(
                    (sel.max.x - img_rect.min.x) / img_rect.width(),
                    (sel.max.y - img_rect.min.y) / img_rect.height(),
                );
                ui.painter().image(
                    tex.id(),
                    sel,
                    egui::Rect::from_min_max(uv_min, uv_max),
                    egui::Color32::WHITE,
                );

                ui.painter().rect_stroke(
                    sel, 0.0,
                    egui::Stroke::new(2.0, SELECTION_COLOR),
                    egui::StrokeKind::Inside,
                );

                let handles = [
                    egui::pos2(sel.min.x, sel.min.y),
                    egui::pos2(sel.center().x, sel.min.y),
                    egui::pos2(sel.max.x, sel.min.y),
                    egui::pos2(sel.max.x, sel.center().y),
                    egui::pos2(sel.max.x, sel.max.y),
                    egui::pos2(sel.center().x, sel.max.y),
                    egui::pos2(sel.min.x, sel.max.y),
                    egui::pos2(sel.min.x, sel.center().y),
                ];
                for pos in handles {
                    ui.painter().rect_filled(Self::handle_rect(pos), 2.0, SELECTION_COLOR);
                    ui.painter().rect_stroke(
                        Self::handle_rect(pos), 2.0,
                        egui::Stroke::new(1.5, egui::Color32::WHITE),
                        egui::StrokeKind::Inside,
                    );
                }
            }
        }

        // Hint text
        let loading = matches!(self.image, OverlayImage::Loading);
        let hint = if loading {
            "Capturing screen..."
        } else if self.selection.is_some() {
            "Enter: annotate  |  Ctrl+C: copy  |  Ctrl+S: save  |  Esc: cancel"
        } else {
            "Drag to select a region  |  Esc to cancel"
        };
        let galley = ctx.fonts_mut(|f| {
            f.layout_no_wrap(
                hint.to_owned(),
                egui::FontId::proportional(14.0),
                egui::Color32::from_rgba_unmultiplied(220, 220, 220, 230),
            )
        });
        let text_rect = galley.rect;
        let text_pos = egui::pos2(
            img_rect.min.x + (img_rect.width() - text_rect.width()) / 2.0,
            img_rect.max.y - 30.0,
        );
        let bg_rect = egui::Rect::from_min_size(
            text_pos - egui::vec2(12.0, 6.0),
            text_rect.size() + egui::vec2(24.0, 12.0),
        );
        ui.painter().rect_filled(
            bg_rect, 8.0,
            egui::Color32::from_rgba_unmultiplied(30, 30, 30, 200),
        );
        ui.painter().galley(text_pos, galley, egui::Color32::TRANSPARENT);

        // Block input while loading
        if loading {
            ctx.request_repaint();
            return;
        }

        // --- Input handling ---
        let mut input = ui.input(|i| i.clone());

        if input.consume_key(egui::Modifiers::NONE, egui::Key::Escape) {
            self.cancel(&ctx);
            return;
        }
        if input.consume_key(egui::Modifiers::NONE, egui::Key::Enter) && self.selection.is_some() {
            self.confirm(&ctx);
            return;
        }
        if input.consume_key(egui::Modifiers::CTRL, egui::Key::C) {
            if let Some(sel) = self.selection {
                eprintln!("[screenshot] Ctrl+C detected, copying selection...");
                self.copy_selection(sel, &ctx);
                return;
            } else {
                eprintln!("[screenshot] Ctrl+C pressed but no selection");
            }
        }
        if input.consume_key(egui::Modifiers::CTRL, egui::Key::S) {
            if let Some(sel) = self.selection {
                eprintln!("[screenshot] Ctrl+S detected, saving selection...");
                self.save_selection(sel, &ctx);
                return;
            }
        }

        let Some(mouse_pos) = self.mouse_pos(ui) else { return };
        let pointer = &input.pointer;

        // Cursor icon
        if self.drag_start.is_some() {
            match self.drag_mode {
                DragMode::Create => ctx.set_cursor_icon(egui::CursorIcon::Crosshair),
                DragMode::Move => ctx.set_cursor_icon(egui::CursorIcon::Grabbing),
                DragMode::Resize(h) => ctx.set_cursor_icon(Self::handle_cursor(h)),
            }
        } else if let Some(sel) = self.selection {
            if let Some(handle) = self.hit_handle(mouse_pos) {
                ctx.set_cursor_icon(Self::handle_cursor(handle));
            } else if sel.contains(mouse_pos) {
                ctx.set_cursor_icon(egui::CursorIcon::PointingHand);
            } else {
                ctx.set_cursor_icon(egui::CursorIcon::Crosshair);
            }
        } else {
            ctx.set_cursor_icon(egui::CursorIcon::Crosshair);
        }

        // 1. Press
        if pointer.any_pressed() {
            if let Some(sel) = self.selection {
                if let Some(handle) = self.hit_handle(mouse_pos) {
                    self.drag_mode = DragMode::Resize(handle);
                    self.drag_start = Some(DragStart { pos: mouse_pos, orig_rect: sel });
                    return;
                }
                if sel.contains(mouse_pos) {
                    self.drag_mode = DragMode::Move;
                    self.drag_start = Some(DragStart { pos: mouse_pos, orig_rect: sel });
                    return;
                }
            }
            self.drag_mode = DragMode::Create;
            self.drag_start = Some(DragStart {
                pos: mouse_pos,
                orig_rect: egui::Rect::from_min_max(mouse_pos, mouse_pos),
            });
            self.selection = Some(egui::Rect::from_min_max(mouse_pos, mouse_pos));
            return;
        }

        // 2. Drag
        if pointer.any_down() {
            if let Some(drag) = &self.drag_start {
                match self.drag_mode {
                    DragMode::Create => {
                        self.selection = Some(egui::Rect::from_min_max(
                            drag.pos.min(mouse_pos),
                            drag.pos.max(mouse_pos),
                        ));
                    }
                    DragMode::Move => {
                        let delta = mouse_pos - drag.pos;
                        self.selection = Some(drag.orig_rect.translate(delta));
                    }
                    DragMode::Resize(handle) => {
                        let delta = mouse_pos - drag.pos;
                        self.selection = Some(Self::apply_resize(drag.orig_rect, handle, delta));
                    }
                }
            }
            return;
        }

        // 3. Release
        if pointer.any_released() {
            if let Some(sel) = self.selection {
                if matches!(self.drag_mode, DragMode::Create)
                    && (sel.width() < MIN_SELECTION || sel.height() < MIN_SELECTION)
                {
                    self.selection = None;
                } else {
                    self.selection = Some(egui::Rect::from_min_max(
                        egui::pos2(sel.min.x.round(), sel.min.y.round()),
                        egui::pos2(sel.max.x.round(), sel.max.y.round()),
                    ));
                }
            }
            self.drag_start = None;
        }
    }
}

pub fn run_selection_overlay(
    image_rx: mpsc::Receiver<(Vec<u8>, u32, u32)>,
) -> Result<Option<SelectionResult>, StableError> {
    let (tx, rx) = mpsc::channel();

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Screenshot Selection")
            .with_decorations(false)
            .with_always_on_top()
            .with_transparent(true)
            .with_resizable(false)
            .with_taskbar(false)
            .with_fullscreen(true),
        run_and_return: true,
        ..Default::default()
    };

    let result = eframe::run_native(
        "Screenshot Selection",
        options,
        Box::new(move |cc| {
            cc.egui_ctx.global_style_mut(|s| {
                s.visuals.window_fill = egui::Color32::TRANSPARENT;
            });
            Ok(Box::new(SelectionOverlay::new(image_rx, tx)))
        }),
    );

    if let Err(e) = result {
        return Err(StableError::new("EGUI_FAILED", format!("egui window failed: {e}")));
    }

    match rx.try_recv() {
        Ok(r) => Ok(r),
        Err(_) => Ok(None),
    }
}
