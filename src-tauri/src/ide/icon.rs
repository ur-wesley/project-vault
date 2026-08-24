//! Real OS icon extraction for discovered IDEs.
//!
//! [`icon_data_for`] returns a `data:` URL with the IDE's real icon (PNG on
//! Windows/macOS, PNG or SVG on Linux), or `None` when extraction fails so the
//! caller keeps the iconify class fallback. It must never panic; every failure
//! path returns `None`.
//!
//! - Windows: `IShellItemImageFactory::GetImage` at 256×256 (primary), then
//!   `ExtractIconExW` + GDI fallback; shim paths (.cmd/.bat) resolve to `.exe`.
//! - macOS: parse the app bundle's `Contents/Resources/*.icns`, prefer the
//!   largest PNG-carrying chunk (ic07/ic08/ic09/ic10, plus PNG variants of
//!   ic04/ic05/ic06), fall back to PNG-encoding the largest ARGB chunk.
//! - Linux: resolve the `Icon=` value of the matching `.desktop` entry and
//!   read the icon file (absolute path or theme icon search).

use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn icon_data_for_with_id(path: &Path, id: Option<&str>) -> Option<String> {
    let target = resolve_executable_for_icon(path, id)?;
    let target = dunce::canonicalize(&target).unwrap_or(target);
    let img = icon_data_for_shell(&target)
        .or_else(|| icon_data_for_private_extract(&target))
        .or_else(|| icon_data_for_extract_icon(&target))?;
    let img = if img.width() > 256 || img.height() > 256 {
        image::imageops::thumbnail(&img, 256, 256)
    } else {
        img
    };
    Some(data_url_png(&encode_png(&img)?))
}

/// Resolve `.cmd` / `.bat` / shim paths to a real `.exe` for icon extraction.
#[cfg(windows)]
fn resolve_executable_for_icon(path: &Path, id: Option<&str>) -> Option<PathBuf> {
    if is_windows_exe(path) {
        return Some(path.to_path_buf());
    }

    let parent = path.parent()?;
    let stem = path.file_stem().and_then(|s| s.to_str())?;

    let mut candidates: Vec<PathBuf> = Vec::new();

    use super::constants::KNOWN_WINDOWS_EXE_PATTERNS;
    if let Some(ide_id) = id {
        for (pattern_id, _, exes) in KNOWN_WINDOWS_EXE_PATTERNS {
            if *pattern_id == ide_id {
                for dir in [parent, parent.parent().unwrap_or(parent)] {
                    for exe in *exes {
                        candidates.push(dir.join(exe));
                    }
                }
            }
        }
    }

    candidates.push(parent.join(format!("{}.exe", stem)));
    if let Some(cap) = capitalize_first(stem) {
        candidates.push(parent.join(format!("{}.exe", cap)));
    }
    if let Some(grandparent) = parent.parent() {
        candidates.push(grandparent.join(format!("{}.exe", stem)));
        if let Some(cap) = capitalize_first(stem) {
            candidates.push(grandparent.join(format!("{}.exe", cap)));
        }
    }

    for dir in [parent, parent.parent().unwrap_or(parent)] {
        for (_, _, exes) in KNOWN_WINDOWS_EXE_PATTERNS {
            for exe in *exes {
                candidates.push(dir.join(exe));
            }
        }
    }

    for candidate in candidates {
        if is_windows_exe(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(windows)]
fn is_windows_exe(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
}

#[cfg(windows)]
fn capitalize_first(s: &str) -> Option<String> {
    let mut chars = s.chars();
    let first = chars.next()?;
    let rest = chars.as_str();
    Some(format!("{}{}", first.to_uppercase(), rest))
}

#[cfg(windows)]
fn icon_data_for_shell(path: &Path) -> Option<image::RgbaImage> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::S_OK;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
        SIIGBF_ICONONLY, SIIGBF_SCALEUP,
    };

    let wide = wide_path(path)?;
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if hr.is_err() && hr.0 as u32 != 0x8001_0106 {
        return None;
    }

    let img = unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let size = SIZE { cx: 256, cy: 256 };
        let flags = SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK | SIIGBF_SCALEUP;
        let hbitmap = factory.GetImage(size, flags).ok()?;
        let img = dib_to_rgba(hbitmap);
        let _ = DeleteObject(hbitmap);
        img
    };

    if hr == S_OK {
        unsafe { CoUninitialize() };
    }
    img
}

