use std::path::Path;

use crate::models::TaskDto;

pub fn read_justfile_tasks(path: &Path) -> Vec<TaskDto> {
    let mut tasks = Vec::new();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return tasks,
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        // Skip blank lines and comments that aren't descriptions
        if line.is_empty() {
            i += 1;
            continue;
        }

        // Collect description comments
        let mut description = None;
        while i < lines.len() {
            let l = lines[i].trim();
            if l.starts_with('#') {
                let desc = l.trim_start_matches('#').trim();
                if !desc.is_empty() {
                    description = Some(desc.to_string());
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

        // Check if this line looks like a recipe header
        let colon_pos = header.find(':');
        if colon_pos.is_none() {
            i += 1;
            continue;
        }

        let colon_pos = colon_pos.unwrap();
        let name_part = header[..colon_pos].trim();
        let deps_part = header[colon_pos + 1..].trim();

        // Extract recipe name (ignore args for now)
        let name = name_part.split_whitespace().next().unwrap_or("").to_string();
        if name.is_empty() {
            i += 1;
            continue;
        }

        // Parse dependencies
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

        let run = body_lines.join("\n");
        if run.is_empty() {
            continue;
        }

        tasks.push(TaskDto {
            id: format!("just-{}", name),
            label: name.clone(),
            argv: vec!["just".to_string(), name.clone()],
            kind: "justfile".to_string(),
            cwd: None,
            description,
            depends,
            source: Some(run),
        });
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

    // Add recipe body
    let command = task.source.as_deref().unwrap_or(&name);
    for line in command.lines() {
        content.push_str(&format!("    {}\n", line));
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
