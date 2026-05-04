use std::path::Path;

use serde_json::Value as JsonValue;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct ComposerDetector;

impl ProjectDetector for ComposerDetector {
    fn id(&self) -> &'static str {
        "composer.json"
    }

    fn priority(&self) -> i32 {
        88
    }

    fn markers(&self) -> &'static [&'static str] {
        &["composer.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let c = path.join("composer.json");
        if !c.is_file() {
            return None;
        }
        let raw = read_utf8(&c)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        let Some(o) = v.as_object() else {
            return None;
        };
        let has_body = o.contains_key("name")
            || o.contains_key("require")
            || o.contains_key("require-dev")
            || o.contains_key("autoload")
            || o.contains_key("repositories")
            || o.contains_key("type")
            || o.contains_key("config");
        if !has_body {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));
        let tasks = vec![
            script_task(
                "composer-install",
                "install",
                vec!["composer".into(), "install".into()],
            ),
            script_task(
                "composer-test",
                "test",
                vec!["composer".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "php".into(),
            runtime_hint: Some("composer".into()),
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
