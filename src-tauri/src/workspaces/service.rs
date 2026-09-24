use std::path::{Path, PathBuf};

use sqlx::{Pool, Sqlite};
use tauri::AppHandle;

use crate::db;
use crate::error::{codes, StableError};
use crate::kanban::model::slugify;
use crate::kanban::store::{self as kanban_store, CardPatch};
use crate::models::{AgentSessionDto, WorkspaceDto};
use crate::spawn::task_monitor::{snapshot_task, TaskMonitors};
use crate::spawn::{EmbeddedTerminals, TerminalBuffers};
use crate::workspaces::executors::{self, Executor};
use crate::workspaces::worktree;

/// Worktrees live project-locally and are hidden from `git status`.
pub const WORKTREE_EXCLUDE_PATTERN: &str = ".vault/worktrees/";

pub fn worktree_base(repo: &Path) -> PathBuf {
    repo.join(".vault").join("worktrees")
}

pub fn slug_branch(card_id: Option<&str>, name: &str, short: &str) -> String {
    let owned;
    let stem = match card_id {
        Some(id) => id,
        None => {
            owned = slugify(name);
            &owned
        }
    };
    format!("pv/{stem}-{short}")
}

/// Resolve (project_id, project_path) from id, name, or absolute path.
/// Shared by Tauri commands and MCP tools.
pub async fn resolve_project(
    pool: &Pool<Sqlite>,
    id_or_path: &str,
) -> Result<(String, PathBuf), StableError> {
    if let Ok(p) = db::get_project(pool, id_or_path).await {
        return Ok((p.id, PathBuf::from(p.path)));
    }
    let projects = db::list_projects(pool).await?;
    let found = projects
        .into_iter()
        .find(|pr| pr.name.eq_ignore_ascii_case(id_or_path) || pr.path == id_or_path);
    match found {
        Some(pr) => Ok((pr.id, PathBuf::from(pr.path))),
        None => Err(StableError::new(
            codes::NOT_FOUND,
            format!("project '{id_or_path}' not found"),
        )),
    }
}

/// Card title + body as an agent prompt (vibe-kanban: description is the prompt).
pub async fn card_prompt(
    project_path: &Path,
    board_id: &str,
    card_id: &str,
) -> Result<String, StableError> {
    let card = crate::kanban::store::get_card(project_path, board_id, card_id).await?;
    let mut prompt = format!("# {}\n", card.meta.title);
    if !card.body.trim().is_empty() {
        prompt.push('\n');
        prompt.push_str(card.body.trim());
    }
    Ok(prompt)
}

pub struct CreateWorkspaceInput {
    pub project_id: String,
    pub name: String,
    pub repo_path: PathBuf,
    pub card_board: Option<String>,
    pub card_id: Option<String>,
    pub base_branch: Option<String>,
}

pub async fn create_workspace(
    pool: &Pool<Sqlite>,
    input: CreateWorkspaceInput,
) -> Result<WorkspaceDto, StableError> {
    if !input.repo_path.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "repo path not a directory"));
    }
    if !worktree::is_git_repo(&input.repo_path) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "repo path is not a git repository",
        ));
    }
    let name = input.name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "workspace name 1-200 chars",
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let short = &id.replace('-', "")[..8].to_string();
    let branch = slug_branch(input.card_id.as_deref(), name, short);
    let worktree_path = worktree_base(&input.repo_path).join(&id);

    worktree::ensure_excluded(&input.repo_path, WORKTREE_EXCLUDE_PATTERN)?;
    worktree::create_worktree(
        &input.repo_path,
        &worktree_path,
        &branch,
        input.base_branch.as_deref(),
    )?;

    let now = db::now_ms();
    let ws = WorkspaceDto {
        id: id.clone(),
        project_id: input.project_id,
        card_board: input.card_board,
        card_id: input.card_id,
        name: name.to_string(),
        repo_path: input.repo_path.to_string_lossy().to_string(),
        worktree_path: worktree_path.to_string_lossy().to_string(),
        branch,
        status: "idle".to_string(),
        archived: false,
        created_at_ms: now,
        updated_at_ms: now,
    };
    // Roll back the worktree if the DB insert fails.
    if let Err(e) = db::create_workspace(pool, &ws).await {
        let _ = worktree::remove_worktree(&input.repo_path, &worktree_path, true);
        return Err(e);
    }
    Ok(ws)
}

