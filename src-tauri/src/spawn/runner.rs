use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{codes, StableError};

pub fn argv_needs_confirmation(argv: &[String]) -> bool {
    let j = argv.join(" ").to_lowercase();
    j.contains("rm -rf")
        || j.contains("rmdir /s")
        || j.contains("format ")
        || (j.contains("curl ") && j.contains("| sh"))
        || j.contains("invoke-expression")
        || j.contains("iex ")
}

#[cfg(windows)]
fn spawn_in_new_console_cmd(_cwd: &Path, line: &str) -> Result<std::process::Child, StableError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    Command::new("cmd.exe")
        .creation_flags(CREATE_NEW_CONSOLE)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .arg("/K")
        .arg(line)
        .spawn()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))
}

#[cfg(target_os = "macos")]
fn open_interactive_shell_default_macos(cwd: &Path) -> Result<std::process::Child, StableError> {
    let script_line = format!("cd {}", crate::common::sh_single_quote(&cwd.display().to_string()));
    let quoted = serde_json::to_string(&script_line)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?;
    let osa = format!("tell application \"Terminal\" to do script {quoted}");
    Command::new("osascript")
        .arg("-e")
        .arg(&osa)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))
}

#[cfg(target_os = "macos")]
pub fn open_interactive_shell(
    cwd: &Path,
    user_shell: Option<&str>,
) -> Result<std::process::Child, StableError> {
    if let Some(p) = user_shell {
        let p = p.trim();
        if !p.is_empty() {
            if let Ok(c) = Command::new(p)
                .current_dir(cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                return Ok(c);
            }
        }
    }
    open_interactive_shell_default_macos(cwd)
}

#[cfg(windows)]
fn open_interactive_shell_default_win(cwd: &Path) -> Result<std::process::Child, StableError> {
    if let Ok(c) = Command::new("wt.exe")
        .arg("-d")
        .arg(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        return Ok(c);
    }
    let line = format!(
        r#"cd /d "{}""#,
        cwd.display().to_string().replace('"', r#""""#)
    );
    spawn_in_new_console_cmd(cwd, &line)
}

#[cfg(windows)]
pub fn open_interactive_shell(
    cwd: &Path,
    user_shell: Option<&str>,
) -> Result<std::process::Child, StableError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    if let Some(p) = user_shell {
        let p = p.trim();
        if !p.is_empty() {
            if let Ok(c) = Command::new(p)
                .creation_flags(CREATE_NEW_CONSOLE)
                .current_dir(cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                return Ok(c);
            }
        }
    }
    open_interactive_shell_default_win(cwd)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_interactive_shell_default_linux(cwd: &Path) -> Result<std::process::Child, StableError> {
    let script = format!(
        "cd {}; exec bash",
        crate::common::sh_single_quote(&cwd.display().to_string())
    );
    Command::new("gnome-terminal")
        .args(["--", "bash", "-lc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            Command::new("xterm")
                .arg("-e")
                .arg("bash")
                .arg("-lc")
                .arg(&format!(
                    "cd {} && exec bash",
                    crate::common::sh_single_quote(&cwd.display().to_string())
                ))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        })
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn open_interactive_shell(
    cwd: &Path,
    user_shell: Option<&str>,
) -> Result<std::process::Child, StableError> {
    if let Some(p) = user_shell {
        let p = p.trim();
        if !p.is_empty() {
            if let Ok(c) = Command::new(p)
                .current_dir(cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                return Ok(c);
            }
        }
    }
    open_interactive_shell_default_linux(cwd)
}
