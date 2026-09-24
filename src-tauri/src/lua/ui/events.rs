//! Canonical Tauri event names for the plugin UI system.
//!
//! Single source of truth: Rust emits these, the Solid frontend listens.
//! Adding a new UI capability = add event constant here + listener module
//! under `src/features/plugin-ui/bridge/`.

/// Modal single-prompt input (`show_input_box`).
pub const SHOW_INPUT: &str = "plugin:show-input";
/// Searchable list dialog (`show_quick_pick`).
pub const SHOW_QUICK_PICK: &str = "plugin:show-quick-pick";
/// Modal multi-field form (`show_form`).
pub const SHOW_FORM: &str = "plugin:show-form";
/// Modal data-table dialog (`show_table`, new).
pub const SHOW_TABLE: &str = "plugin:show-table";
/// Modal confirm dialog (`show_confirm`, new).
pub const SHOW_CONFIRM: &str = "plugin:show-confirm";
/// Fire-and-forget toast (`show_toast`, new).
pub const SHOW_TOAST: &str = "plugin:show-toast";
/// Create/replace a plugin page view (`set_view` / legacy `set_page`).
pub const SET_VIEW: &str = "plugin:set-view";
/// Back-compat alias still emitted by legacy `set_page`.
pub const SET_PAGE: &str = "plugin:set-page";
/// Remove a plugin page.
pub const CLEAR_PAGE: &str = "plugin:clear-page";
/// Navigate to a plugin page.
pub const OPEN_PAGE: &str = "plugin:open-page";
/// Reactive store change fan-out (`vault.store.set` etc).
pub const STORE_CHANGED: &str = "plugin:store-changed";

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn event_names_are_namespaced_and_unique() {
        let all = [
            SHOW_INPUT,
            SHOW_QUICK_PICK,
            SHOW_FORM,
            SHOW_TABLE,
            SHOW_CONFIRM,
            SHOW_TOAST,
            SET_VIEW,
            SET_PAGE,
            CLEAR_PAGE,
            OPEN_PAGE,
            STORE_CHANGED,
        ];
        for e in all {
            assert!(
                e.starts_with("plugin:"),
                "event {e} must be plugin-namespaced"
            );
        }
        let uniq: HashSet<&&str> = all.iter().collect();
        assert_eq!(uniq.len(), all.len(), "event names must be unique");
    }
}
