use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Manager};

use crate::db;
use crate::mcp::protocol::CallToolResult;
use crate::mcp::tool::McpTool;
use crate::spawn::{EmbeddedTerminals, TaskMonitors, TerminalBuffers};
use crate::workspaces::{executors, service, worktree};

fn pretty(v: &impl serde::Serialize) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

struct Ctx<'a> {
    pool: &'a Pool<Sqlite>,
    app: &'a AppHandle,
    terms: tauri::State<'a, EmbeddedTerminals>,
    buffers: tauri::State<'a, TerminalBuffers>,
    monitors: tauri::State<'a, TaskMonitors>,
}

fn ctx<'a>(pool: &'a Pool<Sqlite>, app: &'a AppHandle) -> Ctx<'a> {
    Ctx {
        pool,
        app,
        terms: app.state::<EmbeddedTerminals>(),
        buffers: app.state::<TerminalBuffers>(),
        monitors: app.state::<TaskMonitors>(),
    }
}

async fn sync_all(
    pool: &Pool<Sqlite>,
    monitors: &TaskMonitors,
    workspace_id: &str,
) -> Result<(), String> {
    let sessions = db::list_agent_sessions(pool, workspace_id)
        .await
        .map_err(|e| e.to_string())?;
    for s in &sessions {
        let _ = service::sync_session_status(pool, monitors, s).await;
    }
    Ok(())
}

