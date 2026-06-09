use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn is_batch_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let exe = dir.join(format!("{name}.exe"));
        if exe.is_file() {
            return Some(exe);
        }
        let bare = dir.join(name);
        if bare.is_file() {
            return Some(bare);
        }
        for ext in [".cmd", ".bat"] {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(windows)]
fn resolve_program(program: &str) -> PathBuf {
    let path = Path::new(program);
    if path.is_absolute() || path.components().count() > 1 {
        return path.to_path_buf();
    }
    path_lookup(program).unwrap_or_else(|| path.to_path_buf())
}

#[cfg(windows)]
fn needs_cmd_wrapper(program: &str) -> bool {
    let path = Path::new(program);
    if is_batch_file(path) {
        return true;
    }
    if path.components().count() <= 1 {
        if let Some(resolved) = path_lookup(program) {
            return is_batch_file(&resolved);
        }
    }
    false
}

#[cfg(windows)]
fn apply_no_window(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

pub fn hidden_command(program: &str) -> Command {
    #[cfg(windows)]
    {
        if needs_cmd_wrapper(program) {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C").arg(program);
            apply_no_window(&mut cmd);
            return cmd;
        }
        let resolved = resolve_program(program);
        let mut cmd = Command::new(resolved);
        apply_no_window(&mut cmd);
        cmd
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

pub fn hidden_tokio_command(program: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        if needs_cmd_wrapper(program) {
            let mut cmd = tokio::process::Command::new("cmd.exe");
            cmd.arg("/C").arg(program);
            cmd.creation_flags(CREATE_NO_WINDOW);
            return cmd;
        }
        let resolved = resolve_program(program);
        let mut cmd = tokio::process::Command::new(resolved);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        tokio::process::Command::new(program)
    }
}

pub fn configure_hidden(cmd: &mut Command) {
    #[cfg(windows)]
    apply_no_window(cmd);
    #[cfg(not(windows))]
    let _ = cmd;
}
