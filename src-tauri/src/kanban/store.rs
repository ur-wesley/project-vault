use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use sqlx::{Pool, Sqlite};

use crate::db;
use crate::error::{codes, StableError};
use crate::kanban::model::{
    migrate_board_columns, normalize_priority, normalize_status, validate_due, validate_id,
    validate_issue_link, validate_priority, validate_relation_kind, validate_status, Board,
    BoardSummary, BoardView, Card, CardFrontmatter, CardLinks, IssueRelation, DEFAULT_COLUMNS,
};
use crate::kanban::parser::{parse_board, parse_card, render_board_body, serialize_card};

pub fn kanban_root(project_root: &Path) -> PathBuf {
    project_root.join(".vault").join("kanban").join("boards")
}

fn board_dir(project_root: &Path, board_id: &str) -> Result<PathBuf, StableError> {
    if !validate_id(board_id) {
        return Err(StableError::new(codes::INVALID_PATH, "invalid board id"));
    }
    Ok(kanban_root(project_root).join(board_id))
}

fn board_file(project_root: &Path, board_id: &str) -> Result<PathBuf, StableError> {
    Ok(board_dir(project_root, board_id)?.join("board.md"))
}

fn card_file(project_root: &Path, board_id: &str, card_id: &str) -> Result<PathBuf, StableError> {
    if !validate_id(card_id) {
        return Err(StableError::new(codes::INVALID_PATH, "invalid card id"));
    }
    Ok(board_dir(project_root, board_id)?.join("cards").join(format!("{card_id}.md")))
}

/// Resolve a project root from id, name, or absolute path.
pub async fn resolve_project_root(
    pool: &Pool<Sqlite>,
    id_or_path: &str,
) -> Result<PathBuf, StableError> {
    // Absolute path shortcut (must exist + be dir).
    let p = Path::new(id_or_path);
    if p.is_absolute() && p.is_dir() {
        return Ok(p.to_path_buf());
    }
    let projects = db::list_projects(pool).await?;
    let found = projects.into_iter().find(|pr| {
        pr.id == id_or_path || pr.name.eq_ignore_ascii_case(id_or_path) || pr.path == id_or_path
    });
    match found {
        Some(pr) => Ok(PathBuf::from(pr.path)),
        None => Err(StableError::new(
            codes::NOT_FOUND,
            format!("project '{id_or_path}' not found"),
        )),
    }
}

async fn read_board(project_root: &Path, board_id: &str) -> Result<Board, StableError> {
    let text = tokio::fs::read_to_string(board_file(project_root, board_id)?)
        .await
        .map_err(|_| {
            StableError::new(codes::NOT_FOUND, format!("board '{board_id}' not found"))
        })?;
    parse_board(&text)
}

/// Persist a v1 → vibe-kanban column migration on read so viewers immediately
/// see the new columns. Idempotent; mutating ops pick it up via parse anyway.
async fn migrate_on_read(project_root: &Path, board: &mut Board) -> Result<(), StableError> {
    if migrate_board_columns(&mut board.meta) {
        let cards = read_all_cards(project_root, &board.meta.id).await?;
        persist_board(project_root, board, &cards).await?;
    }
    Ok(())
}

async fn read_all_cards(
    project_root: &Path,
    board_id: &str,
) -> Result<HashMap<String, Card>, StableError> {
    let mut map = HashMap::new();
    let dir = board_dir(project_root, board_id)?.join("cards");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(e) => e,
        Err(_) => return Ok(map), // no cards yet
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Ok(text) = tokio::fs::read_to_string(&path).await else {
            continue;
        };
        let Ok(card) = parse_card(&text) else { continue };
        if card.meta.board != board_id {
            continue;
        }
        map.insert(card.meta.id.clone(), card);
    }
    Ok(map)
}

