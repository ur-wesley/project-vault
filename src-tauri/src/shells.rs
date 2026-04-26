#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::HashSet;
use std::path::PathBuf;

use crate::models::ShellCandidateDto;

#[cfg(windows)]
fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
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
fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub fn discover_shells() -> Vec<ShellCandidateDto> {
    let mut out = Vec::new();
    let mut seen_paths = HashSet::new();

    #[cfg(windows)]
    {
        let system32 = PathBuf::from(
            std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string()),
        )
        .join("System32");

        let candidates = [
            (
                "powershell",
                "PowerShell",
                system32.join("WindowsPowerShell\\v1.0\\powershell.exe"),
            ),
            ("cmd", "Command Prompt", system32.join("cmd.exe")),
            ("pwsh", "PowerShell Core", PathBuf::from("pwsh.exe")),
            ("nu", "Nushell", PathBuf::from("nu.exe")),
            (
                "git-bash",
                "Git Bash",
                PathBuf::from("C:\\Program Files\\Git\\bin\\bash.exe"),
            ),
            (
                "zsh-win",
                "Zsh (Git Bash)",
                PathBuf::from("C:\\Program Files\\Git\\usr\\bin\\zsh.exe"),
            ),
            ("wsl-bash", "WSL Bash", system32.join("bash.exe")),
        ];

        for (id, label, path) in candidates {
            let p = if path.is_absolute() {
                if path.is_file() {
                    Some(path)
                } else {
                    None
                }
            } else {
                path_dirs_lookup(path.to_str().unwrap())
            };

            if let Some(p) = p {
                let key = p.to_string_lossy().to_lowercase();
                if seen_paths.insert(key) {
                    out.push(ShellCandidateDto {
                        id: id.to_string(),
                        label: label.to_string(),
                        executable: p.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let candidates = [
            ("zsh", "zsh"),
            ("bash", "bash"),
            ("fish", "fish"),
            ("nu", "nu"),
            ("sh", "sh"),
        ];

        for (id, label) in candidates {
            if let Some(p) = path_dirs_lookup(id) {
                let key = p.to_string_lossy().to_string();
                if seen_paths.insert(key) {
                    out.push(ShellCandidateDto {
                        id: id.to_string(),
                        label: label.to_string(),
                        executable: p.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}
