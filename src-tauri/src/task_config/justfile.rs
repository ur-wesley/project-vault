use std::collections::HashMap;
use std::path::Path;

use crate::models::{ConcurrentTask, TaskDto};

struct ParsedRecipe {
    name: String,
    description: Option<String>,
    depends: Vec<String>,
    body: String,
    is_concurrent: bool,
}

pub fn read_justfile_tasks(path: &Path) -> Vec<TaskDto> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut recipes: Vec<ParsedRecipe> = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        if line.is_empty() {
            i += 1;
            continue;
        }

        // Collect comment block before recipe
        let mut description = None;
        let mut is_concurrent = false;
        while i < lines.len() {
            let l = lines[i].trim();
            if l.starts_with('#') {
                let comment = l.trim_start_matches('#').trim();
                if comment.eq_ignore_ascii_case("concurrent") {
                    is_concurrent = true;
                } else if !comment.is_empty() {
                    description = Some(comment.to_string());
                }
                i += 1;
            } else {
                break;
            }
        }

        if i >= lines.len() {
            break;
        }

        // Parse recipe header: name [args] [: deps...]
        let header = lines[i].trim();
        if header.is_empty() || header.starts_with('#') || header.starts_with("set ") {
            i += 1;
            continue;
        }

        let colon_pos = match header.find(':') {
            Some(p) => p,
            None => { i += 1; continue; }
        };
        let name_part = header[..colon_pos].trim();
        let deps_part = header[colon_pos + 1..].trim();

        let name = name_part.split_whitespace().next().unwrap_or("").to_string();
        if name.is_empty() {
            i += 1;
            continue;
        }

        let depends: Vec<String> = deps_part
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        // Collect recipe body (indented lines)
        i += 1;
        let mut body_lines = Vec::new();
        while i < lines.len() {
            let body_line = lines[i];
            if body_line.starts_with("    ") || body_line.starts_with('\t') {
                body_lines.push(body_line.trim().to_string());
                i += 1;
            } else if body_line.trim().is_empty() {
                i += 1;
            } else {
                break;
            }
        }

        let body = body_lines.join("\n");
        recipes.push(ParsedRecipe {
            name,
            description,
            depends,
            body,
            is_concurrent,
        });
    }

    // Build lookup map for dependency body resolution
    let recipe_map: HashMap<&str, &ParsedRecipe> = recipes
        .iter()
        .map(|r| (r.name.as_str(), r))
        .collect();

    // Build task list
    let mut tasks = Vec::new();
    for recipe in &recipes {
        if recipe.is_concurrent && !recipe.depends.is_empty() {
            // Concurrent recipe: resolve each dependency into a ConcurrentTask
            let concurrent: Vec<ConcurrentTask> = recipe
                .depends
                .iter()
                .filter_map(|dep| {
                    let _dep_recipe = recipe_map.get(dep.as_str())?;
                    Some(ConcurrentTask {
                        label: dep.clone(),
                        argv: vec!["just".to_string(), dep.clone()],
                        cwd: None,
                    })
                })
                .collect();

            if !concurrent.is_empty() {
                tasks.push(TaskDto {
                    id: format!("just-{}", recipe.name),
                    label: recipe.name.clone(),
                    argv: Vec::new(),
                    kind: "justfile".to_string(),
                    cwd: None,
                    description: recipe.description.clone(),
                    depends: recipe.depends.clone(),
                    source: serde_json::to_string(&concurrent).ok(),
                    concurrent: Some(concurrent),
                });
            }
        } else if !recipe.body.is_empty() {
            // Regular recipe
            tasks.push(TaskDto {
                id: format!("just-{}", recipe.name),
                label: recipe.name.clone(),
                argv: vec!["just".to_string(), recipe.name.clone()],
                kind: "justfile".to_string(),
                cwd: None,
                description: recipe.description.clone(),
                depends: recipe.depends.clone(),
                source: Some(recipe.body.clone()),
                concurrent: None,
            });
        }
    }

    tasks
}

pub fn write_justfile_task(path: &Path, task: &TaskDto) -> Result<(), String> {
    let mut content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            // Create new justfile
            String::new()
        }
    };

    // Ensure trailing newline
    if !content.ends_with('\n') {
        content.push('\n');
    }

    // Add concurrent annotation if applicable
    if task.concurrent.is_some() {
        content.push_str("# concurrent\n");
    }

    // Add description comment
    if let Some(ref desc) = task.description {
        content.push_str(&format!("# {}\n", desc));
    }

    // Add recipe header
    let name = &task.label;
    if task.depends.is_empty() {
        content.push_str(&format!("{}:\n", name));
    } else {
        let deps = task.depends.join(" ");
        content.push_str(&format!("{}: {}\n", name, deps));
    }

    // Add recipe body (empty for concurrent tasks, actual command otherwise)
    if task.concurrent.is_none() {
        let command = task.source.as_deref().unwrap_or(&name);
        for line in command.lines() {
            content.push_str(&format!("    {}\n", line));
        }
    } else if let Some(ref subs) = task.concurrent {
        // Also write dependency recipes for concurrent tasks
        for sub in subs {
            let sub_name = &sub.label;
            let cmd = sub.argv.join(" ");
            content.push('\n');
            content.push_str(&format!("{}:\n", sub_name));
            content.push_str(&format!("    {}\n", cmd));
        }
    }

    std::fs::write(path, content)
        .map_err(|e| format!("failed to write justfile: {}", e))?;

    Ok(())
}

pub fn delete_justfile_task(path: &Path, label: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::new();
    let mut i = 0;
    let mut skip_until_blank = false;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if skip_until_blank {
            if trimmed.is_empty() {
                skip_until_blank = false;
            }
            i += 1;
            continue;
        }

        // Check if this is the target recipe header
        if let Some(colon_pos) = trimmed.find(':') {
            let name_part = trimmed[..colon_pos].trim();
            let recipe_name = name_part.split_whitespace().next().unwrap_or("");
            if recipe_name == label {
                // Skip this recipe and its body
                skip_until_blank = true;
                i += 1;
                continue;
            }
        }

        result.push(line);
        i += 1;
    }

    let new_content = result.join("\n");

    // Check if any recipes remain (non-comment lines with ':' that aren't set directives)
    let has_recipes = new_content.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with('#') && !t.starts_with("set ") && t.contains(':')
    });

    if !has_recipes {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }

    std::fs::write(path, new_content)
        .map_err(|e| format!("failed to write justfile: {}", e))?;

    Ok(())
}

pub fn find_justfile(project_path: &Path) -> Option<std::path::PathBuf> {
    for name in &["justfile", "Justfile", ".justfile", ".Justfile"] {
        let p = project_path.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}
