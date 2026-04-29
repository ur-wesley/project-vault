use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;

use crate::models::ToolCandidateDto;

#[cfg(windows)]
fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in ["", ".exe", ".cmd", ".bat"] {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn get_version(executable: &str, arg: &str) -> Option<String> {
    let mut cmd = Command::new(executable);
    cmd.arg(arg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?;
    let trimmed = first.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn discover_tools() -> Vec<ToolCandidateDto> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let candidates = [
        ("git", "git", "Git", "--version"),
        ("mise", "mise", "Mise", "--version"),
        ("just", "just", "Just", "--version"),
    ];

    for (id, name, label, version_arg) in candidates {
        if let Some(path) = path_lookup(name) {
            let exe = path.to_string_lossy().to_string();
            if seen.insert(exe.clone()) {
                let version = get_version(&exe, version_arg);
                out.push(ToolCandidateDto {
                    id: id.into(),
                    label: label.into(),
                    executable: exe,
                    version,
                });
            }
        }
    }

    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    out
}
