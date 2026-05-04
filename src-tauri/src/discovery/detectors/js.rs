use std::path::Path;

use serde_json::Value as JsonValue;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{
    dirname_name, package_json_looks_real, package_json_stack, read_utf8, script_task,
};

pub struct PackageJsonDetector;

impl ProjectDetector for PackageJsonDetector {
    fn id(&self) -> &'static str {
        "package.json"
    }

    fn priority(&self) -> i32 {
        100
    }

    fn markers(&self) -> &'static [&'static str] {
        &["package.json"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let pj = path.join("package.json");
        if !pj.is_file() {
            return None;
        }
        let raw = read_utf8(&pj)?;
        let v: JsonValue = serde_json::from_str(&raw).ok()?;
        if !package_json_looks_real(&v) {
            return None;
        }
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| dirname_name(path));

        let package_manager = v.get("packageManager").and_then(|x| x.as_str());
        let (pm, run_args): (&str, &[&str]) = if let Some(pm_str) = package_manager {
            if pm_str.starts_with("bun") {
                ("bun", &["run"])
            } else if pm_str.starts_with("pnpm") {
                ("pnpm", &["run"])
            } else if pm_str.starts_with("yarn") {
                ("yarn", &["run"])
            } else {
                ("npm", &["run"])
            }
        } else if path.join("bun.lockb").is_file() || path.join("bun.lock").is_file() || path.join("bunfig.toml").is_file() {
            ("bun", &["run"])
        } else if path.join("pnpm-lock.yaml").is_file() {
            ("pnpm", &["run"])
        } else if path.join("yarn.lock").is_file() {
            ("yarn", &["run"])
        } else {
            // Check if any script starts with bun
            let mut uses_bun = false;
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                for v in scripts.values() {
                    if let Some(s) = v.as_str() {
                        if s.trim().starts_with("bun ") {
                            uses_bun = true;
                            break;
                        }
                    }
                }
            }
            if uses_bun {
                ("bun", &["run"])
            } else {
                ("npm", &["run"])
            }
        };

        let mut tasks = Vec::new();
        if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
            let preferred = ["dev", "start", "test", "build", "lint"];
            for key in preferred {
                if scripts.contains_key(key) {
                    let argv = vec![pm.to_string(), run_args[0].to_string(), key.to_string()];
                    tasks.push(script_task(&format!("js-{key}"), key, argv));
                }
            }
            let mut rest: Vec<_> = scripts.keys().map(String::as_str).collect();
            rest.sort_unstable();
            for key in rest {
                if preferred.contains(&key) {
                    continue;
                }
                let argv = vec![pm.to_string(), run_args[0].to_string(), key.to_string()];
                tasks.push(script_task(&format!("js-{key}"), key, argv));
            }
        }
        let hint = match pm {
            "bun" => "bun",
            _ => "node",
        };
        let stack = package_json_stack(&v, path);
        let mut tags = vec![self.id().into()];
        if v.get("workspaces").is_some() || path.join("pnpm-workspace.yaml").is_file() {
            tags.push("monorepo".into());
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack,
            runtime_hint: Some(hint.to_string()),
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

/// Detects pnpm workspace roots that lack a `package.json` (or have one that
/// `PackageJsonDetector` rejects). Ensures `pnpm-workspace.yaml` drives
/// workspace discovery even when no root package manifest is present.
pub struct PnpmWorkspaceDetector;

impl ProjectDetector for PnpmWorkspaceDetector {
    fn id(&self) -> &'static str {
        "pnpm-workspace"
    }

    fn priority(&self) -> i32 {
        98 // Just below PackageJsonDetector (100)
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pnpm-workspace.yaml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let ws = path.join("pnpm-workspace.yaml");
        if !ws.is_file() {
            return None;
        }
        // Only match when PackageJsonDetector did NOT already match.
        // If package.json exists, PackageJsonDetector (priority 100) already
        // handled this directory and merged in the monorepo tag.
        if path.join("package.json").is_file() {
            return None;
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "javascript".into(),
            runtime_hint: Some("pnpm".into()),
            tasks: Vec::new(),
            tags: vec![self.id().into(), "monorepo".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
