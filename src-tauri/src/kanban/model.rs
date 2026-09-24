use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// All board columns in display order. `backlog`/`cancelled` are hidden by
/// default in the UI (vibe-kanban: Backlog + Cancelled behind the "All" tab).
pub const DEFAULT_COLUMNS: [&str; 6] =
    ["backlog", "todo", "doing", "review", "done", "cancelled"];
pub const VISIBLE_COLUMNS: [&str; 4] = ["todo", "doing", "review", "done"];
pub const HIDDEN_COLUMNS: [&str; 2] = ["backlog", "cancelled"];
pub const VALID_STATUSES: [&str; 6] =
    ["backlog", "todo", "doing", "review", "done", "cancelled"];
pub const VALID_PRIORITIES: [&str; 4] = ["urgent", "high", "medium", "low"];
pub const VALID_RELATIONS: [&str; 3] = ["blocking", "related", "duplicate"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChecklistItem {
    pub label: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CardLinks {
    #[serde(default)]
    pub tasks: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub issues: Vec<String>,
    #[serde(default)]
    pub workspaces: Vec<String>,
}

/// Parent/child (sub-issue) + peer relationships, vibe-kanban style:
/// `blocking` / `related` / `duplicate` (`has_duplicate` normalizes here).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IssueRelation {
    pub to: String,
    pub kind: String,
}

/// Card frontmatter. Unknown keys are captured in `extra` and preserved on write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardFrontmatter {
    pub id: String,
    pub board: String,
    pub title: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub relations: Vec<IssueRelation>,
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub links: CardLinks,
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
    #[serde(flatten, default)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

fn default_status() -> String {
    "todo".to_string()
}

fn default_priority() -> String {
    "medium".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    #[serde(flatten)]
    pub meta: CardFrontmatter,
    #[serde(skip)]
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardFrontmatter {
    pub id: String,
    pub title: String,
    #[serde(default = "default_columns")]
    pub columns: Vec<String>,
    #[serde(default)]
    pub order: HashMap<String, Vec<String>>,
    /// Project-scoped tag colors (`tag name -> #rrggbb`), vibe-kanban style.
    #[serde(default)]
    pub tag_colors: HashMap<String, String>,
    #[serde(flatten, default)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

fn default_columns() -> Vec<String> {
    DEFAULT_COLUMNS.iter().map(|s| s.to_string()).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    #[serde(flatten)]
    pub meta: BoardFrontmatter,
    #[serde(skip)]
    pub body: String,
}

/// Board with embedded cards (MCP `get_board` shape).
#[derive(Debug, Clone, Serialize)]
pub struct BoardView {
    pub id: String,
    pub title: String,
    pub columns: Vec<String>,
    pub order: HashMap<String, Vec<String>>,
    pub tag_colors: HashMap<String, String>,
    pub cards: Vec<Card>,
}

/// Tag with usage count (for `list_tags`).
#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    pub color: Option<String>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BoardSummary {
    pub id: String,
    pub title: String,
    pub columns: Vec<String>,
    pub card_count: usize,
}

pub fn validate_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn validate_status(s: &str) -> bool {
    VALID_STATUSES.contains(&s)
}

pub fn validate_priority(p: &str) -> bool {
    VALID_PRIORITIES.contains(&p)
}

pub fn validate_relation_kind(k: &str) -> bool {
    VALID_RELATIONS.contains(&k)
}

/// Legacy `ready` column -> `todo` (vibe-kanban column adoption).
pub fn normalize_status(s: &str) -> &str {
    match s {
        "ready" => "todo",
        _ => s,
    }
}

/// Legacy `p0..p3` priorities -> `urgent/high/medium/low`.
pub fn normalize_priority(p: &str) -> &str {
    match p {
        "p0" => "urgent",
        "p1" => "high",
        "p2" => "medium",
        "p3" => "low",
        _ => p,
    }
}

/// Legacy `has_duplicate` relation kind -> `duplicate`.
pub fn normalize_relation_kind(k: &str) -> &str {
    match k {
        "has_duplicate" => "duplicate",
        _ => k,
    }
}

/// Migrate a v1 board (`[backlog, ready, doing, done]`) to the vibe-kanban
/// column set. Returns true when the board was changed.
pub fn migrate_board_columns(meta: &mut BoardFrontmatter) -> bool {
    let is_legacy = meta.columns == ["backlog", "ready", "doing", "done"];
    if !is_legacy {
        return false;
    }
    let ready_ids = meta.order.remove("ready").unwrap_or_default();
    meta.columns = default_columns();
    for col in meta.columns.clone() {
        meta.order.entry(col).or_insert_with(Vec::new);
    }
    meta.order
        .entry("todo".to_string())
        .or_default()
        .extend(ready_ids);
    true
}

/// Issue link refs stored on cards: `github:<number>` or `local:<number>`.
pub fn validate_issue_link(s: &str) -> bool {
    let (kind, num) = match s.split_once(':') {
        Some(p) => p,
        None => return false,
    };
    (kind == "github" || kind == "local")
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit())
}

pub fn validate_due(due: &Option<String>) -> bool {
    match due {
        None => true,
        Some(d) => {
            if d.len() != 10 {
                return false;
            }
            let b = d.as_bytes();
            b[4] == b'-'
                && b[7] == b'-'
                && d[..4].chars().all(|c| c.is_ascii_digit())
                && d[5..7].chars().all(|c| c.is_ascii_digit())
                && d[8..].chars().all(|c| c.is_ascii_digit())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_values_normalize() {
        assert_eq!(normalize_status("ready"), "todo");
        assert_eq!(normalize_status("doing"), "doing");
        assert_eq!(normalize_priority("p0"), "urgent");
        assert_eq!(normalize_priority("p1"), "high");
        assert_eq!(normalize_priority("p2"), "medium");
        assert_eq!(normalize_priority("p3"), "low");
        assert_eq!(normalize_priority("high"), "high");
        assert_eq!(normalize_relation_kind("has_duplicate"), "duplicate");
        assert_eq!(normalize_relation_kind("blocking"), "blocking");
    }

    #[test]
    fn legacy_board_migrates() {
        let mut meta = BoardFrontmatter {
            id: "b".to_string(),
            title: "B".to_string(),
            columns: vec!["backlog".into(), "ready".into(), "doing".into(), "done".into()],
            order: [("ready".to_string(), vec!["c1".to_string()])].into_iter().collect(),
            tag_colors: HashMap::new(),
            extra: HashMap::new(),
        };
        assert!(migrate_board_columns(&mut meta));
        assert_eq!(meta.columns, vec!["backlog", "todo", "doing", "review", "done", "cancelled"]);
        assert_eq!(meta.order["todo"], vec!["c1"]);
        assert!(!migrate_board_columns(&mut meta));
    }

    #[test]
    fn issue_link_refs_validate() {
        assert!(validate_issue_link("github:123"));
        assert!(validate_issue_link("local:5"));
        assert!(!validate_issue_link("github:"));
        assert!(!validate_issue_link("github:abc"));
        assert!(!validate_issue_link("jira:123"));
        assert!(!validate_issue_link("123"));
        assert!(!validate_issue_link(""));
    }
}

/// Kebab-case slug from a title.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in title.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= 64 {
            break;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        format!("card-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
    } else {
        slug
    }
}