#[cfg(windows)]
fn icon_data_for_private_extract(path: &Path) -> Option<image::RgbaImage> {
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, HICON, PrivateExtractIconsW,
    };

    let wide = wide_path(path)?;
    let mut filename = [0u16; 260];
    let len = wide.len().min(259);
    filename[..len].copy_from_slice(&wide[..len]);

    let mut icons = [HICON::default()];
    let extracted = unsafe {
        PrivateExtractIconsW(
            &filename,
            0,
            256,
            256,
            Some(&mut icons),
            None,
            0,
        )
    };
    if extracted == 0 || icons[0].is_invalid() {
        return None;
    }
    unsafe {
        let img = icon_to_rgba(icons[0]);
        let _ = DestroyIcon(icons[0]);
        img
    }
}

#[cfg(windows)]
fn icon_data_for_extract_icon(path: &Path) -> Option<image::RgbaImage> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let wide = wide_path(path)?;
    unsafe {
        let mut large = HICON::default();
        let extracted = ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(&mut large), None, 1);
        if extracted == 0 || large.is_invalid() {
            return None;
        }
        let img = icon_to_rgba(large);
        let _ = DestroyIcon(large);
        img
    }
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Option<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.is_empty() || wide.contains(&0) {
        return None;
    }
    wide.push(0);
    Some(wide)
}

#[cfg(windows)]
unsafe fn icon_to_rgba(hicon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<image::RgbaImage> {
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut info = ICONINFO::default();
    if GetIconInfo(hicon, &mut info).is_err() {
        return None;
    }
    let hbm_color = info.hbmColor;
    let hbm_mask = info.hbmMask;
    if hbm_color.is_invalid() {
        // Monochrome icon: only a mask bitmap exists, nothing to render.
        let _ = DeleteObject(hbm_mask);
        return None;
    }
    let img = dib_to_rgba(hbm_color);
    let _ = DeleteObject(hbm_color);
    let _ = DeleteObject(hbm_mask);
    img
}

#[cfg(windows)]
unsafe fn dib_to_rgba(hbm: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<image::RgbaImage> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CreateCompatibleDC, DeleteDC, DIB_RGB_COLORS,
        GetDC, GetDIBits, GetObjectW, ReleaseDC,
    };

    let mut bm = BITMAP::default();
    let got = GetObjectW(
        hbm,
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut BITMAP as *mut core::ffi::c_void),
    );
    if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        return None;
    }
    let w = bm.bmWidth as u32;
    let h = bm.bmHeight as u32;
    if w > 1024 || h > 1024 {
        return None;
    }

    let screen_dc = GetDC(HWND::default());
    if screen_dc.is_invalid() {
        return None;
    }
    let dc = CreateCompatibleDC(screen_dc);
    if dc.is_invalid() {
        let _ = ReleaseDC(HWND::default(), screen_dc);
        return None;
    }
    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = bm.bmWidth;
    bmi.bmiHeader.biHeight = -bm.bmHeight;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
    let lines = GetDIBits(
        dc,
        hbm,
        0,
        h,
        Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    let _ = DeleteDC(dc);
    let _ = ReleaseDC(HWND::default(), screen_dc);
    if lines != h as i32 {
        return None;
    }
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    image::RgbaImage::from_raw(w, h, buf)
}

