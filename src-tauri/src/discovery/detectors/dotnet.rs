use std::fs;
use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{read_utf8, script_task};

pub struct SolutionDetector;

impl ProjectDetector for SolutionDetector {
    fn id(&self) -> &'static str {
        "dotnet-sln"
    }

    fn priority(&self) -> i32 {
        78
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".sln"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let rd = fs::read_dir(path).ok()?;
        let mut sln: Option<String> = None;
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with(".sln") && e.path().is_file() {
                if let Some(hdr) = read_utf8(&e.path()) {
                    if hdr.contains("Microsoft Visual Studio Solution File") {
                        sln = Some(n.trim_end_matches(".sln").to_string());
                        break;
                    }
                }
            }
        }
        let name = sln?;
        let tasks = vec![
            script_task(
                "dotnet-build",
                "build",
                vec!["dotnet".into(), "build".into()],
            ),
            script_task("dotnet-test", "test", vec!["dotnet".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "dotnet".into(),
            runtime_hint: Some("dotnet".into()),
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

pub struct CsProjDetector;

impl ProjectDetector for CsProjDetector {
    fn id(&self) -> &'static str {
        "dotnet-csproj"
    }

    fn priority(&self) -> i32 {
        74
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".csproj"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let rd = fs::read_dir(path).ok()?;
        let mut csproj: Option<String> = None;
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with(".csproj") && e.path().is_file() {
                if read_utf8(&e.path()).map(|s| s.to_lowercase().contains("<project")) == Some(true)
                {
                    csproj = Some(n.trim_end_matches(".csproj").to_string());
                    break;
                }
            }
        }
        let name = csproj?;
        let tasks = vec![
            script_task(
                "dotnet-build",
                "build",
                vec!["dotnet".into(), "build".into()],
            ),
            script_task("dotnet-test", "test", vec!["dotnet".into(), "test".into()]),
        ];
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "dotnet".into(),
            runtime_hint: Some("dotnet".into()),
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