/// Spawn a coding-agent run in the workspace worktree (PTY-backed, like tasks).
/// `prompt` empty → error (callers resolve card text beforehand).
pub async fn start_agent_session(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    terms: &EmbeddedTerminals,
    buffers: &TerminalBuffers,
    monitors: &TaskMonitors,
    ws: &WorkspaceDto,
    executor_id: &str,
    prompt: &str,
) -> Result<AgentSessionDto, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, pool, terms, buffers, monitors, ws, executor_id, prompt);
        return Err(StableError::new(
            codes::INTERNAL,
            "agent sessions not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        start_agent_session_inner(app, pool, terms, buffers, monitors, ws, executor_id, prompt).await
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn start_agent_session_inner(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    terms: &EmbeddedTerminals,
    buffers: &TerminalBuffers,
    monitors: &TaskMonitors,
    ws: &WorkspaceDto,
    executor_id: &str,
    prompt: &str,
) -> Result<AgentSessionDto, StableError> {
    let exec: Box<dyn Executor> =
        executors::find(executor_id).ok_or_else(|| {
            StableError::new(codes::NOT_FOUND, format!("unknown executor '{executor_id}'"))
        })?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "prompt must not be empty",
        ));
    }
    let argv = executors::resolve_argv(exec.as_ref(), prompt).ok_or_else(|| {
        StableError::new(
            codes::SPAWN_FAILED,
            format!("'{}' not found on PATH", exec.binary()),
        )
    })?;
    let worktree = Path::new(&ws.worktree_path);
    if !worktree.is_dir() {
        return Err(StableError::new(
            codes::NOT_FOUND,
            "workspace worktree is gone (deleted on disk?)",
        ));
    }
    let project = db::get_project(pool, &ws.project_id).await?;
    let pty_id = uuid::Uuid::new_v4().to_string();
    let started_at_ms = db::now_ms();
    let command_line = Some(argv.join(" "));
    // Row in the shared task sessions table so the terminal pane + task
    // monitors treat agent runs like any other PTY task.
    db::start_session(pool, &ws.project_id, command_line.clone(), Some(pty_id.clone())).await?;
    if let Err(e) = crate::spawn::embedded::spawn_task_in_pty(
        app.clone(),
        terms,
        buffers,
        monitors,
        ws.project_id.clone(),
        command_line,
        started_at_ms,
        worktree,
        &argv,
        false,
        pty_id.clone(),
        None,
        project.stack,
        None,
    ) {
        let _ = db::end_session(pool, &pty_id).await;
        return Err(e);
    }
    let now = db::now_ms();
    let session = AgentSessionDto {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        executor: exec.id().to_string(),
        pty_session_id: pty_id,
        status: "running".to_string(),
        last_prompt: Some(prompt.to_string()),
        created_at_ms: now,
        updated_at_ms: now,
    };
    db::create_agent_session(pool, &session).await?;
    db::set_workspace_status(pool, &ws.id, "running").await?;
    Ok(session)
}

/// Roll up stored agent-session rows into a workspace status. DB-only,
/// no recursion (callers sync sessions first).
async fn rollup_workspace_status(
    pool: &Pool<Sqlite>,
    workspace_id: &str,
) -> Result<String, StableError> {
    let sessions = db::list_agent_sessions(pool, workspace_id).await?;
    let mut status = "idle";
    for s in &sessions {
        if s.status == "running" {
            status = "running";
            break;
        }
        if s.status == "error" {
            status = "error";
        }
    }
    db::set_workspace_status(pool, workspace_id, status).await?;
    Ok(status.to_string())
}

/// Refresh one agent session from the live task monitor. Returns new status.
pub async fn sync_session_status(
    pool: &Pool<Sqlite>,
    monitors: &TaskMonitors,
    session: &AgentSessionDto,
) -> Result<String, StableError> {
    if session.status != "running" {
        return Ok(session.status.clone());
    }
    let next = match snapshot_task(monitors, &session.pty_session_id) {
        Some(entry) if entry.finished => match entry.exit_code {
            Some(0) => "done",
            _ if entry.stop_requested => "stopped",
            _ => "error",
        },
        Some(_) => "running",
        None => {
            // Monitor entry gone (app restart or retention): fall back to the
            // shared task sessions row, which always outlives the monitor.
            match db::get_session(pool, &session.pty_session_id).await {
                Ok(s) => match s.state.as_str() {
                    "success" => "done",
                    "error" => "error",
                    "cancelled" => "stopped",
                    _ => "running",
                },
                Err(_) => "running",
            }
        }
    };
    if next != "running" {
        db::set_agent_session_status(pool, &session.id, next).await?;
        rollup_workspace_status(pool, &session.workspace_id).await?;
        if next == "done" {
            // Agent finished cleanly: linked cards waiting in `doing` move to
            // `review`, mirroring the vibe-kanban review queue.
            if let Ok(ws) = db::get_workspace(pool, &session.workspace_id).await {
                apply_done_automation(pool, &ws).await;
            }
        }
    }
    Ok(next.to_string())
}