/// Reconcile order vs disk: drop dangling ids, append orphan cards to their
/// status column, repair in-memory status to the column. Pure (no IO).
fn reconcile(
    columns: &[String],
    order: &HashMap<String, Vec<String>>,
    cards: &mut HashMap<String, Card>,
) -> HashMap<String, Vec<String>> {
    let mut fixed: HashMap<String, Vec<String>> = HashMap::new();
    for col in columns {
        fixed.insert(col.clone(), Vec::new());
    }
    let mut seen = HashSet::new();
    for col in columns {
        if let Some(ids) = order.get(col) {
            for id in ids {
                if let Some(card) = cards.get_mut(id) {
                    if card.meta.archived {
                        continue;
                    }
                    card.meta.status = col.clone();
                    fixed.get_mut(col).unwrap().push(id.clone());
                    seen.insert(id.clone());
                }
                // dangling ids silently dropped
            }
        }
    }
    // Orphans: on disk but absent from order → append to status column.
    let mut orphans: Vec<(String, String)> = cards
        .iter()
        .filter(|(id, c)| !seen.contains(*id) && !c.meta.archived)
        .map(|(id, c)| (id.clone(), c.meta.status.clone()))
        .collect();
    orphans.sort();
    for (id, mut status) in orphans {
        if !columns.contains(&status) {
            status = "backlog".to_string();
            if let Some(c) = cards.get_mut(&id) {
                c.meta.status = status.clone();
            }
        }
        fixed.entry(status).or_default().push(id);
    }
    fixed
}

async fn persist_board(
    project_root: &Path,
    board: &mut Board,
    cards: &HashMap<String, Card>,
) -> Result<(), StableError> {
    let body = render_board_body(&board.meta.title, &board.meta.columns, &board.meta.order, cards);
    board.body = body.clone();
    let yaml = serde_yaml::to_string(&board.meta)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("serialize board: {e}")))?;
    let yaml = yaml.strip_prefix("---\n").unwrap_or(&yaml);
    let text = format!("---\n{yaml}---\n{body}");
    tokio::fs::write(board_file(project_root, &board.meta.id)?, text)
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write board: {e}")))?;
    Ok(())
}

pub async fn list_boards(project_root: &Path) -> Result<Vec<BoardSummary>, StableError> {
    let root = kanban_root(project_root);
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(&root).await {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if !entry.path().is_dir() {
            continue;
        }
        let board_id = entry.file_name().to_string_lossy().to_string();
        if !validate_id(&board_id) {
            continue;
        }
        match read_board(project_root, &board_id).await {
            Ok(mut b) => {
                // Best-effort migration so old boards show new columns everywhere.
                // `b` is already migrated in memory afterwards.
                let _ = migrate_on_read(project_root, &mut b).await;
                let cards = read_all_cards(project_root, &board_id).await.unwrap_or_default();
                let count = cards.values().filter(|c| !c.meta.archived).count();
                out.push(BoardSummary {
                    id: b.meta.id,
                    title: b.meta.title,
                    columns: b.meta.columns,
                    card_count: count,
                });
            }
            Err(_) => continue,
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub async fn get_board_view(
    project_root: &Path,
    board_id: &str,
) -> Result<BoardView, StableError> {
    let mut board = read_board(project_root, board_id).await?;
    migrate_on_read(project_root, &mut board).await?;
    let mut cards = read_all_cards(project_root, board_id).await?;
    let order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
    let mut list: Vec<Card> = cards.into_values().collect();
    list.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
    Ok(BoardView {
        id: board.meta.id.clone(),
        title: board.meta.title.clone(),
        columns: board.meta.columns.clone(),
        order,
        tag_colors: board.meta.tag_colors.clone(),
        cards: list,
    })
}

pub async fn create_board(
    project_root: &Path,
    board_id: &str,
    title: &str,
) -> Result<Board, StableError> {
    if !validate_id(board_id) {
        return Err(StableError::new(codes::INVALID_PATH, "invalid board id"));
    }
    let title = title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "board title 1-200 chars",
        ));
    }
    let dir = board_dir(project_root, board_id)?;
    if dir.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            format!("board '{board_id}' exists"),
        ));
    }
    tokio::fs::create_dir_all(dir.join("cards"))
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("mkdir: {e}")))?;
    let columns: Vec<String> = DEFAULT_COLUMNS.iter().map(|s| s.to_string()).collect();
    let mut order = HashMap::new();
    for c in &columns {
        order.insert(c.clone(), Vec::new());
    }
    let mut board = Board {
        meta: crate::kanban::model::BoardFrontmatter {
            id: board_id.to_string(),
            title: title.to_string(),
            columns: columns.clone(),
            order,
            tag_colors: HashMap::new(),
            extra: HashMap::new(),
        },
        body: String::new(),
    };
    persist_board(project_root, &mut board, &HashMap::new()).await?;
    Ok(board)
}

