use std::path::Path;
use std::process::Output;

use crate::error::StableError;

#[cfg_attr(windows, allow(unused_imports))]
pub fn git_command() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn run_git_sync(mut cmd: std::process::Command) -> Result<Output, StableError> {
    cmd.output().map_err(|e| {
        StableError::new(
            crate::error::codes::INTERNAL,
            format!("Failed to spawn git: {}", e),
        )
    })
}

pub fn clone_repo(repo: &str, target: &Path) -> Result<(), StableError> {
    if target.is_dir() {
        return pull_repo(target);
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut cmd = git_command();
    cmd.arg("clone")
        .arg("--filter=blob:none")
        .arg(repo)
        .arg(target);
    let out = run_git_sync(cmd)?;
    if !out.status.success() {
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!("Git clone failed: {}", String::from_utf8_lossy(&out.stderr)),
        ));
    }
    Ok(())
}

pub fn pull_repo(path: &Path) -> Result<(), StableError> {
    let mut cmd = git_command();
    cmd.current_dir(path).arg("pull");
    let out = run_git_sync(cmd)?;
    if !out.status.success() {
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!("Git pull failed: {}", String::from_utf8_lossy(&out.stderr)),
        ));
    }
    Ok(())
}

pub fn checkout_ref(path: &Path, reference: &str) -> Result<(), StableError> {
    let mut cmd = git_command();
    cmd.current_dir(path).arg("checkout").arg(reference);
    let out = run_git_sync(cmd)?;
    if !out.status.success() {
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!(
                "Git checkout failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ),
        ));
    }
    Ok(())
}

pub fn rev_parse_head(path: &Path) -> Result<String, StableError> {
    let mut cmd = git_command();
    cmd.current_dir(path).arg("rev-parse").arg("HEAD");
    let out = run_git_sync(cmd)?;
    if !out.status.success() {
        return Err(StableError::new(
            crate::error::codes::INTERNAL,
            format!(
                "Git rev-parse failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
