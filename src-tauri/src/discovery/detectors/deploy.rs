use std::path::Path;

use super::util::dirname_name;
use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;

/// Supplemental detector: tags projects that look deployable,
/// with a strong `dokploy` tag when Dokploy-specific markers exist.
///
/// Strong (Dokploy) markers: `dokploy.yaml|yml`, `dokploy.json`, `.dokploy/`
/// Generic (Docker/Compose) markers: `Dockerfile*`, `docker-compose.yml|yaml`,
/// `compose.yml|yaml`, `compose.yaml`.
///
/// Priority is below `GitDetector` (0) so it only enriches tags/tasks
/// and never overrides the primary language stack.
pub struct DeployDetector;

fn file_exists(path: &Path, name: &str) -> bool {
    path.join(name).is_file()
}

fn dir_exists(path: &Path, name: &str) -> bool {
    path.join(name).is_dir()
}

fn has_dockerfile(path: &Path) -> bool {
    const NAMES: [&str; 4] = [
        "Dockerfile",
        "dockerfile",
        "Dockerfile.dev",
        "docker-compose.Dockerfile",
    ];
    if NAMES.iter().any(|n| file_exists(path, n)) {
        return true;
    }
    // Dockerfile.<target> variants, e.g. Dockerfile.prod
    let Ok(read) = std::fs::read_dir(path) else {
        return false;
    };
    read.flatten().any(|e| {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            return false;
        }
        e.file_name()
            .to_str()
            .map(|n| n == "Dockerfile" || n.starts_with("Dockerfile."))
            .unwrap_or(false)
    })
}

fn has_compose(path: &Path) -> bool {
    const NAMES: [&str; 6] = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
        "docker-compose.override.yml",
        "compose.override.yml",
    ];
    NAMES.iter().any(|n| file_exists(path, n))
}

pub fn has_dokploy_marker(path: &Path) -> bool {
    file_exists(path, "dokploy.yaml")
        || file_exists(path, "dokploy.yml")
        || file_exists(path, "dokploy.json")
        || file_exists(path, ".dokploy.yaml")
        || file_exists(path, ".dokploy.yml")
        || dir_exists(path, ".dokploy")
}

pub fn has_docker_marker(path: &Path) -> bool {
    has_dockerfile(path) || has_compose(path)
}

impl ProjectDetector for DeployDetector {
    fn id(&self) -> &'static str {
        "deploy"
    }

    fn priority(&self) -> i32 {
        -10
    }

    fn markers(&self) -> &'static [&'static str] {
        &[]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let dokploy = has_dokploy_marker(path);
        let docker = has_docker_marker(path);
        if !dokploy && !docker {
            return None;
        }
        let mut tags = Vec::new();
        if docker {
            tags.push("docker".to_string());
        }
        if has_compose(path) {
            tags.push("compose".to_string());
        }
        if dokploy {
            tags.push("dokploy".to_string());
        }
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: if dokploy {
                "dokploy".into()
            } else {
                "docker".into()
            },
            runtime_hint: None,
            tasks: Vec::new(),
            tags,
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
    fn detects_dokploy_yaml() {
        let base = tmp("pv-deploy-dokploy");
        fs::write(base.join("dokploy.yaml"), "name: app\n").unwrap();
        let d = DeployDetector.detect(&base).unwrap();
        assert!(d.tags.contains(&"dokploy".to_string()));
    }

    #[test]
    fn detects_dockerfile_and_compose() {
        let base = tmp("pv-deploy-docker");
        fs::write(base.join("Dockerfile"), "FROM node:20\n").unwrap();
        fs::write(
            base.join("docker-compose.yml"),
            "services:\n  app:\n    build: .\n",
        )
        .unwrap();
        let d = DeployDetector.detect(&base).unwrap();
        assert!(d.tags.contains(&"docker".to_string()));
        assert!(d.tags.contains(&"compose".to_string()));
        assert!(!d.tags.contains(&"dokploy".to_string()));
    }

    #[test]
    fn empty_dir_is_none() {
        let base = tmp("pv-deploy-none");
        assert!(DeployDetector.detect(&base).is_none());
    }

    #[test]
    fn merges_without_overriding_stack() {
        // Simulates registry merge: primary (high priority) keeps its stack,
        // supplemental tags are appended.
        let base = tmp("pv-deploy-merge");
        fs::write(base.join("package.json"), r#"{"name":"app"}"#).unwrap();
        fs::write(base.join("Dockerfile"), "FROM node:20\n").unwrap();
        let mut merged_tags = vec!["javascript".to_string()];
        let d = DeployDetector.detect(&base).unwrap();
        for tag in &d.tags {
            if !merged_tags.contains(tag) {
                merged_tags.push(tag.clone());
            }
        }
        assert!(merged_tags.contains(&"docker".to_string()));
    }
}