#[derive(Debug, Default)]
pub struct NewCard {
    pub title: String,
    pub body: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
    pub parent: Option<String>,
    pub relations: Option<Vec<IssueRelation>>,
    pub due: Option<String>,
}

fn check_relations(relations: &[IssueRelation]) -> Result<(), StableError> {
    for rel in relations {
        if !validate_relation_kind(&rel.kind) {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "relation kind must be blocking|related|duplicate",
            ));
        }
        if !validate_id(&rel.to) {
            return Err(StableError::new(
                codes::INVALID_PATH,
                "relation target must be a kebab-case card id",
            ));
        }
    }
    Ok(())
}

pub async fn create_card(
    project_root: &Path,
    board_id: &str,
    card_id: &str,
    input: NewCard,
) -> Result<Card, StableError> {
    if !validate_id(card_id) {
        return Err(StableError::new(codes::INVALID_PATH, "invalid card id"));
    }
    let mut board = read_board(project_root, board_id).await?;
    // Upgrade v1 boards before touching order (persisted below).
    migrate_board_columns(&mut board.meta);
    let path = card_file(project_root, board_id, card_id)?;
    if path.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            format!("card '{card_id}' exists"),
        ));
    }
    let title = input.title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "card title 1-200 chars",
        ));
    }
    let status = input
        .status
        .map(|s| normalize_status(&s).to_string())
        .unwrap_or_else(|| "todo".to_string());
    if !validate_status(&status) {
        return Err(StableError::new(codes::SCHEMA_INCOMPATIBLE, "bad status"));
    }
    let priority = input
        .priority
        .map(|p| normalize_priority(&p).to_string())
        .unwrap_or_else(|| "medium".to_string());
    if !validate_priority(&priority) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "bad priority (urgent|high|medium|low)",
        ));
    }
    let due = input.due.filter(|d| !d.is_empty());
    if !validate_due(&due) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "due must be YYYY-MM-DD",
        ));
    }
    let relations = input.relations.unwrap_or_default();
    check_relations(&relations)?;
    // Parent must exist (no orphans); self-parenting is rejected.
    if let Some(parent) = input.parent.as_deref().filter(|p| !p.is_empty()) {
        if !validate_id(parent) {
            return Err(StableError::new(codes::INVALID_PATH, "bad parent id"));
        }
        if parent == card_id {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "card cannot be its own parent",
            ));
        }
        get_card(project_root, board_id, parent).await?;
    }
    let card = Card {
        meta: CardFrontmatter {
            id: card_id.to_string(),
            board: board_id.to_string(),
            title: title.to_string(),
            status: status.clone(),
            priority,
            tags: input.tags.unwrap_or_default(),
            assignees: input.assignees.unwrap_or_default(),
            parent: input.parent.filter(|p| !p.is_empty()),
            relations,
            due,
            archived: false,
            links: CardLinks::default(),
            checklist: Vec::new(),
            extra: HashMap::new(),
        },
        body: input.body.unwrap_or_default(),
    };
    tokio::fs::write(&path, serialize_card(&card)?)
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write card: {e}")))?;
    // Insert into order before reconciling: reconcile appends any card on disk
    // but missing from order, so pushing after it would duplicate the new card.
    let col = if board.meta.columns.contains(&status) {
        status
    } else {
        "backlog".to_string()
    };
    board.meta.order.entry(col).or_default().push(card_id.to_string());
    let mut cards = read_all_cards(project_root, board_id).await?;
    let order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
    board.meta.order = order;
    persist_board(project_root, &mut board, &cards).await?;
    Ok(card)
}

