use std::collections::HashMap;

use crate::error::{codes, StableError};
use crate::kanban::model::{
    normalize_priority, normalize_relation_kind, normalize_status, validate_due, validate_id,
    validate_relation_kind, validate_status, Board, BoardFrontmatter, Card, CardFrontmatter,
    DEFAULT_COLUMNS,
};

/// Split `---\n<yaml>\n---\n<body>` into (yaml, body).
/// Handles both LF and CRLF line endings (Windows checkouts / edit tooling
/// write CRLF). Byte offsets are tracked on the raw text via
/// `split_inclusive('\n')` so slices stay exact for either ending.
pub fn split_frontmatter(text: &str) -> Option<(&str, &str)> {
    let mut lines = text.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }
    let mut offset = first.len();
    for line in lines {
        if line.trim() == "---" {
            let yaml_end = offset;
            let body_start = offset + line.len();
            let yaml = &text[first.len()..yaml_end];
            let body = if body_start <= text.len() {
                &text[body_start..]
            } else {
                ""
            };
            return Some((yaml, body));
        }
        offset += line.len();
    }
    None
}

pub fn parse_card(text: &str) -> Result<Card, StableError> {
    let (yaml, body) = split_frontmatter(text)
        .ok_or_else(|| StableError::new(codes::SCHEMA_INCOMPATIBLE, "card: missing frontmatter"))?;
    let mut meta: CardFrontmatter = serde_yaml::from_str(yaml)
        .map_err(|e| StableError::new(codes::SCHEMA_INCOMPATIBLE, format!("card frontmatter: {e}")))?;
    if meta.id.is_empty() || meta.board.is_empty() || meta.title.is_empty() {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "card: id/board/title are required",
        ));
    }
    if meta.title.len() > 200 {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "card: title max 200 chars",
        ));
    }
    // Legacy normalization (v1 `ready`/`p0..p3` -> vibe-kanban values).
    meta.status = normalize_status(&meta.status).to_string();
    meta.priority = normalize_priority(&meta.priority).to_string();
    for rel in &mut meta.relations {
        rel.kind = normalize_relation_kind(&rel.kind).to_string();
    }
    if !validate_status(&meta.status) {
        meta.status = "backlog".to_string();
    }
    if !crate::kanban::model::validate_priority(&meta.priority) {
        meta.priority = "medium".to_string();
    }
    meta.relations.retain(|r| {
        validate_relation_kind(&r.kind) && validate_id(&r.to)
    });
    if let Some(parent) = &meta.parent {
        if !validate_id(parent) {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "card: parent must be a kebab-case card id",
            ));
        }
    }
    if !validate_due(&meta.due) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "card: due must be YYYY-MM-DD",
        ));
    }
    Ok(Card {
        meta,
        body: body.to_string(),
    })
}

pub fn serialize_card(card: &Card) -> Result<String, StableError> {
    let mut yaml = serde_yaml::to_string(&card.meta)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("serialize card: {e}")))?;
    if yaml.starts_with("---\n") {
        yaml = yaml["---\n".len()..].to_string();
    }
    Ok(format!("---\n{}---\n{}", yaml, card.body))
}

pub fn parse_board(text: &str) -> Result<Board, StableError> {
    let (yaml, body) = split_frontmatter(text)
        .ok_or_else(|| StableError::new(codes::SCHEMA_INCOMPATIBLE, "board: missing frontmatter"))?;
    let mut meta: BoardFrontmatter = serde_yaml::from_str(yaml)
        .map_err(|e| StableError::new(codes::SCHEMA_INCOMPATIBLE, format!("board frontmatter: {e}")))?;
    if meta.id.is_empty() || meta.title.is_empty() {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "board: id/title are required",
        ));
    }
    if meta.columns.is_empty() {
        meta.columns = DEFAULT_COLUMNS.iter().map(|s| s.to_string()).collect();
    }
    // NOTE: v1 → vibe-kanban column migration lives in the store
    // (`migrate_board_columns`), not here, so pure reads can detect legacy
    // boards and persist the migration exactly once.
    for col in meta.columns.clone() {
        meta.order.entry(col).or_insert_with(Vec::new);
    }
    Ok(Board {
        meta,
        body: body.to_string(),
    })
}

/// Render the human-readable board body from columns + ordered cards.
pub fn render_board_body(
    title: &str,
    columns: &[String],
    order: &HashMap<String, Vec<String>>,
    cards_by_id: &HashMap<String, Card>,
) -> String {
    let mut out = format!("# {title}\n");
    for col in columns {
        out.push_str(&format!("\n## {}\n", pretty_column(col)));
        match order.get(col) {
            Some(ids) if !ids.is_empty() => {
                for id in ids {
                    match cards_by_id.get(id) {
                        Some(c) => {
                            let check = if c.meta.status == "done" { "x" } else { " " };
                            out.push_str(&format!("- [{check}] #{id} — {}\n", c.meta.title));
                        }
                        None => continue, // dangling id: skipped, pruned on next write
                    }
                }
            }
            _ => out.push_str("_Empty_\n"),
        }
    }
    out
}

