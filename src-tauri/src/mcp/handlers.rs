use sqlx::{Pool, Sqlite};

use crate::db;
use crate::mcp::protocol::{
    CallToolResult, Prompt, PromptArgument, Resource, ResourceContent, Tool,
};
use crate::mcp::tool::REGISTRY;

pub fn list_tools() -> Vec<Tool> {
    REGISTRY.list()
}

pub async fn call_tool(
    name: &str,
    args: &serde_json::Value,
    pool: &Pool<Sqlite>,
    app: &tauri::AppHandle,
) -> CallToolResult {
    REGISTRY.call(name, args.clone(), pool, app).await
}

pub fn list_resources() -> Vec<Resource> {
    vec![
        Resource {
            uri: "vault://projects".to_string(),
            name: "Projects in Vault".to_string(),
            description: Some("All discovered development projects in Project Vault".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        Resource {
            uri: "vault://locations".to_string(),
            name: "Library Locations".to_string(),
            description: Some("Configured library root directories".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        Resource {
            uri: "vault://kanban-boards".to_string(),
            name: "Kanban Boards (all projects)".to_string(),
            description: Some(
                "All markdown kanban boards. Per-project: vault://boards/{projectIdOrPath}. Full board: vault://board/{projectIdOrPath}/{boardId}".to_string(),
            ),
            mime_type: Some("application/json".to_string()),
        },
    ]
}

pub async fn read_resource(uri: &str, pool: &Pool<Sqlite>) -> Option<ResourceContent> {
    match uri {
        "vault://projects" => {
            let projects = db::list_projects(pool).await.ok()?;
            let text = serde_json::to_string_pretty(&projects).ok()?;
            Some(ResourceContent {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text: Some(text),
            })
        }
        "vault://locations" => {
            let locations = db::list_locations(pool).await.ok()?;
            let text = serde_json::to_string_pretty(&locations).ok()?;
            Some(ResourceContent {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text: Some(text),
            })
        }
        "vault://kanban-boards" => {
            let projects = db::list_projects(pool).await.ok()?;
            let mut all = serde_json::Map::new();
            for pr in projects.iter().take(50) {
                let root = std::path::Path::new(&pr.path);
                let boards = crate::kanban::store::list_boards(root).await.unwrap_or_default();
                all.insert(pr.id.clone(), serde_json::to_value(&boards).unwrap_or_default());
            }
            let text = serde_json::to_string_pretty(&all).ok()?;
            Some(ResourceContent {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text: Some(text),
            })
        }
        _ if uri.starts_with("vault://boards/") => {
            let project = uri.strip_prefix("vault://boards/")?;
            let root = crate::kanban::store::resolve_project_root(pool, project)
                .await
                .ok()?;
            let boards = crate::kanban::store::list_boards(&root).await.ok()?;
            let text = serde_json::to_string_pretty(&boards).ok()?;
            Some(ResourceContent {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text: Some(text),
            })
        }
        _ if uri.starts_with("vault://board/") => {
            let rest = uri.strip_prefix("vault://board/")?;
            let mut parts = rest.splitn(2, '/');
            let project = parts.next()?;
            let board_id = parts.next()?;
            if board_id.is_empty() {
                return None;
            }
            let root = crate::kanban::store::resolve_project_root(pool, project)
                .await
                .ok()?;
            let view = crate::kanban::store::get_board_view(&root, board_id)
                .await
                .ok()?;
            let text = serde_json::to_string_pretty(&view).ok()?;
            Some(ResourceContent {
                uri: uri.to_string(),
                mime_type: Some("application/json".to_string()),
                text: Some(text),
            })
        }
        _ => None,
    }
}

pub fn list_prompts() -> Vec<Prompt> {
    vec![Prompt {
        name: "vault_overview".to_string(),
        description: Some(
            "Summarize all projects, stacks, and recent activities in Project Vault".to_string(),
        ),
        arguments: Some(vec![PromptArgument {
            name: "include_tasks".to_string(),
            description: Some("Whether to include tasks in the summary (true/false)".to_string()),
            required: false,
        }]),
    }]
}
