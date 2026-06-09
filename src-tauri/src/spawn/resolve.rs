use std::path::Path;
use std::sync::OnceLock;

static MISE_AVAILABLE: OnceLock<bool> = OnceLock::new();

#[allow(dead_code)]
pub fn project_has_mise_config(root: &Path) -> bool {
    let mut cur: Option<&Path> = Some(root);
    while let Some(p) = cur {
        if p.join(".mise.toml").is_file()
            || p.join("mise.toml").is_file()
            || p.join(".tool-versions").is_file()
        {
            return true;
        }
        cur = p.parent();
    }
    false
}

pub fn mise_available() -> bool {
    *MISE_AVAILABLE.get_or_init(|| {
        let mut cmd = crate::process_util::hidden_command("mise");
        cmd.arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        cmd.status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

pub fn use_mise_for_project(root: &Path) -> bool {
    mise_available() && project_has_mise_config(root)
}

pub fn get_mise_tool_args(hint: Option<&str>, stack: &str, argv: &[String]) -> Vec<String> {
    let mut args = vec!["mise".to_string(), "exec".to_string()];

    // Determine the base tool name from the stack
    let tool_base = match stack {
        "javascript" | "typescript" | "node" => "node",
        "bun" => "bun",
        "go" => "go",
        "rust" => "rust",
        "python" => "python",
        "dotnet" | "csharp" | "cpp" => "dotnet",
        "deno" => "deno",
        "php" => "php",
        "ruby" => "ruby",
        "elixir" => "elixir",
        _ => stack,
    };

    if let Some(h) = hint {
        // If the hint looks like a version (starts with digit or operator), combine it
        if h.chars()
            .next()
            .map(|c| c.is_ascii_digit() || c == '>' || c == '<' || c == '=')
            .unwrap_or(false)
        {
            args.push(format!("{}@{}", tool_base, h));
        } else {
            // If the hint is a tool name (like 'bun' or 'node'), use it as the sole tool
            args.push(h.to_string());
        }
    } else {
        args.push(tool_base.to_string());
    }

    args.push("--".to_string());
    args.extend(argv.iter().cloned());
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("pv-resolve-{name}-{nanos}"))
    }

    #[test]
    fn mise_toml_in_root_detected() {
        let dir = tmp_dir("mise");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("mise.toml"), "[tools]\n").unwrap();
        assert!(project_has_mise_config(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tool_versions_in_parent_detected() {
        let dir = tmp_dir("tv");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".tool-versions"), "node 20\n").unwrap();
        let child = dir.join("pkg");
        fs::create_dir_all(&child).unwrap();
        assert!(project_has_mise_config(&child));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_config_not_detected() {
        let dir = tmp_dir("empty");
        fs::create_dir_all(&dir).unwrap();
        assert!(!project_has_mise_config(&dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
