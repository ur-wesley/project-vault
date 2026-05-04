use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct MixExsDetector;

impl ProjectDetector for MixExsDetector {
    fn id(&self) -> &'static str {
        "mix.exs"
    }

    fn priority(&self) -> i32 {
        85
    }

    fn markers(&self) -> &'static [&'static str] {
        &["mix.exs"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let mx = path.join("mix.exs");
        if !mx.is_file() {
            return None;
        }
        let raw = read_utf8(&mx)?;
        if !raw.contains("Mix.Project") && !raw.contains("def project") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "mix-deps",
                "deps.get",
                vec!["mix".into(), "deps.get".into()],
            ),
            script_task("mix-test", "test", vec!["mix".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "elixir".into(),
            runtime_hint: Some("mix".into()),
            tasks,
            tags: vec![self.id().into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
