use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio::process::Command as TokioCommand;

use crate::error::{codes, StableError};

pub const GIT_TIMEOUT: Duration = Duration::from_secs(30);

pub fn run_git(cwd: &Path, args: &[&str]) -> Result<String, StableError> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to execute git: {e}")))?;

    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(StableError::new(codes::INTERNAL, format!("git error: {msg}")));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub async fn run_git_async(cwd: &Path, args: &[&str]) -> Result<String, StableError> {
    eprintln!("[run_git_async] starting: git {:?} in {:?}", args, cwd);
    let mut cmd = TokioCommand::new("git");
    cmd.args(args).current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(GIT_TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            eprintln!("[run_git_async] TIMEOUT after {:?}: git {:?}", GIT_TIMEOUT, args);
            StableError::new(codes::INTERNAL, "git command timed out")
        })?
        .map_err(|e| {
            eprintln!("[run_git_async] spawn error: {}", e);
            StableError::new(codes::INTERNAL, format!("failed to execute git: {e}"))
        })?;

    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        eprintln!("[run_git_async] git error: {}", msg);
        return Err(StableError::new(codes::INTERNAL, format!("git error: {msg}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    eprintln!("[run_git_async] done: git {:?}, stdout len={}", args, stdout.len());
    Ok(stdout)
}

pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    total += dir_size(&entry.path());
                } else if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
        }
    }
    total
}
