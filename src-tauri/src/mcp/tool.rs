use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Pool, Sqlite};
use tauri::AppHandle;

use crate::db;
use crate::issues::models::CreateIssueInput;
use crate::issues::provider::IssueProvider;
use crate::mcp::protocol::{CallToolResult, Tool};

/// Trait implemented by any MCP tool in Project Vault.
/// Adding a new tool only requires implementing this trait and registering it with the registry.
#[async_trait]
pub trait McpTool: Send + Sync {
    /// Unique identifier for the tool (e.g. "list_projects")
    fn name(&self) -> &'static str;

    /// Human-readable explanation of what the tool does
    fn description(&self) -> &'static str;

    /// JSON Schema describing accepted arguments
    fn schema(&self) -> serde_json::Value;

    /// Execute the tool with parsed JSON arguments
    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult;

    /// Execute with access to the Tauri app handle (managed state: PTY
    /// sessions, task monitors). Defaults to plain `execute` so tools that
    /// only need the DB stay untouched; workspace tools override this.
    async fn execute_with_app(
        &self,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        _app: &AppHandle,
    ) -> CallToolResult {
        self.execute(args, pool).await
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolSummaryDto {
    pub name: String,
    pub description: String,
    pub schema: serde_json::Value,
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn McpTool>>,
    order: Vec<String>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            order: Vec::new(),
        }
    }

    pub fn register<T: McpTool + 'static>(&mut self, tool: T) {
        let name = tool.name().to_string();
        if !self.tools.contains_key(&name) {
            self.order.push(name.clone());
        }
        self.tools.insert(name, Arc::new(tool));
    }

    pub fn list(&self) -> Vec<Tool> {
        self.order
            .iter()
            .filter_map(|name| self.tools.get(name))
            .map(|t| Tool {
                name: t.name().to_string(),
                description: t.description().to_string(),
                input_schema: t.schema(),
            })
            .collect()
    }

    pub fn list_summaries(&self) -> Vec<ToolSummaryDto> {
        self.order
            .iter()
            .filter_map(|name| self.tools.get(name))
            .map(|t| ToolSummaryDto {
                name: t.name().to_string(),
                description: t.description().to_string(),
                schema: t.schema(),
            })
            .collect()
    }

    pub async fn call(
        &self,
        name: &str,
        args: serde_json::Value,
        pool: &Pool<Sqlite>,
        app: &AppHandle,
    ) -> CallToolResult {
        match self.tools.get(name) {
            Some(tool) => tool.execute_with_app(args, pool, app).await,
            None => CallToolResult::error(format!("Unknown tool: {}", name)),
        }
    }
}

pub static REGISTRY: Lazy<ToolRegistry> = Lazy::new(|| {
    let mut reg = ToolRegistry::new();
    reg.register(ListProjectsTool);
    reg.register(GetProjectTool);
    reg.register(SearchProjectsTool);
    reg.register(ListLocationsTool);
    reg.register(GetGitStatusTool);
    reg.register(ListProjectTasksTool);
    reg.register(ListIssuesTool);
    reg.register(CreateIssueTool);
    reg.register(crate::mcp::kanban_tools::KanbanListBoards);
    reg.register(crate::mcp::kanban_tools::KanbanGetBoard);
    reg.register(crate::mcp::kanban_tools::KanbanListCards);
    reg.register(crate::mcp::kanban_tools::KanbanGetCard);
    reg.register(crate::mcp::kanban_tools::KanbanCreateCard);
    reg.register(crate::mcp::kanban_tools::KanbanUpdateCard);
    reg.register(crate::mcp::kanban_tools::KanbanMoveCard);
    reg.register(crate::mcp::kanban_tools::KanbanDeleteCard);
    reg.register(crate::mcp::kanban_tools::KanbanDeleteBoard);
    reg.register(crate::mcp::kanban_tools::KanbanListTags);
    reg.register(crate::mcp::kanban_tools::KanbanSetTagColor);
    reg.register(crate::mcp::kanban_tools::KanbanCreateRelation);
    reg.register(crate::mcp::kanban_tools::KanbanDeleteRelation);
    reg.register(crate::mcp::workspace_tools::WorkspaceList);
    reg.register(crate::mcp::workspace_tools::WorkspaceGet);
    reg.register(crate::mcp::workspace_tools::WorkspaceStart);
    reg.register(crate::mcp::workspace_tools::SessionCreate);
    reg.register(crate::mcp::workspace_tools::SessionList);
    reg.register(crate::mcp::workspace_tools::SessionPrompt);
    reg.register(crate::mcp::workspace_tools::ExecutionGet);
    reg.register(crate::mcp::workspace_tools::WorkspaceDelete);
    reg.register(crate::mcp::workspace_tools::WorkspaceLink);
    reg.register(crate::mcp::workspace_tools::WorkspacePush);
    reg.register(crate::mcp::workspace_tools::WorkspaceGitInfo);
    reg.register(crate::mcp::workspace_tools::PrCreate);
    reg.register(crate::mcp::workspace_tools::PrStatus);
    reg.register(crate::mcp::workspace_tools::PrMerge);
    reg
});

