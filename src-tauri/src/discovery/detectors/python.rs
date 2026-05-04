use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8, requirements_txt_has_package_line, script_task};

pub struct PythonDetector;

impl ProjectDetector for PythonDetector {
    fn id(&self) -> &'static str {
        "python"
    }

    fn priority(&self) -> i32 {
        70
    }

    fn markers(&self) -> &'static [&'static str] {
        &["pyproject.toml", "requirements.txt", "Pipfile"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let py = path.join("pyproject.toml");
        let req = path.join("requirements.txt");
        let pip = path.join("Pipfile");
        let marker = if py.is_file() {
            "pyproject.toml"
        } else if req.is_file() {
            let sample = read_utf8(&req)?;
            if !requirements_txt_has_package_line(&sample) {
                return None;
            }
            "requirements.txt"
        } else if pip.is_file() {
            let sample = read_utf8(&pip)?;
            if !sample.contains("[packages]")
                && !sample.contains("[[source]]")
                && !sample.contains("[dev-packages]")
                && !sample.contains("python_version")
            {
                return None;
            }
            "Pipfile"
        } else {
            return None;
        };
        let mut name = dirname_name(path);
        let mut hint = Some("python3".into());
        if py.is_file() {
            let raw = read_utf8(&py)?;
            let t: toml::Value = toml::from_str(&raw).ok()?;
            let has_project = t.get("project").is_some();
            let has_poetry = t.get("tool").and_then(|x| x.get("poetry")).is_some();
            let has_tool_other = t.get("tool").is_some() && !has_poetry;
            let has_build = t.get("build-system").is_some();
            if !has_project && !has_poetry && !has_tool_other && !has_build {
                return None;
            }
            if has_project {
                if let Some(n) = t
                    .get("project")
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                {
                    name = n.to_string();
                } else if !has_poetry {
                    let p = t.get("project");
                    let ok = p.and_then(|x| x.get("dependencies")).is_some()
                        || p.and_then(|x| x.get("optional-dependencies")).is_some()
                        || p.and_then(|x| x.get("dynamic")).is_some()
                        || p.and_then(|x| x.get("readme")).is_some();
                    if !ok {
                        return None;
                    }
                }
            }
            if let Some(req) = t
                .get("project")
                .and_then(|p| p.get("requires-python"))
                .and_then(|r| r.as_str())
            {
                hint = Some(req.to_string());
            }
        }
        let mut tasks = vec![script_task(
            "py-install",
            "install deps",
            vec![
                "python".into(),
                "-m".into(),
                "pip".into(),
                "install".into(),
                ".".into(),
            ],
        )];
        if req.is_file() {
            tasks.push(script_task(
                "py-pip-req",
                "pip install -r",
                vec![
                    "python".into(),
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "-r".into(),
                    "requirements.txt".into(),
                ],
            ));
        }
        if pip.is_file() {
            tasks.push(script_task(
                "py-pipenv",
                "pipenv install",
                vec!["pipenv".into(), "install".into()],
            ));
        }
        tasks.push(script_task(
            "py-pytest",
            "pytest",
            vec!["python".into(), "-m".into(), "pytest".into()],
        ));
        Some(ProjectDraft {
            root: path.to_path_buf(),
            name,
            stack: "python".into(),
            runtime_hint: hint,
            tasks,
            tags: vec![self.id().into(), marker.into()],
            github_owner: None,
            github_repo: None,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}
