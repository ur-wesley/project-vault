use std::fs;
use std::path::Path;

use super::util::dirname_name;
use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;

/// Supplemental detector: tags projects that have GitHub Actions workflows.
///
/// Reads `<root>/.github/workflows/*.yml|*.yaml` directly instead of walking
/// `.github` (which stays in the scanner skip-list for performance).
/// Priority is intentionally below `GitDetector` (0) so it only ever
/// enriches tags and never overrides the primary stack.
pub struct GithubActionsDetector;

fn is_workflow_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    (lower.ends_with(".yml") || lower.ends_with(".yaml")) && !lower.starts_with('.')
}

pub fn has_github_workflows(path: &Path) -> bool {
    let dir = path.join(".github").join("workflows");
    if !dir.is_dir() {
        return false;
    }
    let Ok(read) = fs::read_dir(&dir) else {
        return false;
    };
    read.flatten().any(|e| {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            return false;
        }
        e.file_name()
            .to_str()
            .map(is_workflow_file)
            .unwrap_or(false)
    })
}

impl ProjectDetector for GithubActionsDetector {
    fn id(&self) -> &'static str {
        "github-actions"
    }

    fn priority(&self) -> i32 {
        -10
    }

    fn markers(&self) -> &'static [&'static str] {
        &[]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        if !has_github_workflows(path) {
            return None;
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "github-actions".into(),
            runtime_hint: None,
            tasks: Vec::new(),
            tags: vec!["github-actions".into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn detects_yml_workflow() {
        let base = tmp("pv-ci-yml");
        let wf = base.join(".github").join("workflows");
        fs::create_dir_all(&wf).unwrap();
        fs::write(wf.join("ci.yml"), "name: ci\non: [push]\n").unwrap();
        assert!(has_github_workflows(&base));
        let d = GithubActionsDetector.detect(&base).unwrap();
        assert!(d.tags.contains(&"github-actions".to_string()));
    }

    #[test]
    fn ignores_non_workflow_files() {
        let base = tmp("pv-ci-none");
        let wf = base.join(".github").join("workflows");
        fs::create_dir_all(&wf).unwrap();
        fs::write(wf.join("README.md"), "# docs\n").unwrap();
        assert!(!has_github_workflows(&base));
        assert!(GithubActionsDetector.detect(&base).is_none());
    }

    #[test]
    fn missing_dir_is_none() {
        let base = tmp("pv-ci-missing");
        assert!(GithubActionsDetector.detect(&base).is_none());
    }
}
