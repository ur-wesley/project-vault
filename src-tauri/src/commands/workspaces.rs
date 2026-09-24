use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::StableError;
use crate::kanban::store as kanban_store;
use crate::models::{AgentSessionDto, WorkspaceDto};
use crate::spawn::{EmbeddedTerminals, TerminalBuffers, TaskMonitors};
use crate::workspaces::{
    executors,
    service::{self, card_prompt, resolve_project},
    worktree,
};

async fn pool(db: &State<'_, DbInstances>) -> Result<sqlx::Pool<sqlx::Sqlite>, StableError> {
    db::sqlite_pool(&*db).await
}

/// Append/remove a workspace id in a card's `links.workspaces`. Best-effort:
/// never fails workspace ops when the card is gone.
async fn sync_card_link(
    project_path: &PathBuf,
    board_id: &str,
    card_id: &str,
    ws_id: &str,
    add: bool,
) {
    let Ok(card) = kanban_store::get_card(project_path, board_id, card_id).await else {
        return;
    };
    let mut links = card.meta.links.workspaces;
    if add {
        if !links.iter().any(|w| w == ws_id) {
            links.push(ws_id.to_string());
        }
    } else {
        links.retain(|w| w != ws_id);
    }
    let _ = kanban_store::update_card(
        project_path,
        board_id,
        card_id,
        kanban_store::CardPatch {
            links: Some(crate::kanban::model::CardLinks {
                tasks: card.meta.links.tasks,
                files: card.meta.links.files,
                issues: card.meta.links.issues,
                workspaces: links,
            }),
            ..Default::default()
        },
    )
    .await;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDetail {
    pub workspace: WorkspaceDto,
    pub sessions: Vec<AgentSessionDto>,
    pub changes: Vec<crate::commands::git::GitChangedFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionView {
    pub session: AgentSessionDto,
    pub live_status: String,
    pub exit_code: Option<i32>,
    pub output_tail: String,
}

async fn detail(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    monitors: &TaskMonitors,
    ws: WorkspaceDto,
) -> Result<WorkspaceDetail, StableError> {
    let sessions = db::list_agent_sessions(pool, &ws.id).await?;
    for s in &sessions {
        let _ = service::sync_session_status(pool, monitors, s).await;
    }
    let sessions = db::list_agent_sessions(pool, &ws.id).await?;
    let changes = crate::commands::git::changed_files_in(std::path::Path::new(&ws.worktree_path))
        .await
        .unwrap_or_default();
    let workspace = db::get_workspace(pool, &ws.id).await?;
    Ok(WorkspaceDetail { workspace, sessions, changes })
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_list(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    project: Option<String>,
    includeArchived: Option<bool>,
    boardId: Option<String>,
    cardId: Option<String>,
) -> Result<Vec<WorkspaceDto>, StableError> {
    let pool = pool(&db).await?;
    let project_id = match project {
        Some(p) if !p.trim().is_empty() => Some(resolve_project(&pool, &p).await?.0),
        _ => None,
    };
    let mut list = db::list_workspaces(
        &pool,
        project_id.as_deref(),
        includeArchived.unwrap_or(false),
        boardId.as_deref(),
        cardId.as_deref(),
    )
    .await?;
    for ws in &mut list {
        let sessions = db::list_agent_sessions(&pool, &ws.id).await?;
        for s in &sessions {
            let _ = service::sync_session_status(&pool, &monitors, s).await;
        }
        if let Ok(fresh) = db::get_workspace(&pool, &ws.id).await {
            ws.status = fresh.status;
        }
    }
    Ok(list)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_get(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    workspaceId: String,
) -> Result<WorkspaceDetail, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    detail(&pool, &monitors, ws).await
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceInput {
    pub project: String,
    pub name: String,
    #[serde(rename = "repoPath")]
    pub repo_path: Option<String>,
    #[serde(rename = "boardId")]
    pub board_id: Option<String>,
    #[serde(rename = "cardId")]
    pub card_id: Option<String>,
    pub executor: Option<String>,
    pub prompt: Option<String>,
    #[serde(rename = "baseBranch")]
    pub base_branch: Option<String>,
}

#[tauri::command]
pub async fn workspace_create(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    buffers: State<'_, TerminalBuffers>,
    monitors: State<'_, TaskMonitors>,
    input: CreateWorkspaceInput,
) -> Result<WorkspaceDetail, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (&app, &terms, &buffers, &monitors, &input);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "workspaces not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let pool = pool(&db).await?;
        let (project_id, project_path) = resolve_project(&pool, &input.project).await?;
        let repo_path = input
            .repo_path
            .map(PathBuf::from)
            .unwrap_or_else(|| project_path.clone());
        let ws = service::create_workspace(
            &pool,
            service::CreateWorkspaceInput {
                project_id: project_id.clone(),
                name: input.name,
                repo_path,
                card_board: input.board_id.clone(),
                card_id: input.card_id.clone(),
                base_branch: input.base_branch,
            },
        )
        .await?;
        if let (Some(board), Some(card)) = (input.board_id.as_deref(), input.card_id.as_deref()) {
            sync_card_link(&project_path, board, card, &ws.id, true).await;
        }
        // vibe-kanban `start_workspace`: first agent session spins up with the
        // card text as prompt when no explicit prompt/executor is rejected.
        let prompt = match input.prompt.filter(|p| !p.trim().is_empty()) {
            Some(p) => Some(p),
            None => match (input.board_id.as_deref(), input.card_id.as_deref()) {
                (Some(board), Some(card)) => Some(card_prompt(&project_path, board, card).await?),
                _ => None,
            },
        };
        if let Some(executor) = input.executor {
            if let Some(p) = prompt {
                service::start_agent_session(
                    &app, &pool, &terms, &buffers, &monitors, &ws, &executor, &p,
                )
                .await?;
            }
        }
        detail(&pool, &monitors, ws).await
    }
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn session_create(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    buffers: State<'_, TerminalBuffers>,
    monitors: State<'_, TaskMonitors>,
    workspaceId: String,
    executor: Option<String>,
    prompt: Option<String>,
) -> Result<AgentSessionDto, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (&app, &terms, &buffers, &monitors, &workspaceId, &executor, &prompt);
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            "workspaces not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let pool = pool(&db).await?;
        let ws = db::get_workspace(&pool, &workspaceId).await?;
        let executor = match executor.filter(|e| !e.trim().is_empty()) {
            Some(e) => e,
            None => {
                let sessions = db::list_agent_sessions(&pool, &ws.id).await?;
                sessions
                    .last()
                    .map(|s| s.executor.clone())
                    .or_else(|| {
                        executors::probe_all()
                            .into_iter()
                            .find(|e| e.available)
                            .map(|e| e.id)
                    })
                    .unwrap_or_else(|| "opencode".to_string())
            }
        };
        let prompt = match prompt.filter(|p| !p.trim().is_empty()) {
            Some(p) => p,
            None => match (ws.card_board.as_deref(), ws.card_id.as_deref()) {
                (Some(board), Some(card)) => {
                    let project = db::get_project(&pool, &ws.project_id).await?;
                    card_prompt(&PathBuf::from(project.path), board, card).await?
                }
                _ => {
                    return Err(StableError::new(
                        crate::error::codes::SCHEMA_INCOMPATIBLE,
                        "prompt required (workspace has no linked card)",
                    ))
                }
            },
        };
        service::start_agent_session(&app, &pool, &terms, &buffers, &monitors, &ws, &executor, &prompt)
            .await
    }
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn session_list(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    workspaceId: String,
) -> Result<Vec<AgentSessionDto>, StableError> {
    let pool = pool(&db).await?;
    let _ = db::get_workspace(&pool, &workspaceId).await?;
    let sessions = db::list_agent_sessions(&pool, &workspaceId).await?;
    for s in &sessions {
        let _ = service::sync_session_status(&pool, &monitors, s).await;
    }
    db::list_agent_sessions(&pool, &workspaceId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn session_prompt(
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    monitors: State<'_, TaskMonitors>,
    sessionId: String,
    prompt: String,
) -> Result<(), StableError> {
    let pool = pool(&db).await?;
    let session = db::get_agent_session(&pool, &sessionId).await?;
    service::session_prompt(&pool, &terms, &monitors, &session, &prompt).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn session_stop(
    app: AppHandle,
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    sessionId: String,
) -> Result<AgentSessionDto, StableError> {
    let pool = pool(&db).await?;
    let session = db::get_agent_session(&pool, &sessionId).await?;
    let _ = crate::spawn::task_monitor::request_stop(app, &monitors, &session.pty_session_id).await;
    db::set_agent_session_status(&pool, &session.id, "stopped").await?;
    service::sync_workspace_status(&pool, &monitors, &session.workspace_id).await?;
    db::get_agent_session(&pool, &sessionId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn session_get(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    buffers: State<'_, TerminalBuffers>,
    sessionId: String,
) -> Result<ExecutionView, StableError> {
    let pool = pool(&db).await?;
    let session = db::get_agent_session(&pool, &sessionId).await?;
    let live_status = service::sync_session_status(&pool, &monitors, &session).await?;
    let session = db::get_agent_session(&pool, &sessionId).await?;
    let exit_code = crate::spawn::task_monitor::snapshot_task(&monitors, &session.pty_session_id)
        .and_then(|e| e.exit_code);
    let output_tail = service::buffer_tail(&buffers, &session.pty_session_id, 8000);
    Ok(ExecutionView { session, live_status, exit_code, output_tail })
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_delete(
    app: AppHandle,
    db: State<'_, DbInstances>,
    terms: State<'_, EmbeddedTerminals>,
    monitors: State<'_, TaskMonitors>,
    workspaceId: String,
    deleteBranch: Option<bool>,
) -> Result<(), StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    service::delete_workspace_full(&app, &pool, &terms, &monitors, &ws).await?;
    if deleteBranch.unwrap_or(false) {
        let _ = worktree::delete_branch(std::path::Path::new(&ws.repo_path), &ws.branch);
    }
    if let (Some(board), Some(card)) = (ws.card_board.as_deref(), ws.card_id.as_deref()) {
        if let Ok(project) = db::get_project(&pool, &ws.project_id).await {
            sync_card_link(&PathBuf::from(project.path), board, card, &ws.id, false).await;
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_archive(
    db: State<'_, DbInstances>,
    workspaceId: String,
    archived: bool,
) -> Result<WorkspaceDto, StableError> {
    let pool = pool(&db).await?;
    let _ = db::get_workspace(&pool, &workspaceId).await?;
    db::archive_workspace(&pool, &workspaceId, archived).await?;
    db::get_workspace(&pool, &workspaceId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_link_card(
    db: State<'_, DbInstances>,
    workspaceId: String,
    boardId: Option<String>,
    cardId: Option<String>,
) -> Result<WorkspaceDto, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    let project = db::get_project(&pool, &ws.project_id).await?;
    let project_path = PathBuf::from(&project.path);
    // Unlink from the previously linked card first.
    if let (Some(old_board), Some(old_card)) = (ws.card_board.as_deref(), ws.card_id.as_deref()) {
        let still_same = boardId.as_deref() == Some(old_board) && cardId.as_deref() == Some(old_card);
        if !still_same {
            sync_card_link(&project_path, old_board, old_card, &ws.id, false).await;
        }
    }
    match (boardId.as_deref(), cardId.as_deref()) {
        (Some(board), Some(card)) => {
            // Validates the card exists before linking.
            kanban_store::get_card(&project_path, board, card).await?;
            db::set_workspace_card(&pool, &workspaceId, Some(board), Some(card)).await?;
            sync_card_link(&project_path, board, card, &ws.id, true).await;
        }
        _ => {
            db::set_workspace_card(&pool, &workspaceId, None, None).await?;
        }
    }
    db::get_workspace(&pool, &workspaceId).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_changes(
    db: State<'_, DbInstances>,
    workspaceId: String,
) -> Result<Vec<crate::commands::git::GitChangedFile>, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    crate::commands::git::changed_files_in(std::path::Path::new(&ws.worktree_path)).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_file_diff(
    db: State<'_, DbInstances>,
    workspaceId: String,
    file: String,
) -> Result<crate::commands::git::GitFileDiff, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    crate::commands::git::file_diff_in(std::path::Path::new(&ws.worktree_path), &file).await
}

#[tauri::command]
pub async fn executors_list() -> Result<Vec<executors::ExecutorInfo>, StableError> {
    Ok(executors::probe_all())
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_push(
    db: State<'_, DbInstances>,
    workspaceId: String,
) -> Result<(), StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    worktree::push_branch(std::path::Path::new(&ws.worktree_path), &ws.branch).await
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn workspace_git_info(
    db: State<'_, DbInstances>,
    workspaceId: String,
) -> Result<worktree::RepoInfo, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &workspaceId).await?;
    Ok(worktree::repo_info(std::path::Path::new(&ws.worktree_path)))
}

#[derive(Debug, Deserialize)]
pub struct CreatePrInput {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub base: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn pr_create(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    input: CreatePrInput,
) -> Result<crate::workspaces::pr::CreatedPr, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &input.workspace_id).await?;
    let wt = std::path::PathBuf::from(&ws.worktree_path);
    let info = worktree::repo_info(&wt);
    let (owner, repo) = info.owner.zip(info.repo).ok_or_else(|| {
        StableError::new(
            crate::error::codes::SCHEMA_INCOMPATIBLE,
            "no GitHub origin remote on this repository",
        )
    })?;
    let base = input.base.filter(|b| !b.trim().is_empty()).unwrap_or(info.base);
    // Title/body default to the linked card; body template includes stats.
    let (title, body) = match (&input.title, &input.body) {
        (Some(t), Some(b)) => (t.clone(), b.clone()),
        _ => {
            let (card_title, card_body) = match (ws.card_board.as_deref(), ws.card_id.as_deref()) {
                (Some(board), Some(card)) => {
                    let project = db::get_project(&pool, &ws.project_id).await?;
                    match kanban_store::get_card(std::path::Path::new(&project.path), board, card).await {
                        Ok(c) => (c.meta.title, c.body),
                        Err(_) => (ws.name.clone(), String::new()),
                    }
                }
                _ => (ws.name.clone(), String::new()),
            };
            let changes = crate::commands::git::changed_files_in(&wt).await.unwrap_or_default();
            let stats: Vec<(String, u32, u32)> = changes
                .into_iter()
                .map(|f| (f.path, f.additions, f.deletions))
                .collect();
            (
                input.title.unwrap_or(card_title.clone()),
                input.body.unwrap_or_else(|| {
                    crate::workspaces::pr::build_pr_body(&card_title, &card_body, &ws.branch, &base, &stats)
                }),
            )
        }
    };
    // Push first so the head exists remotely (idempotent when up to date).
    worktree::push_branch(&wt, &ws.branch).await?;
    let pr = crate::workspaces::pr::create_pr(&pool, &owner, &repo, &ws.branch, &base, &title, &body).await?;
    let _ = service::sync_workspace_status(&pool, &monitors, &ws.id).await;
    Ok(pr)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn pr_status(
    db: State<'_, DbInstances>,
    owner: String,
    repo: String,
    number: u64,
) -> Result<crate::workspaces::pr::PrStatus, StableError> {
    let pool = pool(&db).await?;
    crate::workspaces::pr::pr_status(&pool, &owner, &repo, number).await
}

#[derive(Debug, Deserialize)]
pub struct MergePrInput {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub method: Option<String>,
}

#[tauri::command]
pub async fn pr_merge(
    db: State<'_, DbInstances>,
    monitors: State<'_, TaskMonitors>,
    input: MergePrInput,
) -> Result<bool, StableError> {
    let pool = pool(&db).await?;
    let ws = db::get_workspace(&pool, &input.workspace_id).await?;
    let merged = crate::workspaces::pr::merge_pr(
        &pool,
        &input.owner,
        &input.repo,
        input.number,
        input.method.as_deref().unwrap_or("merge"),
    )
    .await?;
    if merged {
        // Merged upstream: card → done, workspace archived (worktree kept
        // until an explicit delete so the diff stays reviewable).
        service::apply_merge_automation(&pool, &ws).await;
    }
    Ok(merged)
}