// ============================================================================
// Built-in Tool Implementations
// ============================================================================

// 1. list_projects
#[derive(Deserialize, Default)]
struct ListProjectsArgs {
    filter: Option<String>,
    favorite_only: Option<bool>,
    tag: Option<String>,
}

pub struct ListProjectsTool;

#[async_trait]
impl McpTool for ListProjectsTool {
    fn name(&self) -> &'static str {
        "list_projects"
    }

    fn description(&self) -> &'static str {
        "List all software projects registered in Project Vault with stack, runtime, favorite status, tags, and playtime."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "description": "Optional search term to filter projects by name, stack, or path"
                },
                "favorite_only": {
                    "type": "boolean",
                    "description": "If true, only returns favorite projects"
                },
                "tag": {
                    "type": "string",
                    "description": "Filter projects containing this tag"
                }
            }
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: ListProjectsArgs = serde_json::from_value(args).unwrap_or_default();
        let filter = params.filter.map(|s| s.to_lowercase());
        let favorite_only = params.favorite_only.unwrap_or(false);
        let tag = params.tag.map(|s| s.to_lowercase());

        match db::list_projects(pool).await {
            Ok(projects) => {
                let filtered: Vec<_> = projects
                    .into_iter()
                    .filter(|p| {
                        if favorite_only && !p.favorite {
                            return false;
                        }
                        if let Some(ref t) = tag {
                            if !p.tags.iter().any(|item| item.to_lowercase() == *t) {
                                return false;
                            }
                        }
                        if let Some(ref q) = filter {
                            let match_name = p.name.to_lowercase().contains(q);
                            let match_stack = p.stack.to_lowercase().contains(q);
                            let match_path = p.path.to_lowercase().contains(q);
                            if !match_name && !match_stack && !match_path {
                                return false;
                            }
                        }
                        true
                    })
                    .map(|p| {
                        json!({
                            "id": p.id,
                            "name": p.name,
                            "path": p.path,
                            "stack": p.stack,
                            "runtimeHint": p.runtime_hint,
                            "favorite": p.favorite,
                            "tags": p.tags,
                            "taskCount": p.tasks.len(),
                            "lastOpenedAtMs": p.last_opened_at_ms,
                            "totalPlaytimeMs": p.total_playtime_ms,
                        })
                    })
                    .collect();

                CallToolResult::text(serde_json::to_string_pretty(&filtered).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to list projects: {e}")),
        }
    }
}

// 2. get_project
#[derive(Deserialize)]
struct GetProjectArgs {
    id_or_name: String,
}

pub struct GetProjectTool;

#[async_trait]
impl McpTool for GetProjectTool {
    fn name(&self) -> &'static str {
        "get_project"
    }

    fn description(&self) -> &'static str {
        "Get detailed information about a specific project by its ID or name, including runnable tasks, tags, paths, and metadata."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "id_or_name": {
                    "type": "string",
                    "description": "The project ID or project name"
                }
            },
            "required": ["id_or_name"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: GetProjectArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };

        match db::list_projects(pool).await {
            Ok(projects) => {
                let project = projects.into_iter().find(|p| {
                    p.id == params.id_or_name || p.name.eq_ignore_ascii_case(&params.id_or_name)
                });

                match project {
                    Some(p) => {
                        CallToolResult::text(serde_json::to_string_pretty(&p).unwrap_or_default())
                    }
                    None => {
                        CallToolResult::error(format!("Project '{}' not found", params.id_or_name))
                    }
                }
            }
            Err(e) => CallToolResult::error(format!("Database error: {e}")),
        }
    }
}