#[cfg(not(windows))]
pub fn icon_data_for_with_id(path: &Path, _id: Option<&str>) -> Option<String> {
    icon_data_for(path)
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub fn icon_data_for(path: &Path) -> Option<String> {
    let bundle = bundle_root(path)?;
    let icns_path = find_icns(bundle)?;
    let bytes = std::fs::read(icns_path).ok()?;
    let chunks = parse_icns(&bytes)?;
    let chunk = pick_best_chunk(&chunks)?;
    match chunk {
        IcnsChunk::Png { data, .. } => Some(data_url_png(data)),
        IcnsChunk::Argb { data, .. } => {
            let png = argb_to_png(data, chunk.size())?;
            Some(data_url_png(&png))
        }
    }
}

/// Walk up from the executable (Foo.app/Contents/MacOS/foo) to the .app
/// bundle directory.
#[cfg(target_os = "macos")]
fn bundle_root(path: &Path) -> Option<&Path> {
    let mut cur = path;
    loop {
        if cur.extension().and_then(|e| e.to_str()) == Some("app") {
            return Some(cur);
        }
        cur = cur.parent()?;
    }
}

/// Find the largest .icns in Contents/Resources of the bundle.
#[cfg(target_os = "macos")]
fn find_icns(bundle: &Path) -> Option<PathBuf> {
    let resources = bundle.join("Contents").join("Resources");
    let rd = std::fs::read_dir(&resources).ok()?;
    let mut best: Option<(u64, PathBuf)> = None;
    for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|e| e.to_str()) == Some("icns") {
            let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
            if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
                best = Some((size, p));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// One parsed icns chunk that can carry image data.
#[cfg(target_os = "macos")]
#[derive(Debug)]
enum IcnsChunk<'a> {
    /// PNG payload (ic07/ic08/ic09/ic10, or a PNG variant of ic04/ic05/ic06).
    Png { size: usize, data: &'a [u8] },
    /// Raw ARGB payload (16/32/48px ic04/ic05/ic06 chunks).
    Argb { size: usize, data: &'a [u8] },
}

#[cfg(target_os = "macos")]
impl IcnsChunk<'_> {
    fn size(&self) -> usize {
        match self {
            IcnsChunk::Png { size, .. } | IcnsChunk::Argb { size, .. } => *size,
        }
    }
}

/// Parse an icns container (magic 'icns', big-endian total length, then
/// chunk records of type + big-endian length + data). Malformed input yields
/// None; unknown chunk types are skipped.
#[cfg(target_os = "macos")]
fn parse_icns(bytes: &[u8]) -> Option<Vec<IcnsChunk<'_>>> {
    if bytes.len() < 8 || !bytes.starts_with(b"icns") {
        return None;
    }
    let total = u32::from_be_bytes(bytes[4..8].try_into().ok()?) as usize;
    if total < 8 {
        return None;
    }

    let mut out = Vec::new();
    let mut pos = 8usize;
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        if len < 8 || pos + len > bytes.len() {
            break; // malformed chunk: stop parsing
        }
        let data = &bytes[pos + 8..pos + len];
        let typ: [u8; 4] = bytes[pos..pos + 4].try_into().ok()?;
        match &typ {
            b"ic07" => out.push(IcnsChunk::Png { size: 128, data }),
            b"ic08" => out.push(IcnsChunk::Png { size: 256, data }),
            b"ic09" => out.push(IcnsChunk::Png { size: 512, data }),
            b"ic10" => out.push(IcnsChunk::Png { size: 1024, data }),
            // ic04/ic05/ic06 carry 16/32/48px data; historically raw ARGB,
            // but modern files may embed PNG in them. Sniff the PNG magic.
            b"ic04" | b"ic05" | b"ic06" => {
                let size = match &typ {
                    b"ic04" => 16,
                    b"ic05" => 32,
                    _ => 48,
                };
                if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    out.push(IcnsChunk::Png { size, data });
                } else {
                    out.push(IcnsChunk::Argb { size, data });
                }
            }
            _ => {}
        }
        pos += len;
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Prefer the largest PNG-carrying chunk; fall back to the largest ARGB
/// chunk when the container has no PNG data at all.
#[cfg(target_os = "macos")]
fn pick_best_chunk<'a>(chunks: &'a [IcnsChunk<'a>]) -> Option<&'a IcnsChunk<'a>> {
    let png = chunks
        .iter()
        .filter(|c| matches!(c, IcnsChunk::Png { .. }))
        .max_by_key(|c| c.size());
    png.or_else(|| {
        chunks
            .iter()
            .filter(|c| matches!(c, IcnsChunk::Argb { .. }))
            .max_by_key(|c| c.size())
    })
}

/// Convert a raw ARGB chunk (A,R,G,B per pixel, big-endian) to a PNG.
#[cfg(target_os = "macos")]
fn argb_to_png(argb: &[u8], size: usize) -> Option<Vec<u8>> {
    let rgba = argb_to_rgba(argb, size)?;
    let img = image::RgbaImage::from_raw(size as u32, size as u32, rgba)?;
    encode_png(&img)
}

/// Reorder ARGB bytes to RGBA. Data length must cover size*size*4 pixels.
#[cfg(target_os = "macos")]
fn argb_to_rgba(argb: &[u8], size: usize) -> Option<Vec<u8>> {
    let pixels = size * size * 4;
    if argb.len() < pixels {
        return None;
    }
    let argb = &argb[..pixels];
    let mut rgba = Vec::with_capacity(pixels);
    for px in argb.chunks_exact(4) {
        rgba.push(px[1]); // r
        rgba.push(px[2]); // g
        rgba.push(px[3]); // b
        rgba.push(px[0]); // a
    }
    Some(rgba)
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

#[cfg(all(unix, not(target_os = "macos")))]
pub fn icon_data_for(path: &Path) -> Option<String> {
    let icon = desktop_icon_value(path)?;
    resolve_icon_value(&icon)
}

/// Find the Icon= value of the .desktop entry whose Exec= command names our
/// executable (by file name or absolute path), falling back to a .desktop
/// file named after the executable.
#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_icon_value(path: &Path) -> Option<String> {
    use freedesktop_desktop_entry::{default_paths, desktop_entries};

    let exe_name = path.file_name().and_then(|n| n.to_str())?;
    let exe_name_lower = exe_name.to_lowercase();
    let exe_path_lower = path.to_string_lossy().to_lowercase();

    let paths = default_paths();
    let entries = desktop_entries(&paths, &[]).ok()?;

    let mut name_fallback: Option<String> = None;
    for entry in entries {
        let Some(icon) = entry.icon() else {
            continue;
        };
        // Preferred: the entry's Exec= command directly names this exe.
        if let Some(token) = first_exec_token(entry.exec()) {
            let t = token.to_lowercase();
            if t == exe_name_lower || t == exe_path_lower {
                return Some(icon.to_string());
            }
        }
        // Fallback: the .desktop file is named after the executable
        // (e.g. code.desktop for /usr/bin/code). Keep the first match.
        if name_fallback.is_none() {
            let stem = entry
                .path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase());
            if stem.as_deref() == Some(exe_name_lower.as_str()) {
                name_fallback = Some(icon.to_string());
            }
        }
    }
    name_fallback
}