pub async fn get_card(
    project_root: &Path,
    board_id: &str,
    card_id: &str,
) -> Result<Card, StableError> {
    let text = tokio::fs::read_to_string(card_file(project_root, board_id, card_id)?)
        .await
        .map_err(|_| StableError::new(codes::NOT_FOUND, format!("card '{card_id}' not found")))?;
    parse_card(&text)
}

/// vibe-kanban style card filters (search, status, priority, tag, assignee,
/// parent) plus pagination.
#[derive(Debug, Default, Clone)]
pub struct CardFilter {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tag: Option<String>,
    pub assignee: Option<String>,
    pub search: Option<String>,
    pub parent: Option<String>,
    pub include_archived: bool,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CardSort {
    /// Board column order (requires order map; falls back to id).
    #[default]
    Manual,
    Priority,
    Due,
    Title,
}

impl CardSort {
    pub fn parse(s: Option<&str>) -> Self {
        match s {
            Some("priority") => CardSort::Priority,
            Some("due") => CardSort::Due,
            Some("title") => CardSort::Title,
            _ => CardSort::Manual,
        }
    }
}

fn priority_rank(p: &str) -> u8 {
    match p {
        "urgent" => 0,
        "high" => 1,
        "medium" => 2,
        _ => 3,
    }
}

pub async fn list_cards(
    project_root: &Path,
    board_id: &str,
    filter: &CardFilter,
    sort: CardSort,
) -> Result<Vec<Card>, StableError> {
    // Validates board exists.
    let board = read_board(project_root, board_id).await?;
    let mut cards = read_all_cards(project_root, board_id).await?;
    let order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
    let search = filter.search.as_deref().map(|s| s.to_lowercase());
    let mut list: Vec<Card> = cards
        .into_values()
        .filter(|c| filter.include_archived || !c.meta.archived)
        .filter(|c| filter.status.as_deref().map(|s| c.meta.status == s).unwrap_or(true))
        .filter(|c| filter.priority.as_deref().map(|p| c.meta.priority == p).unwrap_or(true))
        .filter(|c| filter.tag.as_deref().map(|t| c.meta.tags.iter().any(|x| x == t)).unwrap_or(true))
        .filter(|c| filter.assignee.as_deref().map(|a| c.meta.assignees.iter().any(|x| x == a)).unwrap_or(true))
        .filter(|c| filter.parent.as_deref().map(|p| c.meta.parent.as_deref() == Some(p)).unwrap_or(true))
        .filter(|c| match &search {
            Some(q) => {
                c.meta.title.to_lowercase().contains(q) || c.body.to_lowercase().contains(q)
            }
            None => true,
        })
        .collect();
    match sort {
        CardSort::Manual => {
            let mut rank: HashMap<String, usize> = HashMap::new();
            let mut next = 0usize;
            for ids in order.values() {
                for id in ids {
                    rank.entry(id.clone()).or_insert_with(|| {
                        let r = next;
                        next += 1;
                        r
                    });
                }
            }
            list.sort_by_key(|c| (rank.get(&c.meta.id).copied().unwrap_or(usize::MAX), c.meta.id.clone()));
        }
        CardSort::Priority => list.sort_by_key(|c| (priority_rank(&c.meta.priority), c.meta.id.clone())),
        CardSort::Due => list.sort_by_key(|c| (c.meta.due.clone().unwrap_or("~".to_string()), c.meta.id.clone())),
        CardSort::Title => list.sort_by_key(|c| c.meta.title.to_lowercase()),
    }
    let offset = filter.offset.unwrap_or(0);
    let list: Vec<Card> = list.into_iter().skip(offset).collect();
    Ok(match filter.limit {
        Some(n) => list.into_iter().take(n).collect(),
        None => list,
    })
}

#[derive(Debug, Default)]
pub struct CardPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
    /// Tri-state: None = no change, Some(None) = clear, Some(Some(id)) = set.
    pub parent: Option<Option<String>>,
    /// Replace entire relation list when present.
    pub relations: Option<Vec<IssueRelation>>,
    pub due: Option<Option<String>>,
    pub archived: Option<bool>,
    pub links: Option<CardLinks>,
}

