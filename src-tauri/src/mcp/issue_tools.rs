use std::path::PathBuf;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use sqlx::{Pool, Sqlite};

use crate::issues::models::{CreateIssueInput, UpdateIssueInput};
use crate::issues::provider::IssueProvider;
use crate::mcp::protocol::CallToolResult;
use crate::mcp::tool::McpTool;

// ============================================================================
// 1. list_issues
// ============================================================================

#[derive(Deserialize)]
struct ListIssuesArgs {
    #[serde(alias = "project")]
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
                    "description": "Project ID, name, or path"
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

        let (project_id, _) = crate::workspaces::service::resolve_project(pool, &params.project_id)
            .await
            .unwrap_or_else(|_| (params.project_id.clone(), PathBuf::new()));

        let provider = crate::issues::local::LocalSqliteProvider::new(pool.clone());
        match provider.list_issues(&project_id).await {
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

// ============================================================================
// 2. create_issue
// ============================================================================

#[derive(Deserialize)]
struct CreateIssueArgs {
    #[serde(alias = "project")]
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
                    "description": "Project ID, name, or path"
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

        let (project_id, _) = crate::workspaces::service::resolve_project(pool, &params.project_id)
            .await
            .unwrap_or_else(|_| (params.project_id.clone(), PathBuf::new()));

        let provider = crate::issues::local::LocalSqliteProvider::new(pool.clone());
        let input = CreateIssueInput {
            title: params.title,
            body: params.body,
            tags: params.tags,
        };
        match provider.create_issue(&project_id, input).await {
            Ok(issue) => {
                CallToolResult::text(serde_json::to_string_pretty(&issue).unwrap_or_default())
            }
            Err(e) => CallToolResult::error(format!("Failed to create issue: {e}")),
        }
    }
}

// ============================================================================
// 3. close_issue
// ============================================================================

#[derive(Deserialize)]
struct CloseIssueArgs {
    #[serde(alias = "project")]
    project_id: String,
    #[serde(alias = "number", alias = "id")]
    issue_number: serde_json::Value,
    reason: Option<String>,
}

pub struct CloseIssueTool;

#[async_trait]
impl McpTool for CloseIssueTool {
    fn name(&self) -> &'static str {
        "close_issue"
    }

