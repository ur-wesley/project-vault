use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use sqlx::{Pool, Sqlite};

use crate::kanban::model::{slugify, CardLinks, IssueRelation};
use crate::kanban::store;
use crate::mcp::protocol::CallToolResult;
use crate::mcp::tool::McpTool;

fn pretty(v: &impl serde::Serialize) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

async fn root(pool: &Pool<Sqlite>, project: &str) -> Result<std::path::PathBuf, CallToolResult> {
    store::resolve_project_root(pool, project)
        .await
        .map_err(|e| CallToolResult::error(format!("{e}")))
}

// --- list_boards ---
pub struct KanbanListBoards;
#[async_trait]
impl McpTool for KanbanListBoards {
    fn name(&self) -> &'static str {
        "list_boards"
    }
    fn description(&self) -> &'static str {
        "List kanban boards for a project (markdown-backed, .vault/kanban)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "project": { "type": "string", "description": "Project ID, name, or absolute path" } },
            "required": ["project"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::list_boards(&root).await {
            Ok(b) => CallToolResult::text(pretty(&b)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- get_board ---
pub struct KanbanGetBoard;
#[async_trait]
impl McpTool for KanbanGetBoard {
    fn name(&self) -> &'static str {
        "get_board"
    }
    fn description(&self) -> &'static str {
        "Get a kanban board with all embedded cards and column order."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" }
            },
            "required": ["project", "board_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::get_board_view(&root, &p.board_id).await {
            Ok(b) => CallToolResult::text(pretty(&b)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- list_cards ---
pub struct KanbanListCards;
#[async_trait]
impl McpTool for KanbanListCards {
    fn name(&self) -> &'static str {
        "list_cards"
    }
    fn description(&self) -> &'static str {
        "List cards on a kanban board with vibe-kanban style filters, sorting, and pagination."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "status": { "type": "string", "description": "backlog|todo|doing|review|done|cancelled" },
                "priority": { "type": "string", "description": "urgent|high|medium|low" },
                "tag": { "type": "string" },
                "assignee": { "type": "string" },
                "search": { "type": "string", "description": "matches title + body" },
                "parent": { "type": "string", "description": "only sub-issues of this card" },
                "include_archived": { "type": "boolean" },
                "sort": { "type": "string", "description": "manual|priority|due|title" },
                "limit": { "type": "integer", "minimum": 1 },
                "offset": { "type": "integer", "minimum": 0 }
            },
            "required": ["project", "board_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            status: Option<String>,
            priority: Option<String>,
            tag: Option<String>,
            assignee: Option<String>,
            search: Option<String>,
            parent: Option<String>,
            include_archived: Option<bool>,
            sort: Option<String>,
            limit: Option<usize>,
            offset: Option<usize>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::list_cards(
            &root,
            &p.board_id,
            &store::CardFilter {
                status: p.status,
                priority: p.priority,
                tag: p.tag,
                assignee: p.assignee,
                search: p.search,
                parent: p.parent,
                include_archived: p.include_archived.unwrap_or(false),
                limit: p.limit,
                offset: p.offset,
            },
            store::CardSort::parse(p.sort.as_deref()),
        )
        .await
        {
            Ok(c) => CallToolResult::text(pretty(&c)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- get_card ---
pub struct KanbanGetCard;
#[async_trait]
impl McpTool for KanbanGetCard {
    fn name(&self) -> &'static str {
        "get_card"
    }
    fn description(&self) -> &'static str {
        "Read a single kanban card (frontmatter + markdown body)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" }
            },
            "required": ["project", "board_id", "card_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::get_card(&root, &p.board_id, &p.card_id).await {
            Ok(card) => {
                let v = json!({ "meta": card.meta, "body": card.body });
                CallToolResult::text(pretty(&v))
            }
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- create_card ---
pub struct KanbanCreateCard;
#[async_trait]
impl McpTool for KanbanCreateCard {
    fn name(&self) -> &'static str {
        "create_card"
    }
    fn description(&self) -> &'static str {
        "Create a kanban card on a board (markdown file + board order update)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "status": { "type": "string", "description": "backlog|todo|doing|review|done|cancelled" },
                "priority": { "type": "string", "description": "urgent|high|medium|low" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "assignees": { "type": "array", "items": { "type": "string" } },
                "parent": { "type": "string", "description": "parent card id (sub-issue)" },
                "relations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "to": { "type": "string" },
                            "kind": { "type": "string", "description": "blocking|related|duplicate" }
                        },
                        "required": ["to", "kind"]
                    }
                },
                "due": { "type": "string", "description": "YYYY-MM-DD" }
            },
            "required": ["project", "board_id", "title"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            title: String,
            body: Option<String>,
            status: Option<String>,
            priority: Option<String>,
            tags: Option<Vec<String>>,
            assignees: Option<Vec<String>>,
            parent: Option<String>,
            relations: Option<Vec<IssueRelation>>,
            due: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        let id = slugify(&p.title);
        match store::create_card(
            &root,
            &p.board_id,
            &id,
            store::NewCard {
                title: p.title,
                body: p.body,
                status: p.status,
                priority: p.priority,
                tags: p.tags,
                assignees: p.assignees,
                parent: p.parent,
                relations: p.relations,
                due: p.due,
            },
        )
        .await
        {
            Ok(c) => CallToolResult::text(pretty(&c.meta)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- update_card ---
pub struct KanbanUpdateCard;
#[async_trait]
impl McpTool for KanbanUpdateCard {
    fn name(&self) -> &'static str {
        "update_card"
    }
    fn description(&self) -> &'static str {
        "Patch a kanban card (title/body/status/priority/tags/assignees/parent/relations/due/archived/links)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "status": { "type": "string" },
                "priority": { "type": "string" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "assignees": { "type": "array", "items": { "type": "string" } },
                "parent": { "type": ["string", "null"], "description": "null clears the parent" },
                "relations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "to": { "type": "string" },
                            "kind": { "type": "string" }
                        },
                        "required": ["to", "kind"]
                    }
                },
                "due": { "type": ["string", "null"] },
                "archived": { "type": "boolean" },
                "links": {
                    "type": "object",
                    "properties": {
                        "tasks": { "type": "array", "items": { "type": "string" } },
                        "files": { "type": "array", "items": { "type": "string" } },
                        "issues": { "type": "array", "items": { "type": "string" } }
                    }
                }
            },
            "required": ["project", "board_id", "card_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
            title: Option<String>,
            body: Option<String>,
            status: Option<String>,
            priority: Option<String>,
            tags: Option<Vec<String>>,
            assignees: Option<Vec<String>>,
            #[serde(default)]
            parent: Option<Option<String>>,
            relations: Option<Vec<IssueRelation>>,
            #[serde(default)]
            due: Option<Option<String>>,
            archived: Option<bool>,
            #[serde(default)]
            links: Option<CardLinks>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        // `due`/`parent` are tri-state via Option<Option<String>>: missing = no
        // change, null = clear, string = set.
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::update_card(
            &root,
            &p.board_id,
            &p.card_id,
            store::CardPatch {
                title: p.title,
                body: p.body,
                status: p.status,
                priority: p.priority,
                tags: p.tags,
                assignees: p.assignees,
                parent: p.parent,
                relations: p.relations,
                due: p.due,
                archived: p.archived,
                links: p.links,
            },
        )
        .await
        {
            Ok(c) => CallToolResult::text(pretty(&c.meta)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- move_card ---
pub struct KanbanMoveCard;
#[async_trait]
impl McpTool for KanbanMoveCard {
    fn name(&self) -> &'static str {
        "move_card"
    }
    fn description(&self) -> &'static str {
        "Move a kanban card to another column (optionally at a position)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" },
                "to": { "type": "string", "description": "backlog|todo|doing|review|done|cancelled" },
                "position": { "type": "integer", "minimum": 0 }
            },
            "required": ["project", "board_id", "card_id", "to"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
            to: String,
            position: Option<usize>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::move_card(&root, &p.board_id, &p.card_id, &p.to, p.position).await {
            Ok(v) => CallToolResult::text(pretty(&v)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- delete_card ---
pub struct KanbanDeleteCard;
#[async_trait]
impl McpTool for KanbanDeleteCard {
    fn name(&self) -> &'static str {
        "delete_card"
    }
    fn description(&self) -> &'static str {
        "Delete a kanban card (children are orphaned, inbound relations stripped)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" }
            },
            "required": ["project", "board_id", "card_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::delete_card(&root, &p.board_id, &p.card_id).await {
            Ok(()) => CallToolResult::text(format!("deleted card '{}'", p.card_id)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- delete_board ---
pub struct KanbanDeleteBoard;
#[async_trait]
impl McpTool for KanbanDeleteBoard {
    fn name(&self) -> &'static str {
        "delete_board"
    }
    fn description(&self) -> &'static str {
        "Delete an entire kanban board with all its cards."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" }
            },
            "required": ["project", "board_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::delete_board(&root, &p.board_id).await {
            Ok(()) => CallToolResult::text(format!("deleted board '{}'", p.board_id)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- list_tags ---
pub struct KanbanListTags;
#[async_trait]
impl McpTool for KanbanListTags {
    fn name(&self) -> &'static str {
        "list_tags"
    }
    fn description(&self) -> &'static str {
        "List tags used on a board with colors and usage counts."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" }
            },
            "required": ["project", "board_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::list_tags(&root, &p.board_id).await {
            Ok(t) => CallToolResult::text(pretty(&t)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- set_tag_color ---
pub struct KanbanSetTagColor;
#[async_trait]
impl McpTool for KanbanSetTagColor {
    fn name(&self) -> &'static str {
        "set_tag_color"
    }
    fn description(&self) -> &'static str {
        "Set a board-scoped tag color (#rrggbb)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "name": { "type": "string" },
                "color": { "type": "string", "description": "#rrggbb" }
            },
            "required": ["project", "board_id", "name", "color"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            name: String,
            color: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        match store::set_tag_color(&root, &p.board_id, &p.name, &p.color).await {
            Ok(()) => CallToolResult::text(format!("tag '{}' -> {}", p.name, p.color)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- create_relation ---
pub struct KanbanCreateRelation;
#[async_trait]
impl McpTool for KanbanCreateRelation {
    fn name(&self) -> &'static str {
        "create_relation"
    }
    fn description(&self) -> &'static str {
        "Link two cards (blocking|related|duplicate)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" },
                "to": { "type": "string" },
                "kind": { "type": "string", "description": "blocking|related|duplicate" }
            },
            "required": ["project", "board_id", "card_id", "to", "kind"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
            to: String,
            kind: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        let card = match store::get_card(&root, &p.board_id, &p.card_id).await {
            Ok(c) => c,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let mut relations = card.meta.relations;
        if relations.iter().any(|r| r.to == p.to && r.kind == p.kind) {
            return CallToolResult::text("relation already exists");
        }
        relations.push(IssueRelation { to: p.to, kind: p.kind });
        match store::update_card(
            &root,
            &p.board_id,
            &p.card_id,
            store::CardPatch { relations: Some(relations), ..Default::default() },
        )
        .await
        {
            Ok(c) => CallToolResult::text(pretty(&c.meta.relations)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- delete_relation ---
pub struct KanbanDeleteRelation;
#[async_trait]
impl McpTool for KanbanDeleteRelation {
    fn name(&self) -> &'static str {
        "delete_relation"
    }
    fn description(&self) -> &'static str {
        "Remove a card relation by target id (all kinds unless `kind` given)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" },
                "to": { "type": "string" },
                "kind": { "type": "string" }
            },
            "required": ["project", "board_id", "card_id", "to"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            board_id: String,
            card_id: String,
            to: String,
            kind: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let root = match root(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return e,
        };
        let card = match store::get_card(&root, &p.board_id, &p.card_id).await {
            Ok(c) => c,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let relations: Vec<IssueRelation> = card
            .meta
            .relations
            .into_iter()
            .filter(|r| r.to != p.to || p.kind.as_deref().map(|k| r.kind != k).unwrap_or(false))
            .collect();
        match store::update_card(
            &root,
            &p.board_id,
            &p.card_id,
            store::CardPatch { relations: Some(relations), ..Default::default() },
        )
        .await
        {
            Ok(c) => CallToolResult::text(pretty(&c.meta.relations)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}
