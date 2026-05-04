use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct GemfileDetector;

impl ProjectDetector for GemfileDetector {
    fn id(&self) -> &'static str {
        "Gemfile"
    }

    fn priority(&self) -> i32 {
        86
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Gemfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let gf = path.join("Gemfile");
        if !gf.is_file() {
            return None;
        }
        let raw = read_utf8(&gf)?;
        if !raw.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("gem ") || t.starts_with("source ")
        }) {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "bundle-install",
                "bundle install",
                vec!["bundle".into(), "install".into()],
            ),
            script_task(
                "rake-test",
                "rake test",
                vec!["bundle".into(), "exec".into(), "rake".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "ruby".into(),
            runtime_hint: Some("bundle".into()),
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