async fn apply_done_automation(pool: &Pool<Sqlite>, ws: &WorkspaceDto) {
    let (Some(board), Some(card_id)) = (ws.card_board.as_deref(), ws.card_id.as_deref()) else {
        return;
    };
    let Ok(project) = db::get_project(pool, &ws.project_id).await else {
        return;
    };
    let root = Path::new(&project.path);
    let Ok(card) = kanban_store::get_card(root, board, card_id).await else {
        return;
    };
    if card.meta.status == "doing" {
        let _ = kanban_store::update_card(
            root,
            board,
            card_id,
            CardPatch { status: Some("review".to_string()), ..Default::default() },
        )
        .await;
    }
}

/// After a successful PR merge: linked cards (unless already done/cancelled)
/// move to `done` and the workspace is archived. The worktree stays until an
/// explicit delete, so the diff remains reviewable.
pub async fn apply_merge_automation(pool: &Pool<Sqlite>, ws: &WorkspaceDto) {
    if let (Some(board), Some(card_id)) = (ws.card_board.as_deref(), ws.card_id.as_deref()) {
        if let Ok(project) = db::get_project(pool, &ws.project_id).await {
            let root = Path::new(&project.path);
            if let Ok(card) = kanban_store::get_card(root, board, card_id).await {
                if card.meta.status != "done" && card.meta.status != "cancelled" {
                    let _ = kanban_store::update_card(
                        root,
                        board,
                        card_id,
                        CardPatch { status: Some("done".to_string()), ..Default::default() },
                    )
                    .await;
                }
            }
        }
    }
    let _ = db::archive_workspace(pool, &ws.id, true).await;
}

pub async fn sync_workspace_status(
    pool: &Pool<Sqlite>,
    monitors: &TaskMonitors,
    workspace_id: &str,
) -> Result<String, StableError> {
    let sessions = db::list_agent_sessions(pool, workspace_id).await?;
    for s in &sessions {
        let _ = sync_session_status(pool, monitors, s).await;
    }
    rollup_workspace_status(pool, workspace_id).await
}

/// Follow-up text into a live agent PTY (Enter-terminated).
pub async fn session_prompt(
    pool: &Pool<Sqlite>,
    terms: &EmbeddedTerminals,
    monitors: &TaskMonitors,
    session: &AgentSessionDto,
    prompt: &str,
) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (pool, terms, monitors, session, prompt);
        return Err(StableError::new(
            codes::INTERNAL,
            "agent sessions not available on this platform",
        ));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        session_prompt_inner(pool, terms, monitors, session, prompt).await
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn session_prompt_inner(
    pool: &Pool<Sqlite>,
    terms: &EmbeddedTerminals,
    monitors: &TaskMonitors,
    session: &AgentSessionDto,
    prompt: &str,
) -> Result<(), StableError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "prompt must not be empty",
        ));
    }
    let live = match snapshot_task(monitors, &session.pty_session_id) {
        Some(entry) => !entry.finished,
        None => false,
    };
    if !live {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "session is finished — create a new session for follow-ups",
        ));
    }
    crate::spawn::embedded::write_session(terms, &session.pty_session_id, &format!("{prompt}\n"))?;
    db::touch_workspace(pool, &session.workspace_id).await?;
    Ok(())
}

/// Best-effort stop of every session PTY, then worktree + rows removal.
pub async fn delete_workspace_full(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    terms: &EmbeddedTerminals,
    monitors: &TaskMonitors,
    ws: &WorkspaceDto,
) -> Result<(), StableError> {
    let sessions = db::list_agent_sessions(pool, &ws.id).await.unwrap_or_default();
    for s in &sessions {
        let _ = crate::spawn::task_monitor::request_stop(app.clone(), monitors, &s.pty_session_id).await;
        let _ = db::set_agent_session_status(pool, &s.id, "stopped").await;
    }
    let _ = terms; // PTYs die with the killed process tree; killer runs via monitor.
    let repo = Path::new(&ws.repo_path);
    let wt = Path::new(&ws.worktree_path);
    if wt.exists() {
        // Force: agent runs may leave dirty state behind.
        let _ = worktree::remove_worktree(repo, wt, true);
    }
    db::delete_workspace(pool, &ws.id).await?;
    Ok(())
}

/// Decode the tail of a PTY buffer (base64 chunks) for `get_execution`.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn buffer_tail(
    _buffers: &TerminalBuffers,
    _pty_session_id: &str,
    _max_chars: usize,
) -> String {
    String::new()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn buffer_tail(buffers: &TerminalBuffers, pty_session_id: &str, max_chars: usize) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let mut text = String::new();
    for chunk in buffers.get(pty_session_id) {
        if let Ok(bytes) = STANDARD.decode(chunk.trim()) {
            text.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    // Strip ANSI escapes crudely so MCP consumers get readable text.
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        clean.push(c);
    }
    if clean.len() > max_chars {
        let skip = clean.len() - max_chars;
        format!("…[truncated]\n{}", &clean[skip..])
    } else {
        clean
    }
}
