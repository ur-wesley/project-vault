use std::path::Path;

use serde_json::Value as JsonValue;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct DenoDetector;

impl ProjectDetector for DenoDetector {
    fn id(&self) -> &'static str {
        "deno.json"
    }

    fn priority(&self) -> i32 {
        99
    }

    fn markers(&self) -> &'static [&'static str] {
        &["deno.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let mut tasks = vec![
            script_task(
                "deno-run",
                "run",
                vec!["deno".into(), "run".into(), "-A".into(), "main.ts".into()],
            ),
            script_task(
                "deno-test",
                "test",
                vec!["deno".into(), "test".into(), "-A".into()],
            ),
        ];
        let deno_json = path.join("deno.json");
        if !deno_json.is_file() {
            return None;
        }
        let raw = read_utf8(&deno_json)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        if !v.is_object() {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));
        if let Some(scripts) = v.get("tasks").and_then(|s| s.as_object()) {
            for (k, _) in scripts.iter() {
                tasks.push(script_task(
                    &format!("deno-task-{k}"),
                    k,
                    vec!["deno".into(), "task".into(), k.clone()],
                ));
            }
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "deno".into(),
            runtime_hint: Some("deno".into()),
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
