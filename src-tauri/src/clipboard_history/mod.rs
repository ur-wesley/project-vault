mod apply;
#[cfg(windows)]
mod caret;
mod position;
mod store;
mod types;
mod watcher;

pub use apply::apply_entry;
pub use position::{
    capture_overlay_anchor, compute_overlay_position, save_foreground_hwnd,
    ClipboardOverlayPositionDto,
};
pub use store::{
    clear_entries, delete_entry, entry_thumbnail_data_url, get_entry, list_entries, load_settings,
    save_settings, toggle_pin, update_text_entry,
};
pub use types::{
    ClipboardEntryDto, ClipboardHistorySettingsDto, ListClipboardHistoryArgs,
    UpdateClipboardEntryArgs, ClearClipboardHistoryArgs,
};
pub use watcher::{start_watcher, ClipboardWatcherState};
