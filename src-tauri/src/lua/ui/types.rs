//! Shared view-spec types + validation limits for plugin native UI.
//!
//! `ViewSpec` is intentionally `serde_json::Value`-friendly at the boundary:
//! Lua sends a plain table, Rust validates shape + limits, frontend zod-validates.
//! Strict per-field structs live here so new widgets extend this file only.

use serde::{Deserialize, Serialize};

/// Hard limits to keep Lua-driven UI fast and safe.
pub const MAX_TABLE_ROWS: usize = 5000;
pub const MAX_TABLE_COLUMNS: usize = 20;
pub const MAX_VIEW_CHILDREN: usize = 32;
pub const MAX_STORE_KEYS_PER_PLUGIN: usize = 500;
pub const MAX_STORE_VALUE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub id: String,
    pub header: String,
    pub accessor: Option<String>,
    /// text | badge | icon | link | progress | code | date | actions
    pub kind: Option<String>,
    pub sortable: Option<bool>,
    pub width: Option<u32>,
    /// left | center | right
    pub align: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableRow {
    pub id: String,
    pub cells: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaginationOptions {
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableViewOptions {
    pub id: Option<String>,
    pub columns: Vec<TableColumn>,
    pub rows: Vec<TableRow>,
    pub searchable: Option<bool>,
    pub sortable: Option<bool>,
    pub pagination: Option<PaginationOptions>,
    pub row_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmOptions {
    pub title: String,
    pub message: Option<String>,
    pub ok_label: Option<String>,
    pub cancel_label: Option<String>,
    pub danger: Option<bool>,
}

pub fn validate_table(opts: &TableViewOptions) -> Result<(), String> {
    if opts.columns.is_empty() {
        return Err("table requires at least one column".into());
    }
    if opts.columns.len() > MAX_TABLE_COLUMNS {
        return Err(format!("too many columns (max {MAX_TABLE_COLUMNS})"));
    }
    if opts.rows.len() > MAX_TABLE_ROWS {
        return Err(format!("too many rows (max {MAX_TABLE_ROWS})"));
    }
    let mut seen = std::collections::HashSet::new();
    for c in &opts.columns {
        if c.id.trim().is_empty() {
            return Err("column id must not be empty".into());
        }
        if !seen.insert(c.id.clone()) {
            return Err(format!("duplicate column id '{}'", c.id));
        }
    }
    Ok(())
}

pub fn validate_view_children_count(n: usize) -> Result<(), String> {
    if n > MAX_VIEW_CHILDREN {
        return Err(format!("too many view children (max {MAX_VIEW_CHILDREN})"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn row(id: &str) -> TableRow {
        TableRow {
            id: id.into(),
            cells: Default::default(),
        }
    }

    #[test]
    fn rejects_empty_columns() {
        let opts = TableViewOptions {
            id: None,
            columns: vec![],
            rows: vec![],
            searchable: None,
            sortable: None,
            pagination: None,
            row_command: None,
        };
        assert!(validate_table(&opts).is_err());
    }

    #[test]
    fn rejects_duplicate_column_ids() {
        let opts = TableViewOptions {
            id: None,
            columns: vec![col("a"), col("a")],
            rows: vec![],
            searchable: None,
            sortable: None,
            pagination: None,
            row_command: None,
        };
        assert!(validate_table(&opts).unwrap_err().contains("duplicate"));
    }

    #[test]
    fn rejects_too_many_rows() {
        let opts = TableViewOptions {
            id: None,
            columns: vec![col("a")],
            rows: (0..MAX_TABLE_ROWS + 1)
                .map(|i| row(&format!("r{i}")))
                .collect(),
            searchable: None,
            sortable: None,
            pagination: None,
            row_command: None,
        };
        assert!(validate_table(&opts).is_err());
    }

    #[test]
    fn accepts_valid_table() {
        let opts = TableViewOptions {
            id: Some("t".into()),
            columns: vec![col("name"), col("status")],
            rows: vec![row("r1"), row("r2")],
            searchable: Some(true),
            sortable: Some(true),
            pagination: Some(PaginationOptions {
                page_size: Some(20),
            }),
            row_command: Some("open_item".into()),
        };
        assert!(validate_table(&opts).is_ok());
    }
}
