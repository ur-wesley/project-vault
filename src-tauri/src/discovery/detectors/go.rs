use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct GoModDetector;

impl ProjectDetector for GoModDetector {
    fn id(&self) -> &'static str {
        "go.mod"
    }

    fn priority(&self) -> i32 {
        95
    }

    fn markers(&self) -> &'static [&'static str] {
        &["go.mod"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let g = path.join("go.mod");
        if !g.is_file() {
            return None;
        }
        let raw = read_utf8(&g)?;
        let mut module_name = None;
        let mut go_ver = None;
        for line in raw.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("module ") {
                module_name = Some(rest.trim().to_string());
            } else if let Some(rest) = t.strip_prefix("go ") {
                go_ver = Some(rest.trim().to_string());
            }
        }
        let name = module_name
            .as_deref()
            .and_then(|m| m.rsplit('/').next())
            .map(String::from)
            .unwrap_or_else(|| dirname_name(path));
        let mut tasks = vec![
            script_task(
                "go-build",
                "build",
                vec!["go".into(), "build".into(), "./...".into()],
            ),
            script_task(
                "go-test",
                "test",
                vec!["go".into(), "test".into(), "./...".into()],
            ),
        ];
        tasks.push(script_task(
            "go-mod-tidy",
            "mod tidy",
            vec!["go".into(), "mod".into(), "tidy".into()],
        ));
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "go".into(),
            runtime_hint: go_ver,
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

pub struct GoWorkDetector;

impl ProjectDetector for GoWorkDetector {
    fn id(&self) -> &'static str {
        "go.work"
    }

    fn priority(&self) -> i32 {
        96
    }

    fn markers(&self) -> &'static [&'static str] {
        &["go.work"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let gw = path.join("go.work");
        if !gw.is_file() {
            return None;
        }
        let raw = read_utf8(&gw)?;
        if !raw.lines().any(|l| {
            let t = l.trim();
            let mut it = t.split_ascii_whitespace();
            it.next() == Some("go") && it.next().is_some()
        }) {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "go-work-build",
                "build",
                vec!["go".into(), "build".into(), "./...".into()],
            ),
            script_task(
                "go-work-test",
                "test",
                vec!["go".into(), "test".into(), "./...".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "go".into(),
            runtime_hint: Some("go".into()),
            tasks,
            tags: vec![self.id().into(), "monorepo".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
