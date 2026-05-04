use tauri_plugin_cli::Matches;
use crate::issues::IssueManager;
use crate::issues::models::{CreateIssueInput, UpdateIssueInput};
use crate::error::{codes, Result};
use sqlx::{Pool, Sqlite};
use std::env;

use std::process::Command;

pub async fn sync_issues_from_commits(project_path: &str, project_id: &str, manager: &IssueManager) -> Result<()> {
    let output = Command::new("git")
        .arg("log")
        .arg("-n")
        .arg("20")
        .arg("--pretty=format:%B%n---COMMIT-END---%n")
        .current_dir(project_path)
        .output()
        .map_err(|e| crate::error::StableError::new(codes::INTERNAL, format!("Failed to run git log: {}", e)))?;

    if !output.status.success() {
        return Ok(());
    }

    let messages = String::from_utf8_lossy(&output.stdout);
    for message in messages.split("---COMMIT-END---") {
        let issue_numbers = crate::issues::commit_parser::parse_issue_numbers(message);
        for num in issue_numbers {
            let _ = manager.update_issue(project_id, num, UpdateIssueInput {
                title: None, body: None, state: Some("closed".to_string()), tags: None
            }).await;
        }
    }

    Ok(())
}

pub async fn handle_cli_matches(matches: Matches, pool: Pool<Sqlite>) -> Result<()> {
    if let Some(sub) = matches.subcommand {
        if sub.name != "issue" {
            return Ok(());
        }

        let issue_matches = sub.matches;

        let cwd = env::current_dir()
            .map_err(|e| crate::error::StableError::new(codes::INTERNAL, format!("Failed to get CWD: {}", e)))?;
        let cwd_str = cwd.to_string_lossy();
        
        let project = match crate::db::find_project_by_path(&pool, &cwd_str).await {
            Ok(p) => p,
            Err(_) => {
                eprintln!("Error: No project found at current directory: {}", cwd_str);
                std::process::exit(1);
            }
        };

        let manager = IssueManager::new(pool, &project.id).await?;
        
        // Auto-sync from commits before any issue command
        let _ = sync_issues_from_commits(&project.path, &project.id, &manager).await;

        if let Some(issue_sub) = issue_matches.subcommand {
            match issue_sub.name.as_str() {
                "list" => {
                    let issues = manager.list_issues(&project.id).await?;
                    println!("{:<5} {:<10} {}", "ID", "STATE", "TITLE");
                    for issue in issues {
                        println!("#{:<4} {:<10} {}", issue.number, issue.state, issue.title);
                    }
                }
                "view" => {
                    let view_matches = issue_sub.matches;
                    let number_str = view_matches.args.get("number").and_then(|a| a.value.as_str()).unwrap_or_default();
                    let number = number_str.parse::<i64>().map_err(|_| crate::error::StableError::new(codes::INTERNAL, "Invalid issue number"))?;
                    let issue = manager.get_issue(&project.id, number).await?;
                    println!("Issue #{}", issue.number);
                    println!("Title: {}", issue.title);
                    println!("State: {}", issue.state);
                    if let Some(body) = issue.body {
                        println!("\n{}", body);
                    }
                }
                "create" => {
                    let create_matches = issue_sub.matches;
                    let title = create_matches.args.get("title").and_then(|a| a.value.as_str()).map(|s| s.to_string()).unwrap_or_default();
                    let body = create_matches.args.get("body").and_then(|a| a.value.as_str()).map(|s| s.to_string());
                    let input = CreateIssueInput { title, body, tags: vec![] };
                    let issue = manager.create_issue(&project.id, input).await?;
                    println!("Created issue #{}", issue.number);
                }
                "edit" => {
                    let edit_matches = issue_sub.matches;
                    let number_str = edit_matches.args.get("number").and_then(|a| a.value.as_str()).unwrap_or_default();
                    let number = number_str.parse::<i64>().map_err(|_| crate::error::StableError::new(codes::INTERNAL, "Invalid issue number"))?;
                    let title = edit_matches.args.get("title").and_then(|a| a.value.as_str()).map(|s| s.to_string());
                    let body = edit_matches.args.get("body").and_then(|a| a.value.as_str()).map(|s| s.to_string());
                    let input = UpdateIssueInput { title, body, state: None, tags: None };
                    manager.update_issue(&project.id, number, input).await?;
                    println!("Updated issue #{}", number);
                }
                "close" => {
                    let close_matches = issue_sub.matches;
                    let number_str = close_matches.args.get("number").and_then(|a| a.value.as_str()).unwrap_or_default();
                    let number = number_str.parse::<i64>().map_err(|_| crate::error::StableError::new(codes::INTERNAL, "Invalid issue number"))?;
                    manager.update_issue(&project.id, number, UpdateIssueInput {
                        title: None, body: None, state: Some("closed".to_string()), tags: None
                    }).await?;
                    println!("Closed issue #{}", number);
                }
                "reopen" => {
                    let reopen_matches = issue_sub.matches;
                    let number_str = reopen_matches.args.get("number").and_then(|a| a.value.as_str()).unwrap_or_default();
                    let number = number_str.parse::<i64>().map_err(|_| crate::error::StableError::new(codes::INTERNAL, "Invalid issue number"))?;
                    manager.update_issue(&project.id, number, UpdateIssueInput {
                        title: None, body: None, state: Some("open".to_string()), tags: None
                    }).await?;
                    println!("Reopened issue #{}", number);
                }
                "delete" => {
                    let delete_matches = issue_sub.matches;
                    let number_str = delete_matches.args.get("number").and_then(|a| a.value.as_str()).unwrap_or_default();
                    let number = number_str.parse::<i64>().map_err(|_| crate::error::StableError::new(codes::INTERNAL, "Invalid issue number"))?;
                    manager.delete_issue(&project.id, number).await?;
                    println!("Deleted issue #{}", number);
                }
                _ => {}
            }
        }
        
        std::process::exit(0);
    }
    Ok(())
}
