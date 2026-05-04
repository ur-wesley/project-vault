use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct CMakeDetector;

impl ProjectDetector for CMakeDetector {
    fn id(&self) -> &'static str {
        "CMakeLists.txt"
    }

    fn priority(&self) -> i32 {
        48
    }

    fn markers(&self) -> &'static [&'static str] {
        &["CMakeLists.txt"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let cm = path.join("CMakeLists.txt");
        if !cm.is_file() {
            return None;
        }
        let raw = read_utf8(&cm)?;
        if !raw.to_lowercase().contains("project(") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "cmake-config",
                "configure",
                vec!["cmake".into(), "-B".into(), "build".into(), ".".into()],
            ),
            script_task(
                "cmake-build",
                "build",
                vec!["cmake".into(), "--build".into(), "build".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "cpp".into(),
            runtime_hint: Some("cmake".into()),
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
