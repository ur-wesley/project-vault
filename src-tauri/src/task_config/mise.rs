use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::models::{ConcurrentTask, TaskDto};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiseTaskEntry {
    pub run: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub depends: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
}

pub fn read_mise_tasks(path: &Path) -> Vec<TaskDto> {
    let mut tasks = Vec::new();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return tasks,
    };

    let doc: toml::Value = match toml::from_str(&content) {
        Ok(d) => d,
        Err(_) => return tasks,
    };

    let tasks_table = match doc.get("tasks") {
        Some(toml::Value::Table(t)) => t,
        _ => return tasks,
    };

    for (name, value) in tasks_table {
        let (run, description, depends, dir, concurrent) = match value {
            toml::Value::String(cmd) => (cmd.clone(), None, Vec::new(), None, None),
            toml::Value::Table(t) => {
                let description = t.get("description").and_then(|v| v.as_str()).map(String::from);
                let depends = t.get("depends")
                    .and_then(|v| match v {
                        toml::Value::Array(arr) => Some(
                            arr.iter()
                                .filter_map(|x| x.as_str().map(String::from))
                                .collect(),
                        ),
                        toml::Value::String(s) => Some(vec![s.clone()]),
                        _ => None,
                    })
                    .unwrap_or_default();
                let dir = t.get("dir").and_then(|v| v.as_str()).map(String::from);

                // Check for concurrent array
                let concurrent = t.get("concurrent").and_then(|v| {
                    if let toml::Value::Array(arr) = v {
                        let subs: Vec<ConcurrentTask> = arr.iter().filter_map(|entry| {
                            if let toml::Value::Table(et) = entry {
                                let label = et.get("label").and_then(|v| v.as_str())?.to_string();
                                let run = et.get("run").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                if run.is_empty() { return None; }
                                let entry_dir = et.get("dir").and_then(|v| v.as_str()).map(String::from);
                                Some(ConcurrentTask {
                                    label,
                                    argv: shell_words::split(&run).unwrap_or_else(|_| vec![run]),
                                    cwd: entry_dir,
                                })
                            } else {
                                None
                            }
                        }).collect();
                        if subs.is_empty() { None } else { Some(subs) }
                    } else {
                        None
                    }
                });

                if concurrent.is_some() {
                    // Concurrent task — no run field needed
                    (String::new(), description, depends, dir, concurrent)
                } else {
                    let run = t.get("run")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (run, description, depends, dir, None)
                }
            }
            _ => continue,
        };

        if run.is_empty() && concurrent.is_none() {
            continue;
        }

        let source = if let Some(ref subs) = concurrent {
            serde_json::to_string(subs).ok()
        } else {
            Some(run.clone())
        };

        tasks.push(TaskDto {
            id: format!("mise-{}", name),
            label: name.clone(),
            argv: if concurrent.is_some() { Vec::new() } else { vec!["mise".to_string(), "run".to_string(), name.clone()] },
            kind: "mise".to_string(),
            cwd: dir.clone(),
            description,
            depends,
            source,
            concurrent,
        });
    }

    tasks
}

pub fn write_mise_task(path: &Path, task: &TaskDto) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            // Create new file with basic structure
            let mut doc = toml_edit::DocumentMut::new();
            doc["tasks"] = toml_edit::Item::Table(toml_edit::Table::new());
            std::fs::write(path, doc.to_string())
                .map_err(|e| format!("failed to create mise.toml: {}", e))?;
            std::fs::read_to_string(path).unwrap_or_default()
        }
    };

    let mut doc: toml_edit::DocumentMut = content
        .parse()
        .map_err(|e| format!("failed to parse mise.toml: {}", e))?;

    // Ensure [tasks] section exists
    if !doc.contains_key("tasks") {
        doc["tasks"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    let tasks_table = doc["tasks"]
        .as_table_mut()
        .ok_or("tasks is not a table")?;

    let name = task.label.clone();

    if let Some(ref subs) = task.concurrent {
        // Write concurrent task as a table with concurrent array
        let mut table = toml_edit::Table::new();
        table.set_implicit(true);

        if let Some(ref desc) = task.description {
            table.insert("description", toml_edit::Item::Value(toml_edit::Value::from(desc.as_str())));
        }

        if !task.depends.is_empty() {
            let arr: toml_edit::Array = task.depends.iter().map(|s| toml_edit::Value::from(s.as_str())).collect();
            table.insert("depends", toml_edit::Item::Value(toml_edit::Value::Array(arr)));
        }

        // Build concurrent array
        let mut arr = toml_edit::Array::new();
        for sub in subs {
            let mut entry = toml_edit::InlineTable::new();
            entry.insert("label", toml_edit::Value::from(sub.label.as_str()));
            let run_cmd = sub.argv.join(" ");
            entry.insert("run", toml_edit::Value::from(run_cmd.as_str()));
            if let Some(ref d) = sub.cwd {
                entry.insert("dir", toml_edit::Value::from(d.as_str()));
            }
            arr.push(toml_edit::Value::InlineTable(entry));
        }
        table.insert("concurrent", toml_edit::Item::Value(toml_edit::Value::Array(arr)));

        tasks_table.insert(&name, toml_edit::Item::Table(table));
    } else {
        // Write regular task as inline table
        let run = task.source.clone()
            .filter(|s| !s.is_empty())
            .or_else(|| task.argv.get(2..).map(|a| a.join(" ")))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| task.label.clone());

        let mut inline = toml_edit::InlineTable::new();
        inline.insert("run", toml_edit::Value::from(run));

        if let Some(ref desc) = task.description {
            inline.insert("description", toml_edit::Value::from(desc.as_str()));
        }

        if !task.depends.is_empty() {
            let arr: toml_edit::Array = task.depends.iter().map(|s| toml_edit::Value::from(s.as_str())).collect();
            inline.insert("depends", toml_edit::Value::Array(arr));
        }

        if let Some(ref dir) = task.cwd {
            inline.insert("dir", toml_edit::Value::from(dir.as_str()));
        }

        tasks_table.insert(&name, toml_edit::Item::Value(toml_edit::Value::InlineTable(inline)));
    }

    std::fs::write(path, doc.to_string())
        .map_err(|e| format!("failed to write mise.toml: {}", e))?;

    Ok(())
}

pub fn delete_mise_task(path: &Path, label: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    let mut doc: toml_edit::DocumentMut = content
        .parse()
        .map_err(|e| format!("failed to parse mise.toml: {}", e))?;

    let tasks_table = match doc["tasks"].as_table_mut() {
        Some(t) => t,
        None => return Ok(()),
    };

    tasks_table.remove(label);

    // If [tasks] is now empty, delete the entire file
    if tasks_table.is_empty() {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }

    std::fs::write(path, doc.to_string())
        .map_err(|e| format!("failed to write mise.toml: {}", e))?;

    Ok(())
}

pub fn find_mise_config(project_path: &Path) -> Option<std::path::PathBuf> {
    for name in &["mise.toml", ".mise.toml", "mise.local.toml", ".mise.local.toml"] {
        let p = project_path.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}
