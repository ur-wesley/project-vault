use serde::Serialize;

/// Coding-agent CLIs that can run headless inside a workspace PTY.
/// One-shot semantics: the process runs the prompt, then exits.
/// Exit code 0 → done, anything else → error (drives board automation).
pub trait Executor: Send + Sync {
    fn id(&self) -> &'static str;
    fn display(&self) -> &'static str;
    fn binary(&self) -> &'static str;
    /// Args after the binary for a fresh non-interactive run of `prompt`.
    fn run_args(&self, prompt: &str) -> Vec<String>;

    /// Unresolved display argv (`binary + run_args`).
    fn build_argv(&self, prompt: &str) -> Vec<String> {
        let mut v = vec![self.binary().to_string()];
        v.extend(self.run_args(prompt));
        v
    }
}

#[cfg(windows)]
const SCRIPT_EXTS: [&str; 4] = [".exe", "", ".cmd", ".bat"];

#[cfg(not(windows))]
const SCRIPT_EXTS: [&str; 2] = ["", ".exe"];

/// PATH lookup that also finds `.ps1`/`.cmd`/`.bat` shims (plain
/// `hidden_command` misses `.ps1` since it isn't in PATHEXT).
pub fn resolve_binary(name: &str) -> Option<std::path::PathBuf> {
    use std::path::Path;
    let direct = Path::new(name);
    if direct.components().count() > 1 {
        return direct.is_file().then(|| direct.to_path_buf());
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in SCRIPT_EXTS {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
        #[cfg(windows)]
        {
            let ps1 = dir.join(format!("{name}.ps1"));
            if ps1.is_file() {
                return Some(ps1);
            }
        }
    }
    None
}

/// Wrap script shims so CreateProcess can run them:
/// `.ps1` → powershell, `.cmd`/`.bat` → cmd.exe. Pure.
pub fn wrap_script_argv(resolved: &std::path::Path, rest: &[String]) -> Vec<String> {
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let path = resolved.to_string_lossy().to_string();
    match ext.as_str() {
        #[cfg(windows)]
        "ps1" => {
            let mut v = vec![
                "powershell".to_string(),
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                path,
            ];
            v.extend_from_slice(rest);
            v
        }
        #[cfg(windows)]
        "cmd" | "bat" => {
            let mut v = vec!["cmd.exe".to_string(), "/C".to_string(), path];
            v.extend_from_slice(rest);
            v
        }
        _ => {
            let mut v = vec![path];
            v.extend_from_slice(rest);
            v
        }
    }
}

/// Resolved+wrapped binary with no args (None when absent).
pub fn resolve_base(exec: &dyn Executor) -> Option<Vec<String>> {
    let resolved = resolve_binary(exec.binary())?;
    Some(wrap_script_argv(&resolved, &[]))
}

/// Fully resolved spawn argv for `prompt`, or None when the binary is absent.
pub fn resolve_argv(exec: &dyn Executor, prompt: &str) -> Option<Vec<String>> {
    let mut v = resolve_base(exec)?;
    v.extend(exec.run_args(prompt));
    Some(v)
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutorInfo {
    pub id: String,
    pub display: String,
    pub available: bool,
}

pub struct OpencodeExecutor;

impl Executor for OpencodeExecutor {
    fn id(&self) -> &'static str {
        "opencode"
    }
    fn display(&self) -> &'static str {
        "OpenCode"
    }
    fn binary(&self) -> &'static str {
        "opencode"
    }
    fn run_args(&self, prompt: &str) -> Vec<String> {
        vec!["run".to_string(), prompt.to_string()]
    }
}

pub struct CursorAgentExecutor;

impl Executor for CursorAgentExecutor {
    fn id(&self) -> &'static str {
        "cursor-agent"
    }
    fn display(&self) -> &'static str {
        "Cursor"
    }
    fn binary(&self) -> &'static str {
        "cursor-agent"
    }
    fn run_args(&self, prompt: &str) -> Vec<String> {
        // --print: non-interactive, full tool access incl. shell.
        // --force: don't stall on command-approval prompts in the PTY.
        vec!["--print".to_string(), "--force".to_string(), prompt.to_string()]
    }
}

pub fn all() -> Vec<Box<dyn Executor>> {
    vec![Box::new(OpencodeExecutor), Box::new(CursorAgentExecutor)]
}

pub fn find(id: &str) -> Option<Box<dyn Executor>> {
    let norm = id.to_lowercase().replace('-', "_");
    all().into_iter().find(|e| {
        e.id() == id || e.id().replace('-', "_") == norm || e.binary().replace('-', "_") == norm
    })
}

/// `probe` = resolved `<binary> --version` exits 0. Cheap, no side effects.
pub fn probe(exec: &dyn Executor) -> bool {
    let base = match resolve_base(exec) {
        Some(v) => v,
        None => return false,
    };
    let mut cmd = crate::process_util::hidden_command(&base[0]);
    for a in base.iter().skip(1) {
        cmd.arg(a);
    }
    cmd.arg("--version");
    cmd.output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn probe_all() -> Vec<ExecutorInfo> {
    all()
        .iter()
        .map(|e| ExecutorInfo {
            id: e.id().to_string(),
            display: e.display().to_string(),
            available: probe(e.as_ref()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_resolves_aliases() {
        assert_eq!(find("opencode").unwrap().binary(), "opencode");
        assert_eq!(find("OPENCODE").unwrap().id(), "opencode");
        assert_eq!(find("cursor_agent").unwrap().id(), "cursor-agent");
        assert_eq!(find("cursor-agent").unwrap().binary(), "cursor-agent");
        assert!(find("nope").is_none());
    }

    #[test]
    fn argv_shapes() {
        let o = OpencodeExecutor;
        assert_eq!(o.build_argv("hi"), vec!["opencode", "run", "hi"]);
        let c = CursorAgentExecutor;
        assert_eq!(c.build_argv("hi"), vec!["cursor-agent", "--print", "--force", "hi"]);
    }

    #[test]
    fn script_wrapping() {
        use std::path::Path;
        let ps1 = wrap_script_argv(Path::new("C:/bin/cursor-agent.ps1"), &["--print".into()]);
        assert_eq!(&ps1[..5], ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
        assert!(ps1.contains(&"--print".to_string()));
        let exe = wrap_script_argv(Path::new("C:/bin/opencode.exe"), &["run".into()]);
        assert_eq!(exe, vec!["C:/bin/opencode.exe", "run"]);
        let bare = wrap_script_argv(Path::new("/usr/bin/opencode"), &["run".into()]);
        assert_eq!(bare, vec!["/usr/bin/opencode", "run"]);
    }
}
