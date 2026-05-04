use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct CargoTomlDetector;

impl ProjectDetector for CargoTomlDetector {
    fn id(&self) -> &'static str {
        "Cargo.toml"
    }

    fn priority(&self) -> i32 {
        90
    }

    fn markers(&self) -> &'static [&'static str] {
        &["Cargo.toml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let c = path.join("Cargo.toml");
        if !c.is_file() {
            return None;
        }
        let raw = read_utf8(&c)?;
        let t: toml::Value = toml::from_str(&raw).ok()?;
        let pkg_name = t
            .get("package")
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let name = pkg_name
            .map(String::from)
            .unwrap_or_else(|| dirname_name(path));
        if pkg_name.is_none() {
            if t.get("workspace").is_none() {
                return None;
            }
        }
        let tasks = vec![
            script_task("cargo-build", "build", vec!["cargo".into(), "build".into()]),
            script_task("cargo-test", "test", vec!["cargo".into(), "test".into()]),
            script_task("cargo-run", "run", vec!["cargo".into(), "run".into()]),
        ];
        let mut tags = vec![self.id().into()];
        if t.get("workspace").is_some() {
            tags.push("monorepo".into());
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "rust".into(),
            runtime_hint: Some("cargo".into()),
            tasks,
            tags,
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