// 3. search_projects
#[derive(Deserialize)]
struct SearchProjectsArgs {
    query: String,
}

pub struct SearchProjectsTool;

#[async_trait]
impl McpTool for SearchProjectsTool {
    fn name(&self) -> &'static str {
        "search_projects"
    }

    fn description(&self) -> &'static str {
        "Search projects in the vault by name, path, tag, or technology stack."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query string"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: SearchProjectsArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let query = params.query.to_lowercase();

        match db::list_projects(pool).await {
            Ok(projects) => {
                let results: Vec<_> = projects
                    .into_iter()
                    .filter(|p| {
                        p.name.to_lowercase().contains(&query)
                            || p.path.to_lowercase().contains(&query)
                            || p.stack.to_lowercase().contains(&query)
                            || p.tags.iter().any(|t| t.to_lowercase().contains(&query))
                    })
                    .map(|p| {
                        json!({
                            "id": p.id,
                            "name": p.name,
                            "path": p.path,
                            "stack": p.stack,
                            "tags": p.tags,
                            "favorite": p.favorite,
                        })
                    })
                    .collect();

                CallToolResult::text(serde_json::to_string_pretty(&results).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to search projects: {e}")),
        }
    }
}

// 4. list_locations
pub struct ListLocationsTool;

#[async_trait]
impl McpTool for ListLocationsTool {
    fn name(&self) -> &'static str {
        "list_locations"
    }

    fn description(&self) -> &'static str {
        "List all library root directories configured in Project Vault."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn execute(&self, _args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        match db::list_locations(pool).await {
            Ok(locations) => {
                CallToolResult::text(serde_json::to_string_pretty(&locations).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to list locations: {e}")),
        }
    }
}

// 5. get_git_status
#[derive(Deserialize)]
struct GetGitStatusArgs {
    project_id_or_path: String,
}

pub struct GetGitStatusTool;

#[async_trait]
impl McpTool for GetGitStatusTool {
    fn name(&self) -> &'static str {
        "get_git_status"
    }

    fn description(&self) -> &'static str {
        "Get git status for a project path or project ID (current branch, ahead/behind counts, dirty/clean status)."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id_or_path": {
                    "type": "string",
                    "description": "The project ID or absolute directory path"
                }
            },
            "required": ["project_id_or_path"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: GetGitStatusArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };
        let target = &params.project_id_or_path;

        let target_path = if Path::new(target).is_dir() {
            target.to_string()
        } else {
            match db::get_project(pool, target).await {
                Ok(p) => p.path,
                Err(_) => match db::list_projects(pool).await {
                    Ok(list) => match list
                        .into_iter()
                        .find(|p| p.name.eq_ignore_ascii_case(target))
                    {
                        Some(p) => p.path,
                        None => {
                            return CallToolResult::error(format!(
                                "Project or path '{target}' not found"
                            ))
                        }
                    },
                    Err(e) => return CallToolResult::error(format!("Database error: {e}")),
                },
            }
        };

        let cwd = Path::new(&target_path);
        if !crate::commands::git::utils::is_git_repo(cwd) {
            return CallToolResult::text(
                json!({
                    "isGitRepo": false,
                    "path": target_path
                })
                .to_string(),
            );
        }

        let branch = crate::commands::git::utils::run_git(cwd, &["branch", "--show-current"])
            .unwrap_or_else(|_| "HEAD".to_string());

        let mut ahead = 0;
        let mut behind = 0;
        let mut has_upstream = false;
        if let Ok(revs) = crate::commands::git::utils::run_git(
            cwd,
            &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
        ) {
            has_upstream = true;
            let parts: Vec<&str> = revs.split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].parse().unwrap_or(0);
                behind = parts[1].parse().unwrap_or(0);
            }
        }

        let status_out = crate::commands::git::utils::run_git(cwd, &["status", "--porcelain"])
            .unwrap_or_default();
        let is_dirty = !status_out.is_empty();
        let version =
            crate::commands::git::utils::run_git(cwd, &["describe", "--tags", "--abbrev=0"]).ok();

        let res = json!({
            "isGitRepo": true,
            "path": target_path,
            "branch": branch,
            "ahead": ahead,
            "behind": behind,
            "hasUpstream": has_upstream,
            "isDirty": is_dirty,
            "version": version,
        });

        CallToolResult::text(serde_json::to_string_pretty(&res).unwrap_or_default())
    }
}

