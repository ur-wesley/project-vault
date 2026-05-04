use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::dirname_name;

pub struct JustfileDetector;

impl ProjectDetector for JustfileDetector {
    fn id(&self) -> &'static str {
        "justfile"
    }

    fn priority(&self) -> i32 {
        105
    }

    fn markers(&self) -> &'static [&'static str] {
        &["justfile", "Justfile", ".justfile", ".Justfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let justfile_path = crate::task_config::justfile::find_justfile(path)?;
        let tasks = crate::task_config::justfile::read_justfile_tasks(&justfile_path);

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "justfile".into(),
            runtime_hint: None,
            tasks,
            tags: vec!["justfile".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
