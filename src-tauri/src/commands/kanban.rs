use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::error::StableError;
use crate::kanban::model::{
    slugify, validate_id, BoardSummary, BoardView, Card, CardLinks, IssueRelation, TagInfo,
};
use crate::kanban::store;

async fn project_root(db: &State<'_, DbInstances>, project: &str) -> Result<std::path::PathBuf, StableError> {
    let pool = crate::db::sqlite_pool(&*db).await?;
    // Reuse MCP resolver: id, name, or absolute path.
    store::resolve_project_root(&pool, project).await
}

#[tauri::command]
pub async fn kanban_list_boards(
    db: State<'_, DbInstances>,
    project: String,
) -> Result<Vec<BoardSummary>, StableError> {
    let root = project_root(&db, &project).await?;
    store::list_boards(&root).await
}

/// Tauri arg names stay camelCase to match the frontend invoke payloads.
#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_get_board(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
) -> Result<BoardView, StableError> {
    let root = project_root(&db, &project).await?;
    store::get_board_view(&root, &boardId).await
}

#[derive(Debug, Deserialize)]
pub struct CreateBoardInput {
    #[serde(rename = "project")]
    pub project: String,
    #[serde(rename = "boardId")]
    pub board_id: Option<String>,
    pub title: String,
}

#[tauri::command]
pub async fn kanban_create_board(
    db: State<'_, DbInstances>,
    input: CreateBoardInput,
) -> Result<BoardView, StableError> {
    let root = project_root(&db, &input.project).await?;
    let id = match input.board_id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => slugify(&input.title),
    };
    if !validate_id(&id) {
        return Err(StableError::new(
            crate::error::codes::INVALID_PATH,
            "board id must match ^[a-z0-9-]{1,64}$",
        ));
    }
    store::create_board(&root, &id, &input.title).await?;
    store::get_board_view(&root, &id).await
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateCardInput {
    pub project: String,
    #[serde(rename = "boardId")]
    pub board_id: String,
    #[serde(rename = "cardId")]
    pub card_id: Option<String>,
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

#[tauri::command]
pub async fn kanban_create_card(
    db: State<'_, DbInstances>,
    input: CreateCardInput,
) -> Result<Card, StableError> {
    let root = project_root(&db, &input.project).await?;
    let id = match input.card_id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => slugify(&input.title),
    };
    store::create_card(
        &root,
        &input.board_id,
        &id,
        store::NewCard {
            title: input.title,
            body: input.body,
            status: input.status,
            priority: input.priority,
            tags: input.tags,
            assignees: input.assignees,
            parent: input.parent,
            relations: input.relations,
            due: input.due,
        },
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct CardPatchInput {
    pub project: String,
    #[serde(rename = "boardId")]
    pub board_id: String,
    #[serde(rename = "cardId")]
    pub card_id: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
    // Tri-state: missing = no change, null = clear, string = set.
    #[serde(default)]
    pub parent: Option<Option<String>>,
    #[serde(default)]
    pub relations: Option<Vec<IssueRelation>>,
    // Tri-state: missing = no change, null = clear, string = set.
    #[serde(default)]
    pub due: Option<Option<String>>,
    pub archived: Option<bool>,
    #[serde(default)]
    pub links: Option<CardLinks>,
}

#[tauri::command]
pub async fn kanban_update_card(
    db: State<'_, DbInstances>,
    input: CardPatchInput,
) -> Result<Card, StableError> {
    let root = project_root(&db, &input.project).await?;
    store::update_card(
        &root,
        &input.board_id,
        &input.card_id,
        store::CardPatch {
            title: input.title,
            body: input.body,
            status: input.status,
            priority: input.priority,
            tags: input.tags,
            assignees: input.assignees,
            parent: input.parent,
            relations: input.relations,
            due: input.due,
            archived: input.archived,
            links: input.links,
        },
    )
    .await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_move_card(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
    cardId: String,
    to: String,
    position: Option<usize>,
) -> Result<BoardView, StableError> {
    let root = project_root(&db, &project).await?;
    store::move_card(&root, &boardId, &cardId, &to, position).await
}

#[derive(Debug, Deserialize)]
pub struct ListCardsInput {
    pub project: String,
    #[serde(rename = "boardId")]
    pub board_id: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tag: Option<String>,
    pub assignee: Option<String>,
    pub search: Option<String>,
    pub parent: Option<String>,
    #[serde(rename = "includeArchived")]
    pub include_archived: Option<bool>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub sort: Option<String>,
}

#[tauri::command]
pub async fn kanban_list_cards(
    db: State<'_, DbInstances>,
    input: ListCardsInput,
) -> Result<Vec<Card>, StableError> {
    let root = project_root(&db, &input.project).await?;
    store::list_cards(
        &root,
        &input.board_id,
        &store::CardFilter {
            status: input.status,
            priority: input.priority,
            tag: input.tag,
            assignee: input.assignee,
            search: input.search,
            parent: input.parent,
            include_archived: input.include_archived.unwrap_or(false),
            limit: input.limit,
            offset: input.offset,
        },
        store::CardSort::parse(input.sort.as_deref()),
    )
    .await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_delete_card(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
    cardId: String,
) -> Result<(), StableError> {
    let root = project_root(&db, &project).await?;
    store::delete_card(&root, &boardId, &cardId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_delete_board(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
) -> Result<(), StableError> {
    let root = project_root(&db, &project).await?;
    store::delete_board(&root, &boardId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_list_tags(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
) -> Result<Vec<TagInfo>, StableError> {
    let root = project_root(&db, &project).await?;
    store::list_tags(&root, &boardId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn kanban_set_tag_color(
    db: State<'_, DbInstances>,
    project: String,
    boardId: String,
    name: String,
    color: String,
) -> Result<(), StableError> {
    let root = project_root(&db, &project).await?;
    store::set_tag_color(&root, &boardId, &name, &color).await
}
