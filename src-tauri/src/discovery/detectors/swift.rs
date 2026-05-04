use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct SwiftPackageDetector;

impl ProjectDetector for SwiftPackageDetector {
    fn id(&self) -> &'static str {
        "Package.swift"
    }

    fn priority(&self) -> i32 {
        80
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Package.swift"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let sp = path.join("Package.swift");
        if !sp.is_file() {
            return None;
        }
        let raw = read_utf8(&sp)?;
        if !raw.contains("Package(") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task("swift-build", "build", vec!["swift".into(), "build".into()]),
            script_task("swift-test", "test", vec!["swift".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "swift".into(),
            runtime_hint: Some("swift".into()),
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
