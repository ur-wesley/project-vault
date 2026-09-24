//! Modal dialog option types + validation for new UI primitives.
//!
//! Each dialog follows the existing oneshot-bridge pattern from `super`:
//! Lua awaits, frontend resolves via `resolve_plugin_ui`. Validation happens
//! in Rust first so Lua gets a clear error instead of a stuck dialog.

use serde::{Deserialize, Serialize};

use super::types::{validate_table, TableRow, TableViewOptions};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableDialogOptions {
    pub title: String,
    pub columns: Vec<super::types::TableColumn>,
    pub rows: Vec<TableRow>,
    pub searchable: Option<bool>,
    pub pagination_page_size: Option<u32>,
}

impl From<TableDialogOptions> for TableViewOptions {
    fn from(o: TableDialogOptions) -> Self {
        TableViewOptions {
            id: None,
            columns: o.columns,
            rows: o.rows,
            searchable: o.searchable,
            sortable: Some(true),
            pagination: o
                .pagination_page_size
                .map(|page_size| super::types::PaginationOptions {
                    page_size: Some(page_size),
                }),
            row_command: None,
        }
    }
}

pub fn validate_table_dialog(opts: &TableDialogOptions) -> Result<(), String> {
    if opts.title.trim().is_empty() {
        return Err("table dialog title must not be empty".into());
    }
    validate_table(&TableViewOptions::from(opts.clone()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToastOptions {
    pub title: String,
    pub message: Option<String>,
    /// info | success | warn | error
    pub severity: Option<String>,
}

pub fn validate_toast(opts: &ToastOptions) -> Result<(), String> {
    if opts.title.trim().is_empty() {
        return Err("toast title must not be empty".into());
    }
    if let Some(s) = &opts.severity {
        match s.as_str() {
            "info" | "success" | "warn" | "error" => {}
            _ => return Err("toast severity must be info|success|warn|error".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lua::ui::types::TableColumn;

    fn col(id: &str) -> TableColumn {
        TableColumn {
            id: id.into(),
            header: id.into(),
            accessor: None,
            kind: None,
            sortable: None,
            width: None,
            align: None,
        }
    }

    #[test]
    fn table_dialog_requires_title_and_columns() {
        let bad = TableDialogOptions {
            title: "  ".into(),
            columns: vec![col("a")],
            rows: vec![],
            searchable: None,
            pagination_page_size: None,
        };
        assert!(validate_table_dialog(&bad).is_err());

        let bad2 = TableDialogOptions {
            title: "Pick".into(),
            columns: vec![],
            rows: vec![],
            searchable: None,
            pagination_page_size: None,
        };
        assert!(validate_table_dialog(&bad2).is_err());
    }

    #[test]
    fn toast_validation() {
        assert!(validate_toast(&ToastOptions {
            title: "hi".into(),
            message: None,
            severity: Some("success".into()),
        })
        .is_ok());
        assert!(validate_toast(&ToastOptions {
            title: "".into(),
            message: None,
            severity: None,
        })
        .is_err());
        assert!(validate_toast(&ToastOptions {
            title: "hi".into(),
            message: None,
            severity: Some("nope".into()),
        })
        .is_err());
    }
}