    fn description(&self) -> &'static str {
        "Close an issue tracked in Project Vault (local issue or beads issue) for a specific project."
    }

    fn schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "string",
                    "description": "Project ID, name, or path"
                },
                "issue_number": {
                    "description": "Issue number (e.g. 1) or bead issue ID (e.g. 'bd-42')"
                },
                "reason": {
                    "type": "string",
                    "description": "Optional closing reason or comment"
                }
            },
            "required": ["project_id", "issue_number"]
        })
    }

    async fn execute(&self, args: serde_json::Value, pool: &Pool<Sqlite>) -> CallToolResult {
        let params: CloseIssueArgs = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return CallToolResult::error(format!("Invalid arguments: {e}")),
        };

        let (project_id, project_path) =
            match crate::workspaces::service::resolve_project(pool, &params.project_id).await {
                Ok((id, path)) => (id, path),
                Err(_) => (
                    params.project_id.clone(),
                    PathBuf::from(&params.project_id),
                ),
            };

        let parsed_num: Option<i64> = match &params.issue_number {
            serde_json::Value::Number(n) => n.as_i64(),
            serde_json::Value::String(s) => s.parse::<i64>().ok(),
            _ => None,
        };

        if let Some(num) = parsed_num {
            let provider = crate::issues::local::LocalSqliteProvider::new(pool.clone());
            let close_input = UpdateIssueInput {
                title: None,
                body: if let Some(ref r) = params.reason {
                    match provider.get_issue(&project_id, num).await {
                        Ok(existing) => {
                            let note = format!("*Closed*: {r}");
                            Some(match existing.body {
                                Some(b) if !b.trim().is_empty() => format!("{b}\n\n{note}"),
                                _ => note,
                            })
                        }
                        Err(_) => None,
                    }
                } else {
                    None
                },
                state: Some("closed".to_string()),
                tags: None,
            };

            match provider.update_issue(&project_id, num, close_input).await {
                Ok(issue) => {
                    return CallToolResult::text(
                        serde_json::to_string_pretty(&issue).unwrap_or_default(),
                    );
                }
                Err(local_err) => {
                    if project_path.join(".beads").exists() {
                        let bead_id = format!("{num}");
                        let bead_res = crate::beads::commands::beads_update_issue_status(
                            crate::beads::dto::UpdateBeadStatusInput {
                                project_path: project_path.to_string_lossy().to_string(),
                                id: bead_id.clone(),
                                status: "closed".to_string(),
                                close_reason: params.reason,
                            },
                        )
                        .await;
                        match bead_res {
                            Ok(_) => {
                                return CallToolResult::text(format!(
                                    "Successfully closed beads issue '{bead_id}' in project '{project_id}'"
                                ));
                            }
                            Err(bead_err) => {
                                return CallToolResult::error(format!(
                                    "Failed to close issue #{num} locally ({local_err}) and via beads ({bead_err})"
                                ));
                            }
                        }
                    }
                    return CallToolResult::error(format!("Failed to close issue #{num}: {local_err}"));
                }
            }
        }

        let bead_id = match &params.issue_number {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };

        if project_path.join(".beads").exists() {
            let bead_res = crate::beads::commands::beads_update_issue_status(
                crate::beads::dto::UpdateBeadStatusInput {
                    project_path: project_path.to_string_lossy().to_string(),
                    id: bead_id.clone(),
                    status: "closed".to_string(),
                    close_reason: params.reason,
                },
            )
            .await;
            match bead_res {
                Ok(_) => CallToolResult::text(format!(
                    "Successfully closed beads issue '{bead_id}' in project '{project_id}'"
                )),
                Err(e) => CallToolResult::error(format!("Failed to close beads issue '{bead_id}': {e}")),
            }
        } else {
            CallToolResult::error(format!(
                "Invalid issue number '{bead_id}' for local issues, and no .beads directory found at {}",
                project_path.display()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_close_issue_args() {
        let json_num = json!({
            "project_id": "proj-1",
            "issue_number": 12,
            "reason": "Resolved by commit"
        });
        let args: CloseIssueArgs = serde_json::from_value(json_num).unwrap();
        assert_eq!(args.project_id, "proj-1");
        assert_eq!(args.issue_number, 12);
        assert_eq!(args.reason.as_deref(), Some("Resolved by commit"));

        // Test aliases: project, number
        let json_aliases = json!({
            "project": "proj-2",
            "number": 5
        });
        let args_alias: CloseIssueArgs = serde_json::from_value(json_aliases).unwrap();
        assert_eq!(args_alias.project_id, "proj-2");
        assert_eq!(args_alias.issue_number, 5);
        assert!(args_alias.reason.is_none());

        // Test beads string id
        let json_bead = json!({
            "project_id": "proj-3",
            "id": "bd-100"
        });
        let args_bead: CloseIssueArgs = serde_json::from_value(json_bead).unwrap();
        assert_eq!(args_bead.project_id, "proj-3");
        assert_eq!(args_bead.issue_number, "bd-100");
    }

    #[test]
    fn test_schemas() {
        let list_tool = ListIssuesTool;
        assert_eq!(list_tool.name(), "list_issues");
        assert!(list_tool.schema().get("properties").is_some());

        let create_tool = CreateIssueTool;
        assert_eq!(create_tool.name(), "create_issue");
        assert!(create_tool.schema().get("properties").is_some());

        let close_tool = CloseIssueTool;
        assert_eq!(close_tool.name(), "close_issue");
        assert!(close_tool.schema().get("properties").is_some());
    }
}