// --- list_workspaces ---
pub struct WorkspaceList;
#[async_trait]
impl McpTool for WorkspaceList {
    fn name(&self) -> &'static str {
        "list_workspaces"
    }
    fn description(&self) -> &'static str {
        "List agent workspaces (isolated git worktrees where coding agents run)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "include_archived": { "type": "boolean" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" }
            }
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: Option<String>,
            include_archived: Option<bool>,
            board_id: Option<String>,
            card_id: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let project_id = match p.project.filter(|s| !s.trim().is_empty()) {
            Some(id) => match service::resolve_project(pool, &id).await {
                Ok((pid, _)) => Some(pid),
                Err(e) => return CallToolResult::error(format!("{e}")),
            },
            None => None,
        };
        match db::list_workspaces(
            pool,
            project_id.as_deref(),
            p.include_archived.unwrap_or(false),
            p.board_id.as_deref(),
            p.card_id.as_deref(),
        )
        .await
        {
            Ok(w) => CallToolResult::text(pretty(&w)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- get_workspace ---
pub struct WorkspaceGet;
#[async_trait]
impl McpTool for WorkspaceGet {
    fn name(&self) -> &'static str {
        "get_workspace"
    }
    fn description(&self) -> &'static str {
        "Get a workspace with live sessions and uncommitted changes."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "workspace_id": { "type": "string" } },
            "required": ["workspace_id"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        if let Err(e) = sync_all(pool, &c.monitors, &ws.id).await {
            return CallToolResult::error(e);
        }
        let sessions = match db::list_agent_sessions(pool, &ws.id).await {
            Ok(s) => s,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let changes = crate::commands::git::changed_files_in(std::path::Path::new(
            &ws.worktree_path,
        ))
        .await
        .unwrap_or_default();
        CallToolResult::text(pretty(&json!({ "workspace": ws, "sessions": sessions, "changes": changes })))
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("get_workspace requires the app context")
    }
}

// --- start_workspace ---
pub struct WorkspaceStart;
#[async_trait]
impl McpTool for WorkspaceStart {
    fn name(&self) -> &'static str {
        "start_workspace"
    }
    fn description(&self) -> &'static str {
        "Create a workspace (git worktree + branch) and start the first coding-agent session. Omit prompt to use the linked card's title+body."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project": { "type": "string" },
                "name": { "type": "string" },
                "executor": { "type": "string", "description": "opencode|cursor-agent" },
                "repo_path": { "type": "string" },
                "base_branch": { "type": "string" },
                "prompt": { "type": "string" },
                "board_id": { "type": "string" },
                "card_id": { "type": "string" }
            },
            "required": ["project", "name"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            project: String,
            name: String,
            executor: Option<String>,
            repo_path: Option<String>,
            base_branch: Option<String>,
            prompt: Option<String>,
            board_id: Option<String>,
            card_id: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let (project_id, project_path) = match service::resolve_project(pool, &p.project).await {
            Ok(r) => r,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let repo_path = p.repo_path.map(std::path::PathBuf::from).unwrap_or(project_path.clone());
        let ws = match service::create_workspace(
            pool,
            service::CreateWorkspaceInput {
                project_id,
                name: p.name,
                repo_path,
                card_board: p.board_id.clone(),
                card_id: p.card_id.clone(),
                base_branch: p.base_branch,
            },
        )
        .await
        {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        // Link card (best-effort, mirrors the Tauri command).
        if let (Some(board), Some(card)) = (p.board_id.as_deref(), p.card_id.as_deref()) {
            if let Ok(card_obj) =
                crate::kanban::store::get_card(&project_path, board, card).await
            {
                let mut links = card_obj.meta.links.workspaces;
                if !links.iter().any(|w| w == &ws.id) {
                    links.push(ws.id.clone());
                }
                let _ = crate::kanban::store::update_card(
                    &project_path,
                    board,
                    card,
                    crate::kanban::store::CardPatch {
                        links: Some(crate::kanban::model::CardLinks {
                            tasks: card_obj.meta.links.tasks,
                            files: card_obj.meta.links.files,
                            issues: card_obj.meta.links.issues,
                            workspaces: links,
                        }),
                        ..Default::default()
                    },
                )
                .await;
            }
        }
        let prompt = match p.prompt.filter(|s| !s.trim().is_empty()) {
            Some(prompt) => Some(prompt),
            None => match (p.board_id.as_deref(), p.card_id.as_deref()) {
                (Some(board), Some(card)) => {
                    match service::card_prompt(&project_path, board, card).await {
                        Ok(prompt) => Some(prompt),
                        Err(e) => return CallToolResult::error(format!("{e}")),
                    }
                }
                _ => None,
            },
        };
        let session = match (p.executor, prompt) {
            (Some(executor), Some(prompt)) => {
                match service::start_agent_session(
                    c.app, c.pool, &c.terms, &c.buffers, &c.monitors, &ws, &executor, &prompt,
                )
                .await
                {
                    Ok(s) => Some(s),
                    Err(e) => return CallToolResult::error(format!("{e}")),
                }
            }
            _ => None,
        };
        CallToolResult::text(pretty(&json!({ "workspace": ws, "session": session })))
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("start_workspace requires the app context")
    }
}

// --- create_session ---
pub struct SessionCreate;
#[async_trait]
impl McpTool for SessionCreate {
    fn name(&self) -> &'static str {
        "create_session"
    }
    fn description(&self) -> &'static str {
        "Start an additional coding-agent session in an existing workspace."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "workspace_id": { "type": "string" },
                "executor": { "type": "string" },
                "prompt": { "type": "string" }
            },
            "required": ["workspace_id"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
            executor: Option<String>,
            prompt: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let executor = match p.executor.filter(|s| !s.trim().is_empty()) {
            Some(e) => e,
            None => match db::list_agent_sessions(pool, &ws.id).await {
                Ok(s) => s
                    .last()
                    .map(|s| s.executor.clone())
                    .or_else(|| {
                        executors::probe_all().into_iter().find(|e| e.available).map(|e| e.id)
                    })
                    .unwrap_or_else(|| "opencode".to_string()),
                Err(e) => return CallToolResult::error(format!("{e}")),
            },
        };
        let prompt = match p.prompt.filter(|s| !s.trim().is_empty()) {
            Some(prompt) => prompt,
            None => match (ws.card_board.as_deref(), ws.card_id.as_deref()) {
                (Some(board), Some(card)) => {
                    let project = match db::get_project(pool, &ws.project_id).await {
                        Ok(pr) => pr,
                        Err(e) => return CallToolResult::error(format!("{e}")),
                    };
                    match service::card_prompt(
                        std::path::Path::new(&project.path),
                        board,
                        card,
                    )
                    .await
                    {
                        Ok(prompt) => prompt,
                        Err(e) => return CallToolResult::error(format!("{e}")),
                    }
                }
                _ => return CallToolResult::error("prompt required (no linked card)".to_string()),
            },
        };
        match service::start_agent_session(
            c.app, c.pool, &c.terms, &c.buffers, &c.monitors, &ws, &executor, &prompt,
        )
        .await
        {
            Ok(s) => CallToolResult::text(pretty(&s)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("create_session requires the app context")
    }
}

// --- list_sessions ---
pub struct SessionList;
#[async_trait]
impl McpTool for SessionList {
    fn name(&self) -> &'static str {
        "list_sessions"
    }
    fn description(&self) -> &'static str {
        "List coding-agent sessions in a workspace (statuses synced live)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "workspace_id": { "type": "string" } },
            "required": ["workspace_id"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        if let Err(e) = sync_all(pool, &c.monitors, &p.workspace_id).await {
            return CallToolResult::error(e);
        }
        match db::list_agent_sessions(pool, &p.workspace_id).await {
            Ok(s) => CallToolResult::text(pretty(&s)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("list_sessions requires the app context")
    }
}

// --- session_prompt ---
pub struct SessionPrompt;
#[async_trait]
impl McpTool for SessionPrompt {
    fn name(&self) -> &'static str {
        "session_prompt"
    }
    fn description(&self) -> &'static str {
        "Send follow-up text to a live agent session (fails when finished)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "prompt": { "type": "string" }
            },
            "required": ["session_id", "prompt"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            session_id: String,
            prompt: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let session = match db::get_agent_session(pool, &p.session_id).await {
            Ok(s) => s,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        match service::session_prompt(pool, &c.terms, &c.monitors, &session, &p.prompt).await {
            Ok(()) => CallToolResult::text("prompt sent"),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("session_prompt requires the app context")
    }
}

// --- get_execution ---
pub struct ExecutionGet;
#[async_trait]
impl McpTool for ExecutionGet {
    fn name(&self) -> &'static str {
        "get_execution"
    }
    fn description(&self) -> &'static str {
        "Inspect a session's live status and output tail."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "session_id": { "type": "string" } },
            "required": ["session_id"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            session_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let session = match db::get_agent_session(pool, &p.session_id).await {
            Ok(s) => s,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let live = match service::sync_session_status(pool, &c.monitors, &session).await {
            Ok(s) => s,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let session = match db::get_agent_session(pool, &p.session_id).await {
            Ok(s) => s,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let exit = crate::spawn::task_monitor::snapshot_task(&c.monitors, &session.pty_session_id)
            .and_then(|e| e.exit_code);
        let tail = service::buffer_tail(&c.buffers, &session.pty_session_id, 8000);
        CallToolResult::text(pretty(&json!({
            "session": session,
            "live_status": live,
            "exit_code": exit,
            "output_tail": tail,
        })))
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("get_execution requires the app context")
    }
}

// --- delete_workspace ---
pub struct WorkspaceDelete;
#[async_trait]
impl McpTool for WorkspaceDelete {
    fn name(&self) -> &'static str {
        "delete_workspace"
    }
    fn description(&self) -> &'static str {
        "Stop sessions, remove the worktree, delete the workspace."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "workspace_id": { "type": "string" },
                "delete_branch": { "type": "boolean" }
            },
            "required": ["workspace_id"]
        })
    }
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
            delete_branch: Option<bool>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let c = ctx(pool, app);
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        if let Err(e) =
            service::delete_workspace_full(c.app, pool, &c.terms, &c.monitors, &ws).await
        {
            return CallToolResult::error(format!("{e}"));
        }
        if p.delete_branch.unwrap_or(false) {
            let _ = worktree::delete_branch(std::path::Path::new(&ws.repo_path), &ws.branch);
        }
        CallToolResult::text(format!("deleted workspace '{}'", p.workspace_id))
    }
    async fn execute(&self, _args: serde_json::Value, _pool: &Pool<Sqlite>) -> CallToolResult {
        CallToolResult::error("delete_workspace requires the app context")
    }
}