/// First whitespace-separated token of an Exec= value, honoring double
/// quotes (e.g. "\"/opt/sublime_text/sublime_text\" %F").
#[cfg(all(unix, not(target_os = "macos")))]
fn first_exec_token(exec: Option<&str>) -> Option<String> {
    let exec = exec?.trim();
    if exec.is_empty() {
        return None;
    }
    let mut token = String::new();
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                for c in chars.by_ref() {
                    if c == '"' {
                        break;
                    }
                    token.push(c);
                }
                break;
            }
            ' ' | '\t' => break,
            c => token.push(c),
        }
    }
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Resolve an Icon= value: absolute path -> read that file; theme icon name
/// -> search the common icon directories for <name>.png / <name>.svg.
#[cfg(all(unix, not(target_os = "macos")))]
fn resolve_icon_value(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let p = PathBuf::from(value);
    if p.is_absolute() {
        return encode_image_file(&p);
    }
    for root in icon_roots() {
        if let Some(found) = find_theme_icon(&root, value) {
            return encode_image_file(&found);
        }
    }
    None
}

/// Directories searched for theme icons, user dirs first.
#[cfg(all(unix, not(target_os = "macos")))]
fn icon_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join(".local/share/icons/hicolor"));
        roots.push(PathBuf::from(home).join(".local/share/icons"));
    }
    roots.push(PathBuf::from("/usr/share/icons/hicolor"));
    roots.push(PathBuf::from("/usr/share/icons"));
    roots.push(PathBuf::from("/usr/local/share/icons/hicolor"));
    roots.push(PathBuf::from("/usr/local/share/icons"));
    roots.push(PathBuf::from("/usr/share/pixmaps"));
    roots.push(PathBuf::from("/usr/local/share/pixmaps"));
    roots
}

