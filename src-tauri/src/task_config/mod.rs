pub mod justfile;
pub mod mise;

use std::path::Path;

use crate::models::TaskDto;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskConfig {
    pub tasks: Vec<TaskDto>,
    pub has_mise_config: bool,
    pub has_justfile: bool,
    pub mise_path: Option<String>,
    pub justfile_path: Option<String>,
}

pub fn read_project_tasks(project_path: &Path) -> ProjectTaskConfig {
    let mut tasks = Vec::new();
    let mut has_mise_config = false;
    let mut has_justfile = false;
    let mut mise_path = None;
    let mut justfile_path = None;

    if let Some(path) = mise::find_mise_config(project_path) {
        has_mise_config = true;
        mise_path = Some(path.to_string_lossy().to_string());
        tasks.extend(mise::read_mise_tasks(&path));
    }

    if let Some(path) = justfile::find_justfile(project_path) {
        has_justfile = true;
        justfile_path = Some(path.to_string_lossy().to_string());
        tasks.extend(justfile::read_justfile_tasks(&path));
    }

    ProjectTaskConfig {
        tasks,
        has_mise_config,
        has_justfile,
        mise_path,
        justfile_path,
    }
}

pub fn write_project_task(
    project_path: &Path,
    task: &TaskDto,
) -> Result<(), String> {
    match task.kind.as_str() {
        "mise" => {
            let path = mise::find_mise_config(project_path)
                .unwrap_or_else(|| project_path.join("mise.toml"));
            mise::write_mise_task(&path, task)
        }
        "justfile" => {
            let path = justfile::find_justfile(project_path)
                .unwrap_or_else(|| project_path.join("justfile"));
            justfile::write_justfile_task(&path, task)
        }
        _ => Err(format!("unsupported task kind: {}", task.kind)),
    }
}

pub fn delete_project_task(
    project_path: &Path,
    task: &TaskDto,
) -> Result<(), String> {
    match task.kind.as_str() {
        "mise" => {
            if let Some(path) = mise::find_mise_config(project_path) {
                mise::delete_mise_task(&path, &task.label)
            } else {
                Ok(())
            }
        }
        "justfile" => {
            if let Some(path) = justfile::find_justfile(project_path) {
                justfile::delete_justfile_task(&path, &task.label)
            } else {
                Ok(())
            }
        }
        _ => Err(format!("unsupported task kind: {}", task.kind)),
    }
}