pub async fn update_card(
    project_root: &Path,
    board_id: &str,
    card_id: &str,
    patch: CardPatch,
) -> Result<Card, StableError> {
    let mut card = get_card(project_root, board_id, card_id).await?;
    if let Some(t) = patch.title {
        let t = t.trim().to_string();
        if t.is_empty() || t.len() > 200 {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "card title 1-200 chars",
            ));
        }
        card.meta.title = t;
    }
    if let Some(b) = patch.body {
        card.body = b;
    }
    if let Some(p) = patch.priority {
        let p = normalize_priority(&p).to_string();
        if !validate_priority(&p) {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "bad priority (urgent|high|medium|low)",
            ));
        }
        card.meta.priority = p;
    }
    if let Some(tags) = patch.tags {
        card.meta.tags = tags;
    }
    if let Some(assignees) = patch.assignees {
        card.meta.assignees = assignees;
    }
    if let Some(parent) = patch.parent {
        let parent = parent.filter(|p| !p.is_empty());
        if let Some(pid) = parent.as_deref() {
            if !validate_id(pid) {
                return Err(StableError::new(codes::INVALID_PATH, "bad parent id"));
            }
            if pid == card_id {
                return Err(StableError::new(
                    codes::SCHEMA_INCOMPATIBLE,
                    "card cannot be its own parent",
                ));
            }
            // Parent must exist on the same board.
            get_card(project_root, board_id, pid).await?;
        }
        card.meta.parent = parent;
    }
    if let Some(relations) = patch.relations {
        check_relations(&relations)?;
        card.meta.relations = relations;
    }
    if let Some(due) = patch.due {
        let due = due.filter(|d| !d.is_empty());
        if !validate_due(&due) {
            return Err(StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "due must be YYYY-MM-DD",
            ));
        }
        card.meta.due = due;
    }
    if let Some(a) = patch.archived {
        card.meta.archived = a;
    }
    if let Some(links) = patch.links {
        for l in links.tasks.iter().chain(&links.files).chain(&links.issues) {
            if l.len() > 200 {
                return Err(StableError::new(
                    codes::SCHEMA_INCOMPATIBLE,
                    "card link refs max 200 chars",
                ));
            }
        }
        for issue in &links.issues {
            if !validate_issue_link(issue) {
                return Err(StableError::new(
                    codes::SCHEMA_INCOMPATIBLE,
                    "issue links must be github:<number> or local:<number>",
                ));
            }
        }
        card.meta.links = links;
    }
    let status_change = match patch.status {
        Some(s) => {
            let s = normalize_status(&s).to_string();
            if !validate_status(&s) {
                return Err(StableError::new(codes::SCHEMA_INCOMPATIBLE, "bad status"));
            }
            if s != card.meta.status {
                card.meta.status = s.clone();
                Some(s)
            } else {
                None
            }
        }
        None => None,
    };
    tokio::fs::write(
        card_file(project_root, board_id, card_id)?,
        serialize_card(&card)?,
    )
    .await
    .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write card: {e}")))?;
    if let Some(to) = status_change {
        // Move to end of new column.
        let mut board = read_board(project_root, board_id).await?;
        migrate_board_columns(&mut board.meta);
        let mut cards = read_all_cards(project_root, board_id).await?;
        let mut order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
        for ids in order.values_mut() {
            ids.retain(|id| id != card_id);
        }
        order.entry(to).or_default().push(card_id.to_string());
        board.meta.order = order;
        persist_board(project_root, &mut board, &cards).await?;
    }
    Ok(card)
}

