use std::path::Path;

use crate::discovery::draft::ProjectDraft;
use crate::discovery::ProjectDetector;
use super::util::{dirname_name, read_utf8};

pub struct GitDetector;

impl ProjectDetector for GitDetector {
    fn id(&self) -> &'static str {
        "git"
    }

    fn priority(&self) -> i32 {
        0
    }

    fn markers(&self) -> &'static [&'static str] {
        &[".git"]
    }

    fn detect(&self, path: &Path) -> Option<ProjectDraft> {
        let git_dir = path.join(".git");
        if !git_dir.exists() {
            return None;
        }

        let mut owner = None;
        let mut repo = None;

        // Try to resolve github remote
        let config_path = if git_dir.is_dir() {
            Some(git_dir.join("config"))
        } else if git_dir.is_file() {
            // Handle git-worktree or submodules (gitdir: ...)
            read_utf8(&git_dir).and_then(|text| {
                text.lines().find_map(|l| {
                    l.trim().strip_prefix("gitdir: ").map(|rest| {
                        let p = Path::new(rest.trim());
                        if p.is_absolute() {
                            p.join("config")
                        } else {
                            path.join(p).join("config")
                        }
                    })
                })
            })
        } else {
            None
        };

        if let Some(cp) = config_path {
            if let Some(config) = read_utf8(&cp) {
                if let Some(url) = find_github_url(&config) {
                    if let Some((o, r)) = parse_github_owner_repo(&url) {
                        owner = Some(o);
                        repo = Some(r);
                    }
                }
            }
        }

        Some(ProjectDraft {
            root: path.to_path_buf(),
            name: dirname_name(path),
            stack: "git".into(),
            runtime_hint: None,
            tasks: Vec::new(),
            tags: vec!["git".into()],
            github_owner: owner,
            github_repo: repo,
            file_count: 0,
            size_bytes: 0,
            last_edited_at_ms: None,
        })
    }
}

fn find_github_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t == r#"[remote "origin"]"#;
            continue;
        }
        if in_origin {
            if let Some(rest) = t.strip_prefix("url = ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let tail = if let Some(rest) = u.strip_prefix("git@github.com:") {
        Some(rest)
    } else if let Some(rest) = u.strip_prefix("ssh://git@github.com/") {
        Some(rest)
    } else {
        u.rfind("github.com/")
            .map(|idx| &u[idx + "github.com/".len()..])
    };

    let t = tail?.trim().trim_end_matches('/').trim_end_matches(".git");
    let (a, b) = t.split_once('/')?;
    if a.is_empty() || b.is_empty() {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}
