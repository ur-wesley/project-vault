use std::sync::Arc;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;

use super::watcher::ClipboardWatcherState;

pub type CaretAnchor = (i32, i32, i32);

const DEFAULT_LINE_HEIGHT: i32 = 18;

pub fn resolve_caret_anchor(app: &AppHandle) -> Option<CaretAnchor> {
    unsafe {
        if let Some(anchor) = caret_from_uia() {
            return Some(anchor);
        }
        if let Some(hwnd) = saved_foreground_hwnd(app) {
            if let Some(anchor) = caret_from_gui_thread_info(hwnd) {
                return Some(anchor);
            }
        }
        if let Some(anchor) = caret_from_attach_thread_getcaretpos() {
            return Some(anchor);
        }
        if let Some(hwnd) = saved_foreground_hwnd(app) {
            if let Some(anchor) = caret_from_edit_children(hwnd) {
                return Some(anchor);
            }
        }
        None
    }
}

fn saved_foreground_hwnd(app: &AppHandle) -> Option<HWND> {
    let state = app.state::<Arc<ClipboardWatcherState>>();
    state
        .saved_foreground_hwnd
        .lock()
        .ok()
        .and_then(|guard| guard.map(|h| HWND(h as *mut _)))
}

unsafe fn caret_from_uia() -> Option<CaretAnchor> {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern2, UIA_TextPattern2Id,
    };

    let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
    if hr.is_err() && hr.0 as u32 != 0x8001_0106 {
        return None;
    }

    let automation: IUIAutomation =
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
    let focused = automation.GetFocusedElement().ok()?;

    if let Ok(pattern) = focused.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
    {
        let mut is_active = BOOL::default();
        if let Ok(range) = pattern.GetCaretRange(&mut is_active) {
            if let Ok(rects) = range.GetBoundingRectangles() {
                if let Some(anchor) = anchor_from_bounding_rects_array(rects) {
                    return Some(anchor);
                }
            }
        }
    }

    None
}

unsafe fn anchor_from_bounding_rects_array(
    arr: *mut windows::Win32::System::Com::SAFEARRAY,
) -> Option<CaretAnchor> {
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayGetLBound, SafeArrayGetUBound, SafeArrayUnaccessData,
    };

    if arr.is_null() {
        return None;
    }

    let lbound = SafeArrayGetLBound(arr, 1).ok()?;
    let ubound = SafeArrayGetUBound(arr, 1).ok()?;
    let count = (ubound - lbound + 1) as usize;
    if count < 4 {
        return None;
    }

    let mut data = std::ptr::null_mut();
    if SafeArrayAccessData(arr, &mut data).is_err() || data.is_null() {
        return None;
    }

    let doubles = std::slice::from_raw_parts(data as *const f64, count);
    let left = doubles[0].round() as i32;
    let top = doubles[1].round() as i32;
    let height = doubles[3].round() as i32;
    let _ = SafeArrayUnaccessData(arr);

    let bottom = top + height.max(DEFAULT_LINE_HEIGHT);
    Some((left, bottom, top))
}

unsafe fn caret_from_gui_thread_info(hwnd: HWND) -> Option<CaretAnchor> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, GetWindowRect, GetWindowThreadProcessId, GUITHREADINFO,
    };

    if hwnd.0.is_null() {
        return None;
    }

    let thread_id = GetWindowThreadProcessId(hwnd, None);
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };

    if GetGUIThreadInfo(thread_id, &mut info).is_err() {
        return None;
    }

    if !info.hwndCaret.0.is_null() {
        let r = info.rcCaret;
        if r.bottom > r.top {
            return Some((r.left, r.bottom, r.top));
        }
        if r.right > r.left {
            return Some((r.left, r.top + DEFAULT_LINE_HEIGHT, r.top));
        }
        let mut wr = RECT::default();
        if GetWindowRect(info.hwndCaret, &mut wr).is_ok() && wr.bottom > wr.top {
            return Some((wr.left, wr.bottom, wr.top));
        }
    }

    if !info.hwndFocus.0.is_null() {
        if let Some(anchor) = caret_from_edit_hwnd(info.hwndFocus) {
            return Some(anchor);
        }
    }

    None
}

unsafe fn caret_from_attach_thread_getcaretpos() -> Option<CaretAnchor> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCaretPos, GetForegroundWindow, GetWindowThreadProcessId,
    };

    let foreground = GetForegroundWindow();
    if foreground.0.is_null() {
        return None;
    }

    let fore_thread = GetWindowThreadProcessId(foreground, None);
    let cur_thread = GetCurrentThreadId();
    let attached = fore_thread != cur_thread && AttachThreadInput(cur_thread, fore_thread, true).as_bool();

    let result = (|| {
        let mut pt = POINT::default();
        if GetCaretPos(&mut pt).is_err() {
            return None;
        }
        let focus = GetFocus();
        let target = if focus.0.is_null() { foreground } else { focus };
        if !ClientToScreen(target, &mut pt).as_bool() {
            return None;
        }
        Some((pt.x, pt.y + DEFAULT_LINE_HEIGHT, pt.y))
    })();

    if attached {
        let _ = AttachThreadInput(cur_thread, fore_thread, false);
    }

    result
}

unsafe fn caret_from_edit_children(hwnd: HWND) -> Option<CaretAnchor> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GW_CHILD, GW_HWNDNEXT, IsWindowVisible,
    };

    let Ok(mut child) = GetWindow(hwnd, GW_CHILD) else {
        return None;
    };

    while !child.0.is_null() {
        if IsWindowVisible(child).as_bool() {
            if let Some(anchor) = caret_from_edit_hwnd(child) {
                return Some(anchor);
            }
        }
        child = GetWindow(child, GW_HWNDNEXT).unwrap_or(HWND::default());
        if child.0.is_null() {
            break;
        }
    }

    None
}

unsafe fn caret_from_edit_hwnd(hwnd: HWND) -> Option<CaretAnchor> {
    use windows::Win32::Foundation::{LPARAM, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, SendMessageW};

    const EM_GETSEL: u32 = 0x00B0;
    const EM_POSFROMCHAR: u32 = 0x00D6;

    let mut class = [0u16; 64];
    let len = GetClassNameW(hwnd, &mut class);
    if len == 0 {
        return None;
    }

    let class_name = String::from_utf16_lossy(&class[..len as usize]);
    let is_edit = class_name == "Edit"
        || class_name.starts_with("RichEdit")
        || class_name == "RICHEDIT50W"
        || class_name == "RICHEDIT20W";
    if !is_edit {
        return None;
    }

    let sel = SendMessageW(hwnd, EM_GETSEL, WPARAM(0), LPARAM(0));
    let caret_index = (sel.0 & 0xFFFF) as i32;
    let pos = SendMessageW(
        hwnd,
        EM_POSFROMCHAR,
        WPARAM(caret_index as usize),
        LPARAM(-1),
    );
    if pos.0 < 0 {
        return None;
    }

    let x = (pos.0 & 0xFFFF) as i32;
    let y = ((pos.0 >> 16) & 0xFFFF) as i32;
    let mut pt = POINT { x, y };
    if !ClientToScreen(hwnd, &mut pt).as_bool() {
        return None;
    }
    Some((pt.x, pt.y + DEFAULT_LINE_HEIGHT, pt.y))
}