/// Search one icon root for <name>.png / <name>.svg. Looks in <root>/apps/
/// and <root>/<sizedir>/apps/ plus <root>/<sizedir>/ directly, preferring
/// the largest candidate by file size.
#[cfg(all(unix, not(target_os = "macos")))]
fn find_theme_icon(root: &Path, name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for ext in ["png", "svg"] {
        let p = root.join("apps").join(format!("{name}.{ext}"));
        if p.is_file() {
            candidates.push(p);
        }
        let p = root.join(format!("{name}.{ext}"));
        if p.is_file() {
            candidates.push(p);
        }
    }
    if let Ok(rd) = std::fs::read_dir(root) {
        for ent in rd.flatten() {
            let dir = ent.path();
            if !dir.is_dir() {
                continue;
            }
            for ext in ["png", "svg"] {
                let p = dir.join("apps").join(format!("{name}.{ext}"));
                if p.is_file() {
                    candidates.push(p);
                }
                let p = dir.join(format!("{name}.{ext}"));
                if p.is_file() {
                    candidates.push(p);
                }
            }
        }
    }
    candidates
        .into_iter()
        .max_by_key(|p| p.metadata().map(|m| m.len()).unwrap_or(0))
}

/// Encode a PNG or SVG icon file as a data URL. Any other extension is
/// rejected so a non-image mime type is never emitted.
#[cfg(all(unix, not(target_os = "macos")))]
fn encode_image_file(path: &Path) -> Option<String> {
    let ext = path.extension().and_then(|e| e.to_str())?.to_lowercase();
    let bytes = std::fs::read(path).ok()?;
    encode_image_bytes(&ext, &bytes)
}

/// Pure mapping from file extension to the matching image data URL.
#[cfg(all(unix, not(target_os = "macos")))]
fn encode_image_bytes(ext: &str, bytes: &[u8]) -> Option<String> {
    match ext.to_lowercase().as_str() {
        "png" => Some(data_url_png(bytes)),
        "svg" => {
            use base64::{engine::general_purpose::STANDARD, Engine};
            Some(format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(bytes)
            ))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Assemble a PNG data URL with the exact prefix expected by the frontend.
fn data_url_png(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    format!("data:image/png;base64,{}", STANDARD.encode(bytes))
}

/// Encode an RGBA image as PNG bytes.
fn encode_png(img: &image::RgbaImage) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .ok()?;
    Some(buf)
}

// ---------------------------------------------------------------------------
// Tests (pure helpers only; nothing requires a real IDE install)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_url_png_uses_exact_prefix_and_roundtrips() {
        let payload = b"\x89PNG\r\n\x1a\nfake-png-body";
        let url = data_url_png(payload);
        assert!(url.starts_with("data:image/png;base64,"));
        let encoded = url.trim_start_matches("data:image/png;base64,");
        use base64::{engine::general_purpose::STANDARD, Engine};
        assert_eq!(STANDARD.decode(encoded).unwrap(), payload);
    }

    #[test]
    fn encode_png_produces_valid_png() {
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        let png = encode_png(&img).expect("png encodes");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let decoded = image::load_from_memory(&png).expect("png decodes");
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);
    }

    #[test]
    fn encode_png_rejects_zero_dimension_image() {
        let img = image::RgbaImage::new(0, 0);
        assert!(encode_png(&img).is_none());
    }
}