// 6. list_project_tasks
#[derive(Deserialize)]
struct ListProjectTasksArgs {
    id_or_name: String,
}

pub struct ListProjectTasksTool;

#[async_trait]
impl McpTool for ListProjectTasksTool {
    fn name(&self) -> &'static str {
        "list_project_tasks"
    }

    fn description(&self) -> &'static str {
        "List runnable tasks, scripts, and commands defined for a specific project."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "id_or_name": {
                    "type": "string",
                    "description": "The project ID or name"
                }
            },
            "required": ["id_or_name"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: ListProjectTasksArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };

        match db::list_projects(pool).await {
            Ok(projects) => {
                let project = projects.into_iter().find(|p| {
                    p.id == params.id_or_name || p.name.eq_ignore_ascii_case(&params.id_or_name)
                });

                match project {
                    Some(p) => CallToolResult::text(
                        serde_json::to_string_pretty(&p.tasks).unwrap_or_default(),
                    ),
                    None => {
                        CallToolResult::error(format!("Project '{}' not found", params.id_or_name))
                    }
                }
            }
            Err(e) => CallToolResult::error(format!("Database error: {e}")),
        }
    }
}

// 7. list_issues
#[derive(Deserialize)]
struct ListIssuesArgs {
    project_id: String,
    state: Option<String>,
}

pub struct ListIssuesTool;

#[async_trait]
impl McpTool for ListIssuesTool {
    fn name(&self) -> &'static str {
        "list_issues"
    }

    fn description(&self) -> &'static str {
        "List issues tracked in Project Vault for a specific project."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "Project ID"
                },
                "state": {
                    "type": "string",
                    "description": "Filter by state ('open' or 'closed')"
                }
            },
            "required": ["project_id"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: ListIssuesArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };

        let provider = crate::issues::local::LocalSqliteProvider::new(pool.clone());
        match provider.list_issues(&params.project_id).await {
            Ok(issues) => {
                let filtered: Vec<_> = issues
                    .into_iter()
                    .filter(|i| {
                        if let Some(ref s) = params.state {
                            i.state.eq_ignore_ascii_case(s)
                        } else {
                            true
                        }
                    })
                    .collect();
                CallToolResult::text(serde_json::to_string_pretty(&filtered).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to list issues: {e}")),
        }
    }
}

// 8. create_issue
#[derive(Deserialize)]
struct CreateIssueArgs {
    project_id: String,
    title: String,
    body: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

pub struct CreateIssueTool;

#[async_trait]
impl McpTool for CreateIssueTool {
    fn name(&self) -> &'static str {
        "create_issue"
    }

    fn description(&self) -> &'static str {
        "Create a new local issue for a project in Project Vault."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "Project ID"
                },
                "title": {
                    "type": "string",
                    "description": "Issue title"
                },
                "body": {
                    "type": "string",
                    "description": "Optional markdown issue body description"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional list of tags"
                }
            },
            "required": ["project_id", "title"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: CreateIssueArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };

        let provider = crate::issues::local::LocalSqliteProvider::new(pool.clone());
        let input = CreateIssueInput {
            title: params.title,
            body: params.body,
            tags: params.tags,
        };
        match provider.create_issue(&params.project_id, input).await {
            Ok(issue) => {
                CallToolResult::text(serde_json::to_string_pretty(&issue).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to create issue: {e}")),
        }
    }
}