// --- workspace_push ---
pub struct WorkspacePush;
#[async_trait]
impl McpTool for WorkspacePush {
    fn name(&self) -> &'static str {
        "workspace_push"
    }
    fn description(&self) -> &'static str {
        "Push a workspace branch to origin (-u)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "workspace_id": { "type": "string" } },
            "required": ["workspace_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        match worktree::push_branch(std::path::Path::new(&ws.worktree_path), &ws.branch).await {
            Ok(()) => CallToolResult::text(format!("pushed '{}'", ws.branch)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- workspace_git_info ---
pub struct WorkspaceGitInfo;
#[async_trait]
impl McpTool for WorkspaceGitInfo {
    fn name(&self) -> &'static str {
        "workspace_git_info"
    }
    fn description(&self) -> &'static str {
        "Branch, default base, GitHub owner/repo, and pushed state for a workspace."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "workspace_id": { "type": "string" } },
            "required": ["workspace_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        CallToolResult::text(pretty(&worktree::repo_info(std::path::Path::new(&ws.worktree_path))))
    }
}

// --- pr_create ---
pub struct PrCreate;
#[async_trait]
impl McpTool for PrCreate {
    fn name(&self) -> &'static str {
        "create_pr"
    }
    fn description(&self) -> &'static str {
        "Push a workspace branch and open a GitHub PR. Title/body default to the linked card."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "workspace_id": { "type": "string" },
                "base": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" }
            },
            "required": ["workspace_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
            base: Option<String>,
            title: Option<String>,
            body: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let wt = std::path::PathBuf::from(&ws.worktree_path);
        let info = worktree::repo_info(&wt);
        let (owner, repo) = match info.owner.zip(info.repo) {
            Some(t) => t,
            None => return CallToolResult::error("no GitHub origin remote on this repository"),
        };
        let base = p.base.filter(|b| !b.trim().is_empty()).unwrap_or(info.base);
        let (title, body) = match (&p.title, &p.body) {
            (Some(t), Some(b)) => (t.clone(), b.clone()),
            _ => {
                let (card_title, card_body) =
                    match (ws.card_board.as_deref(), ws.card_id.as_deref()) {
                        (Some(board), Some(card)) => {
                            match db::get_project(pool, &ws.project_id).await {
                                Ok(project) => {
                                    match crate::kanban::store::get_card(
                                        std::path::Path::new(&project.path),
                                        board,
                                        card,
                                    )
                                    .await
                                    {
                                        Ok(c) => (c.meta.title, c.body),
                                        Err(_) => (ws.name.clone(), String::new()),
                                    }
                                }
                                Err(_) => (ws.name.clone(), String::new()),
                            }
                        }
                        _ => (ws.name.clone(), String::new()),
                    };
                let stats = crate::commands::git::changed_files_in(&wt)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|f| (f.path, f.additions, f.deletions))
                    .collect::<Vec<_>>();
                (
                    p.title.unwrap_or(card_title.clone()),
                    p.body.unwrap_or_else(|| {
                        crate::workspaces::pr::build_pr_body(&card_title, &card_body, &ws.branch, &base, &stats)
                    }),
                )
            }
        };
        if let Err(e) = worktree::push_branch(&wt, &ws.branch).await {
            return CallToolResult::error(format!("{e}"));
        }
        match crate::workspaces::pr::create_pr(pool, &owner, &repo, &ws.branch, &base, &title, &body)
            .await
        {
            Ok(pr) => CallToolResult::text(pretty(&pr)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- pr_status ---
pub struct PrStatus;
#[async_trait]
impl McpTool for PrStatus {
    fn name(&self) -> &'static str {
        "pr_status"
    }
    fn description(&self) -> &'static str {
        "Check a GitHub PR's state (open/closed, merged, mergeable)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "owner": { "type": "string" },
                "repo": { "type": "string" },
                "number": { "type": "integer" }
            },
            "required": ["owner", "repo", "number"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            owner: String,
            repo: String,
            number: u64,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        match crate::workspaces::pr::pr_status(pool, &p.owner, &p.repo, p.number).await {
            Ok(s) => CallToolResult::text(pretty(&s)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- pr_merge ---
pub struct PrMerge;
#[async_trait]
impl McpTool for PrMerge {
    fn name(&self) -> &'static str {
        "merge_pr"
    }
    fn description(&self) -> &'static str {
        "Merge a GitHub PR (merge|squash|rebase). Linked cards move to done, workspace archived."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "workspace_id": { "type": "string" },
                "owner": { "type": "string" },
                "repo": { "type": "string" },
                "number": { "type": "integer" },
                "method": { "type": "string", "description": "merge|squash|rebase" }
            },
            "required": ["workspace_id", "owner", "repo", "number"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
            owner: String,
            repo: String,
            number: u64,
            method: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        match crate::workspaces::pr::merge_pr(
            pool,
            &p.owner,
            &p.repo,
            p.number,
            p.method.as_deref().unwrap_or("merge"),
        )
        .await
        {
            Ok(true) => {
                service::apply_merge_automation(pool, &ws).await;
                CallToolResult::text("merged")
            }
            Ok(false) => CallToolResult::text("not merged (already merged or queued)"),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}

// --- link_workspace ---
pub struct WorkspaceLink;
#[async_trait]
impl McpTool for WorkspaceLink {
    fn name(&self) -> &'static str {
        "link_workspace"
    }
    fn description(&self) -> &'static str {
        "Link a workspace to a card (or unlink with nulls)."
    }
    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "workspace_id": { "type": "string" },
                "board_id": { "type": ["string", "null"] },
                "card_id": { "type": ["string", "null"] }
            },
            "required": ["workspace_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        #[derive(Deserialize)]
        struct A {
            workspace_id: String,
            board_id: Option<String>,
            card_id: Option<String>,
        }
        let p: A = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let ws = match db::get_workspace(pool, &p.workspace_id).await {
            Ok(w) => w,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let project = match db::get_project(pool, &ws.project_id).await {
            Ok(pr) => pr,
            Err(e) => return CallToolResult::error(format!("{e}")),
        };
        let root = std::path::PathBuf::from(&project.path);
        if let (Some(old_board), Some(old_card)) = (ws.card_board.as_deref(), ws.card_id.as_deref()) {
            if let Ok(card) = crate::kanban::store::get_card(&root, old_board, old_card).await {
                let mut links = card.meta.links.workspaces;
                links.retain(|w| w != &ws.id);
                let _ = crate::kanban::store::update_card(
                    &root,
                    old_board,
                    old_card,
                    crate::kanban::store::CardPatch {
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
        }
        match (p.board_id.as_deref(), p.card_id.as_deref()) {
            (Some(board), Some(card)) => {
                let card_obj =
                    match crate::kanban::store::get_card(&root, board, card).await {
                        Ok(c) => c,
                        Err(e) => return CallToolResult::error(format!("{e}")),
                    };
                let mut links = card_obj.meta.links.workspaces;
                if !links.iter().any(|w| w == &ws.id) {
                    links.push(ws.id.clone());
                }
                let _ = crate::kanban::store::update_card(
                    &root,
                    board,
                    card,
                    crate::kanban::store::CardPatch {
                        links: Some(crate::kanban::model::CardLinks {
                            tasks: card_obj.meta.links.tasks,
                            files: card_obj.meta.links.files,
                            issues: card_obj.meta.links.issues,
                            workspaces: links,
                        }),
                        ..Default::default()
                    },
                )
                .await;
                if let Err(e) = db::set_workspace_card(pool, &ws.id, Some(board), Some(card)).await {
                    return CallToolResult::error(format!("{e}"));
                }
            }
            _ => {
                if let Err(e) = db::set_workspace_card(pool, &ws.id, None, None).await {
                    return CallToolResult::error(format!("{e}"));
                }
            }
        }
        match db::get_workspace(pool, &ws.id).await {
            Ok(w) => CallToolResult::text(pretty(&w)),
            Err(e) => CallToolResult::error(format!("{e}")),
        }
    }
}