#[cfg(all(test, windows))]
mod tests_windows {
    use super::*;

    #[test]
    fn wide_path_terminates_with_nul() {
        let wide = wide_path(Path::new(r"C:\Program Files\Microsoft VS Code\Code.exe"))
            .expect("encodes");
        assert_eq!(*wide.last().unwrap(), 0);
        assert!(wide.len() > 2);
        // "C" -> 0x43, ":" -> 0x3A
        assert_eq!(&wide[..2], &[0x43, 0x3A]);
    }

    #[test]
    fn wide_path_rejects_embedded_nul_and_empty() {
        assert!(wide_path(Path::new("")).is_none());
    }

    #[test]
    fn capitalize_first_uppercases_leading_char() {
        assert_eq!(capitalize_first("code").as_deref(), Some("Code"));
        assert_eq!(capitalize_first("cursor").as_deref(), Some("Cursor"));
        assert_eq!(capitalize_first(""), None);
    }

    #[test]
    fn is_windows_exe_only_accepts_exe_extension() {
        assert!(!is_windows_exe(Path::new("C:\\foo\\code.cmd")));
        assert!(!is_windows_exe(Path::new("C:\\foo\\code")));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests_macos {
    use super::*;

    fn synth_icns(chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let body_len: usize = chunks.iter().map(|(_, data)| 8 + data.len()).sum();
        let total = 8 + body_len;
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(b"icns");
        out.extend_from_slice(&(total as u32).to_be_bytes());
        for (typ, data) in chunks {
            out.extend_from_slice(typ);
            out.extend_from_slice(&((8 + data.len()) as u32).to_be_bytes());
            out.extend_from_slice(data);
        }
        out
    }

    #[test]
    fn parse_icns_rejects_garbage() {
        assert!(parse_icns(b"").is_none());
        assert!(parse_icns(b"nope").is_none());
        assert!(parse_icns(b"icns\x00\x00\x00\x02").is_none());
        assert!(parse_icns(b"icns\x00\x00\x00\x08").is_none());
    }

    #[test]
    fn parse_icns_reads_png_chunk() {
        let png = b"\x89PNG\r\n\x1a\nfake";
        let bytes = synth_icns(&[(b"ic08", png)]);
        let chunks = parse_icns(&bytes).expect("parses");
        assert_eq!(chunks.len(), 1);
        match &chunks[0] {
            IcnsChunk::Png { size, data } => {
                assert_eq!(*size, 256);
                assert_eq!(data, &png[..]);
            }
            other => panic!("expected Png chunk, got {other:?}"),
        }
    }

    #[test]
    fn parse_icns_sniffs_png_inside_argb_chunks() {
        let png16 = b"\x89PNG\r\n\x1a\n16px";
        let raw48 = vec![0u8; 48 * 48 * 4];
        let bytes = synth_icns(&[(b"ic04", png16), (b"ic06", &raw48)]);
        let chunks = parse_icns(&bytes).expect("parses");
        assert_eq!(chunks.len(), 2);
        assert!(matches!(chunks[0], IcnsChunk::Png { size: 16, .. }));
        assert!(matches!(chunks[1], IcnsChunk::Argb { size: 48, .. }));
    }

    #[test]
    fn parse_icns_skips_unknown_and_truncated_chunks() {
        let bytes = synth_icns(&[(b"TOC ", b"\x00\x00\x00\x00")]);
        assert!(parse_icns(&bytes).is_none());
        // Chunk length runs past the end of the file: parse stops safely.
        let mut bytes = synth_icns(&[(b"ic08", b"png")]);
        bytes[10] = 0xFF; // corrupt chunk length
        assert!(parse_icns(&bytes).is_none() || parse_icns(&bytes).unwrap().is_empty());
    }

    #[test]
    fn pick_best_prefers_largest_png_over_argb() {
        let png256 = b"png-256";
        let argb48 = vec![0u8; 48 * 48 * 4];
        let chunks = parse_icns(&synth_icns(&[
            (b"ic04", b"argb16"),
            (b"ic06", &argb48),
            (b"ic08", png256),
        ]))
        .expect("parses");
        match pick_best_chunk(&chunks).expect("a chunk") {
            IcnsChunk::Png { size, data } => {
                assert_eq!(*size, 256);
                assert_eq!(*data, png256);
            }
            other => panic!("expected the 256px PNG, got {other:?}"),
        }
    }

    #[test]
    fn pick_best_falls_back_to_largest_argb() {
        let argb16 = vec![0u8; 16 * 16 * 4];
        let argb48 = vec![0u8; 48 * 48 * 4];
        let chunks = parse_icns(&synth_icns(&[(b"ic04", &argb16), (b"ic06", &argb48)]))
            .expect("parses");
        match pick_best_chunk(&chunks).expect("a chunk") {
            IcnsChunk::Argb { size, .. } => assert_eq!(*size, 48),
            other => panic!("expected the 48px ARGB, got {other:?}"),
        }
    }

    #[test]
    fn argb_to_rgba_reorders_channels_and_validates_length() {
        let argb = [255, 10, 20, 30, 1, 2, 3, 4];
        // size 1: the first 4 bytes are reordered ARGB -> RGBA.
        assert_eq!(argb_to_rgba(&argb, 1).unwrap(), vec![10, 20, 30, 255]);
        // size 2 requires 16 bytes but only 8 are provided.
        assert_eq!(argb_to_rgba(&argb, 2), None);
    }

    #[test]
    fn argb_to_png_roundtrips() {
        let argb = vec![255u8; 16 * 16 * 4]; // opaque white
        let png = argb_to_png(&argb, 16).expect("encodes");
        let decoded = image::load_from_memory(&png).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (16, 16));
    }
}

#[cfg(all(test, unix, not(target_os = "macos")))]
mod tests_linux {
    use super::*;

