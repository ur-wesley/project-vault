use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, script_task};

pub struct GradleDetector;

impl ProjectDetector for GradleDetector {
    fn id(&self) -> &'static str {
        "gradle"
    }

    fn priority(&self) -> i32 {
        82
    }

    fn markers(&self) -> &'static [&'static str] {
        &["build.gradle", "build.gradle.kts"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let a = path.join("build.gradle");
        let b = path.join("build.gradle.kts");
        let raw = if a.is_file() {
            read_utf8(&a)?
        } else if b.is_file() {
            read_utf8(&b)?
        } else {
            return None;
        };
        let lower = raw.to_lowercase();
        if raw.trim().len() < 8 {
            return None;
        }
        if !lower.contains("plugins")
            && !lower.contains("apply(")
            && !lower.contains("dependencies")
            && !lower.contains("android")
            && !lower.contains("java")
            && !lower.contains("kotlin")
            && !lower.contains("task ")
            && !lower.contains("rootproject")
        {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "gradle-build",
                "build",
                vec!["gradle".into(), "build".into()],
            ),
            script_task("gradle-test", "test", vec!["gradle".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "kotlin".into(),
            runtime_hint: Some("gradle".into()),
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

pub struct MavenDetector;

impl ProjectDetector for MavenDetector {
    fn id(&self) -> &'static str {
        "pom.xml"
    }

    fn priority(&self) -> i32 {
        81
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pom.xml"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let pom = path.join("pom.xml");
        if !pom.is_file() {
            return None;
        }
        let raw = read_utf8(&pom)?;
        if !raw.contains("<project") || !raw.contains("artifactId") {
            return None;
        }
        let name = dirname_name(path);
        let tasks = vec![
            script_task(
                "mvn-package",
                "package",
                vec!["mvn".into(), "-q".into(), "package".into()],
            ),
            script_task(
                "mvn-test",
                "test",
                vec!["mvn".into(), "-q".into(), "test".into()],
            ),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "java".into(),
            runtime_hint: Some("mvn".into()),
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
