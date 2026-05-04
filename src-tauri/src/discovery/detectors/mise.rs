use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::dirname_name;

pub struct MiseDetector;

impl ProjectDetector for MiseDetector {
    fn id(&self) -> &'static str {
        "mise"
    }

    fn priority(&self) -> i32 {
        110 // High priority to discover mise tasks
    }

    fn markers(&self) -> &'static [&'static str] {
        &["mise.toml", ".mise.toml", "mise.local.toml", ".mise.local.toml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let config_path = crate::task_config::mise::find_mise_config(path)?;
        let tasks = crate::task_config::mise::read_mise_tasks(&config_path);

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "mise".into(),
            runtime_hint: None,
            tasks,
            tags: vec!["mise".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