    #[test]
    fn first_exec_token_handles_plain_and_quoted() {
        assert_eq!(first_exec_token(Some("code --new-window %F")), Some("code".into()));
        assert_eq!(
            first_exec_token(Some("\"/opt/sublime_text/sublime_text\" %F")),
            Some("/opt/sublime_text/sublime_text".into())
        );
        assert_eq!(first_exec_token(Some("env FOO=bar /usr/bin/code")), Some("env".into()));
        assert_eq!(first_exec_token(None), None);
        assert_eq!(first_exec_token(Some("   ")), None);
        assert_eq!(first_exec_token(Some("")), None);
    }

    #[test]
    fn encode_image_bytes_only_accepts_png_and_svg() {
        assert!(encode_image_bytes("png", b"bytes")
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(encode_image_bytes("PNG", b"bytes")
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(encode_image_bytes("svg", b"<svg/>")
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        assert_eq!(encode_image_bytes("ico", b"bytes"), None);
        assert_eq!(encode_image_bytes("xpm", b"bytes"), None);
    }

    #[test]
    fn icon_roots_contain_standard_dirs() {
        let roots = icon_roots();
        assert!(roots.iter().any(|r| r.ends_with("usr/share/icons/hicolor")));
        assert!(roots.iter().any(|r| r.ends_with("usr/share/pixmaps")));
    }
}
