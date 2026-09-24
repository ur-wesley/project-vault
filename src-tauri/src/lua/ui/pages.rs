//! Page view normalization: legacy list pages -> versioned view specs.
//!
//! Back-compat rule: `vault.ui.set_page({id, title?, itemCommand?, items})`
//! keeps working forever. Internally it normalizes to
//! `{ version: 1, kind: "list", ... }` so the new renderer handles both.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPageItem {
    pub id: String,
    pub label: String,
    pub detail: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageViewSpec {
    pub version: u32,
    pub kind: String,
    pub id: String,
    pub title: Option<String>,
    pub item_command: Option<String>,
    pub items: Option<Vec<LegacyPageItem>>,
    /// New-style view tree passthrough (table/form/stack/...) as raw JSON.
    pub view: Option<serde_json::Value>,
}

pub fn normalize_legacy_page(
    id: String,
    title: Option<String>,
    item_command: Option<String>,
    items: Vec<LegacyPageItem>,
) -> PageViewSpec {
    PageViewSpec {
        version: 1,
        kind: "list".into(),
        id,
        title,
        item_command,
        items: Some(items),
        view: None,
    }
}

pub fn normalize_view_value(value: serde_json::Value) -> Result<PageViewSpec, String> {
    let kind = value
        .get("kind")
        .and_then(|k| k.as_str())
        .unwrap_or("stack");
    match kind {
        "list" | "table" | "form" | "stack" | "stats" | "tabs" | "markdown" | "scroll" => Ok(PageViewSpec {
            version: 1,
            kind: kind.into(),
            id: value
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            title: value
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            item_command: value
                .get("rowCommand")
                .or_else(|| value.get("itemCommand"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            items: None,
            view: Some(value),
        }),
        other => Err(format!("unknown view kind '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_normalizes_to_list_view() {
        let spec = normalize_legacy_page(
            "dirty".into(),
            Some("T".into()),
            Some("open_item".into()),
            vec![LegacyPageItem {
                id: "a".into(),
                label: "A".into(),
                detail: None,
                icon: None,
            }],
        );
        assert_eq!(spec.version, 1);
        assert_eq!(spec.kind, "list");
        assert_eq!(spec.items.unwrap().len(), 1);
    }

    #[test]
    fn view_kinds_accepted_and_rejected() {
        for kind in [
            "table", "form", "stack", "stats", "tabs", "markdown", "list", "scroll",
        ] {
            let v = json!({"kind": kind, "id": "x"});
            assert!(normalize_view_value(v).is_ok(), "{kind} should be ok");
        }
        assert!(normalize_view_value(json!({"kind": "kanban"})).is_err());
    }
}