fn pretty_column(col: &str) -> String {
    let mut c = col.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = "---\nid: drag-drop\nboard: sprint-12\ntitle: Implement drag-drop\nstatus: doing\npriority: high\ntags: [ui]\n---\n## Notes\nhello\n";

    #[test]
    fn card_roundtrip() {
        let card = parse_card(CARD).unwrap();
        assert_eq!(card.meta.id, "drag-drop");
        assert_eq!(card.meta.status, "doing");
        let ser = serialize_card(&card).unwrap();
        let back = parse_card(&ser).unwrap();
        assert_eq!(back.meta.title, "Implement drag-drop");
    }

    #[test]
    fn legacy_status_and_priority_normalize() {
        let raw = CARD
            .replace("status: doing", "status: ready")
            .replace("priority: high", "priority: p1");
        let card = parse_card(&raw).unwrap();
        assert_eq!(card.meta.status, "todo");
        assert_eq!(card.meta.priority, "high");
    }

    #[test]
    fn relations_normalize_and_prune() {
        let raw = "---\nid: c1\nboard: b1\ntitle: C1\nrelations:\n  - { to: c2, kind: blocking }\n  - { to: c3, kind: has_duplicate }\n  - { to: nope!, kind: related }\n  - { to: c4, kind: bogus }\nparent: c0\n---\nbody\n";
        let card = parse_card(raw).unwrap();
        assert_eq!(card.meta.parent.as_deref(), Some("c0"));
        let kinds: Vec<_> = card.meta.relations.iter().map(|r| r.kind.as_str()).collect();
        assert_eq!(kinds, vec!["blocking", "duplicate"]);
    }

    #[test]
    fn legacy_board_columns_preserved_for_store_migration() {
        // The store (not the parser) owns v1 → vibe-kanban migration so it can
        // persist exactly once; the parser only guarantees order entries.
        let raw = "---\nid: b1\ntitle: B1\ncolumns: [backlog, ready, doing, done]\norder:\n  backlog: []\n  ready: [c1]\n  doing: []\n  done: []\n---\n# B1\n";
        let board = parse_board(raw).unwrap();
        assert_eq!(board.meta.columns, vec!["backlog", "ready", "doing", "done"]);
        assert_eq!(board.meta.order["ready"], vec!["c1"]);
    }

    #[test]
    fn card_missing_frontmatter_errors() {
        assert!(parse_card("# no frontmatter").is_err());
    }

    #[test]
    fn card_links_roundtrip() {
        let raw = "---\nid: c1\nboard: b1\ntitle: C1\nlinks:\n  tasks: []\n  files: []\n  issues: [github:12, local:3]\n---\nbody\n";
        let card = parse_card(raw).unwrap();
        assert_eq!(card.meta.links.issues, vec!["github:12", "local:3"]);
        let ser = serialize_card(&card).unwrap();
        let back = parse_card(&ser).unwrap();
        assert_eq!(back.meta.links.issues, vec!["github:12", "local:3"]);
    }

    #[test]
    fn card_bad_status_repairs_to_backlog() {
        let raw = CARD.replace("status: doing", "status: bogus");
        let card = parse_card(&raw).unwrap();
        assert_eq!(card.meta.status, "backlog");
    }

    #[test]
    fn card_bad_due_errors() {
        let raw = CARD.replace("priority: high", "priority: high\ndue: tomorrow");
        assert!(parse_card(&raw).is_err());
    }

    #[test]
    fn board_parses_and_renders() {
        let raw = "---\nid: b1\ntitle: B1\ncolumns: [backlog, doing]\norder:\n  backlog: [c1]\n  doing: []\n---\n# B1\n";
        let board = parse_board(raw).unwrap();
        assert_eq!(board.meta.columns, vec!["backlog", "doing"]);
        let body = render_board_body("B1", &board.meta.columns, &board.meta.order, &HashMap::new());
        assert!(body.contains("## Backlog"));
    }

    #[test]
    fn crlf_board_parses() {
        // Windows checkouts / edit tooling write CRLF; the board must still
        // list instead of being silently skipped by `list_boards`.
        let raw = "---\r\nid: b1\r\ntitle: B1\r\ncolumns: [backlog, doing]\r\norder:\r\n  backlog: [c1]\r\n  doing: []\r\n---\r\n# B1\r\n";
        let (yaml, body) = split_frontmatter(raw).unwrap();
        assert!(yaml.contains("id: b1"), "yaml mis-sliced: {yaml:?}");
        assert!(body.contains("# B1"), "body mis-sliced: {body:?}");
        let board = parse_board(raw).unwrap();
        assert_eq!(board.meta.id, "b1");
        assert_eq!(board.meta.order["backlog"], vec!["c1"]);
    }

    #[test]
    fn crlf_card_parses() {
        let raw = "---\r\nid: c1\r\nboard: b1\r\ntitle: C1\r\nstatus: doing\r\npriority: high\r\n---\r\nbody\r\n";
        let card = parse_card(raw).unwrap();
        assert_eq!(card.meta.id, "c1");
        assert_eq!(card.meta.status, "doing");
    }
}