pub async fn move_card(
    project_root: &Path,
    board_id: &str,
    card_id: &str,
    to: &str,
    position: Option<usize>,
) -> Result<BoardView, StableError> {
    let to = normalize_status(to);
    if !validate_status(to) {
        return Err(StableError::new(codes::SCHEMA_INCOMPATIBLE, "bad status"));
    }
    let mut card = get_card(project_root, board_id, card_id).await?;
    card.meta.status = to.to_string();
    tokio::fs::write(
        card_file(project_root, board_id, card_id)?,
        serialize_card(&card)?,
    )
    .await
    .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write card: {e}")))?;
    let mut board = read_board(project_root, board_id).await?;
    migrate_board_columns(&mut board.meta);
    let mut cards = read_all_cards(project_root, board_id).await?;
    let mut order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
    for ids in order.values_mut() {
        ids.retain(|id| id != card_id);
    }
    let col = order.entry(to.to_string()).or_default();
    match position {
        Some(pos) if pos <= col.len() => col.insert(pos, card_id.to_string()),
        _ => col.push(card_id.to_string()),
    }
    board.meta.order = order.clone();
    persist_board(project_root, &mut board, &cards).await?;
    get_board_view(project_root, board_id).await
}

/// Delete a card: remove its file, prune it from `order`, orphan its children
/// (parent cleared) and strip inbound relations from siblings.
pub async fn delete_card(
    project_root: &Path,
    board_id: &str,
    card_id: &str,
) -> Result<(), StableError> {
    // Validates existence.
    get_card(project_root, board_id, card_id).await?;
    tokio::fs::remove_file(card_file(project_root, board_id, card_id)?)
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("delete card: {e}")))?;
    let mut cards = read_all_cards(project_root, board_id).await?;
    // Orphan children + strip inbound relations, persisting touched cards.
    let mut touched: Vec<Card> = Vec::new();
    for card in cards.values_mut() {
        let mut dirty = false;
        if card.meta.parent.as_deref() == Some(card_id) {
            card.meta.parent = None;
            dirty = true;
        }
        let before = card.meta.relations.len();
        card.meta.relations.retain(|r| r.to != card_id);
        if card.meta.relations.len() != before {
            dirty = true;
        }
        if dirty {
            touched.push(card.clone());
        }
    }
    for card in &touched {
        tokio::fs::write(
            card_file(project_root, board_id, &card.meta.id)?,
            serialize_card(card)?,
        )
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("write card: {e}")))?;
    }
    let mut board = read_board(project_root, board_id).await?;
    migrate_board_columns(&mut board.meta);
    let mut order = reconcile(&board.meta.columns, &board.meta.order, &mut cards);
    for ids in order.values_mut() {
        ids.retain(|id| id != card_id);
    }
    board.meta.order = order;
    persist_board(project_root, &mut board, &cards).await?;
    Ok(())
}

/// Delete an entire board directory.
pub async fn delete_board(project_root: &Path, board_id: &str) -> Result<(), StableError> {
    // Validates existence.
    read_board(project_root, board_id).await?;
    tokio::fs::remove_dir_all(board_dir(project_root, board_id)?)
        .await
        .map_err(|e| StableError::new(codes::MOVE_FAILED, format!("delete board: {e}")))?;
    Ok(())
}

fn validate_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Set (or overwrite) a project-scoped tag color on a board.
pub async fn set_tag_color(
    project_root: &Path,
    board_id: &str,
    name: &str,
    color: &str,
) -> Result<(), StableError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "tag name 1-64 chars",
        ));
    }
    if !validate_color(color) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "color must be #rrggbb",
        ));
    }
    let mut board = read_board(project_root, board_id).await?;
    migrate_board_columns(&mut board.meta);
    board.meta.tag_colors.insert(name.to_string(), color.to_string());
    let cards = read_all_cards(project_root, board_id).await?;
    persist_board(project_root, &mut board, &cards).await?;
    Ok(())
}

/// All tags used on a board with colors + usage counts.
pub async fn list_tags(
    project_root: &Path,
    board_id: &str,
) -> Result<Vec<crate::kanban::model::TagInfo>, StableError> {
    let board = read_board(project_root, board_id).await?;
    let cards = read_all_cards(project_root, board_id).await?;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for card in cards.values().filter(|c| !c.meta.archived) {
        for tag in &card.meta.tags {
            *counts.entry(tag.clone()).or_default() += 1;
        }
    }
    let mut out: Vec<crate::kanban::model::TagInfo> = counts
        .into_iter()
        .map(|(name, count)| crate::kanban::model::TagInfo {
            color: board.meta.tag_colors.get(&name).cloned(),
            name,
            count,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
