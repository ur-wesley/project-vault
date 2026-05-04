#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::collections::HashSet;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{codes, StableError};
use crate::models::IdeCandidateDto;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

mod common;
mod constants;
mod scanner;
mod jetbrains;
#[cfg(windows)] mod windows;
#[cfg(target_os = "macos")] mod macos;
#[cfg(all(unix, not(target_os = "macos")))] mod linux;

#[cfg(windows)]
use windows::{discover_platform, discover_platform_fallback};
#[cfg(target_os = "macos")]
use macos::{discover_platform, discover_platform_fallback};
#[cfg(all(unix, not(target_os = "macos")))]
use linux::{discover_platform, discover_platform_fallback};

pub fn discover_ides() -> Vec<IdeCandidateDto> {
    let mut out = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut seen_ids = HashSet::new();
    discover_platform(&mut out, &mut seen_paths, &mut seen_ids);
    discover_platform_fallback(&mut out, &mut seen_paths, &mut seen_ids);
    out.sort_by(|a, b| {
        a.label
            .to_lowercase()
            .cmp(&b.label.to_lowercase())
            .then_with(|| a.executable.cmp(&b.executable))
    });
    out
}

pub fn launch_ide(
    executable: &str,
    project_dir: &Path,
) -> Result<std::process::Child, StableError> {
    let exe = executable.trim();
    if exe.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "executable empty"));
    }
    if !project_dir.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project not a directory",
        ));
    }

    let mut c = if cfg!(windows) && (exe.ends_with(".cmd") || exe.ends_with(".bat")) {
        let mut cmd = Command::new("cmd.exe");
        cmd.arg("/C");
        cmd.arg(exe);
        cmd
    } else {
        Command::new(exe)
    };

    c.arg(project_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);

    let child = c
        .spawn()
        .map_err(|e| StableError::new(codes::SPAWN_FAILED, e.to_string()))?;
    Ok(child)
}
