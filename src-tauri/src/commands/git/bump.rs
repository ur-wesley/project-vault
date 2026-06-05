use std::path::Path;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use super::utils::run_git;
use super::version::{bump_semver, get_version_info};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionFileDto {
    pub path: String,
    pub preview: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverVersionFilesResultDto {
    pub current_version: String,
    pub new_version: String,
    pub use_v_prefix: bool,
    pub files: Vec<VersionFileDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BumpVersionAndTagPayload {
    pub bump: String,
    pub files: Vec<String>,
}

#[tauri::command]
pub async fn git_discover_version_files(
    db: State<'_, DbInstances>,
    project_id: String,
    bump: String,
) -> Result<DiscoverVersionFilesResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !super::utils::is_git_repo(cwd) {
        return Err(StableError::new(codes::INVALID_PATH, "not a git repository"));
    }

    let (raw_version, current_tag, use_v_prefix) = get_version_info(cwd)?;
    let new_raw = bump_semver(&raw_version, &bump).ok_or_else(|| {
        StableError::new(codes::INTERNAL, format!("could not parse current version '{}' as semver", raw_version))
    })?;

    let new_tag = if use_v_prefix {
        format!("v{new_raw}")
    } else {
        new_raw.clone()
    };

    let files = discover_version_files(cwd, &raw_version, &current_tag, &new_raw, &new_tag);

    Ok(DiscoverVersionFilesResultDto {
        current_version: current_tag,
        new_version: new_tag,
        use_v_prefix,
        files,
    })
}

#[tauri::command]
pub async fn git_bump_version_and_tag(
    app: AppHandle,
    db: State<'_, DbInstances>,
    project_id: String,
    payload: BumpVersionAndTagPayload,
) -> Result<super::version::GitTagResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !super::utils::is_git_repo(cwd) {
        return Err(StableError::new(codes::INVALID_PATH, "not a git repository"));
    }

    // Require clean working tree
    let status = run_git(cwd, &["status", "--porcelain"])?;
    if !status.is_empty() {
        return Err(StableError::new(
            codes::CONFIRM_REQUIRED,
            "working tree has uncommitted changes. commit or stash them first.",
        ));
    }

    let (raw_version, current_tag, use_v_prefix) = get_version_info(cwd)?;
    let new_raw = bump_semver(&raw_version, &payload.bump).ok_or_else(|| {
        StableError::new(codes::INTERNAL, format!("could not parse current version '{}' as semver", raw_version))
    })?;

    let new_tag = if use_v_prefix {
        format!("v{new_raw}")
    } else {
        new_raw.clone()
    };

    // Update selected files
    if !payload.files.is_empty() {
        for rel_path in &payload.files {
            let full_path = cwd.join(rel_path);
            replace_version_in_file(&full_path, &raw_version, &new_raw, &current_tag, &new_tag)?;
        }

        for rel_path in &payload.files {
            run_git(cwd, &["add", rel_path])?;
        }

        let commit_msg = format!("chore: release {new_tag}");
        run_git(cwd, &["commit", "-m", &commit_msg])?;
    }

    run_git(cwd, &["tag", &new_tag])?;
    run_git(cwd, &["push"])?;
    run_git(cwd, &["push", "origin", &new_tag])?;

    crate::models::notify_git_status_changed(&app, &project_id, "version-bump");
    Ok(super::version::GitTagResultDto { new_tag })
}

fn is_binary_content(content: &str) -> bool {
    content.bytes().take(1024).any(|b| b == 0)
}

fn make_preview(content: &str, old_raw: &str, old_tag: &str, new_raw: &str, new_tag: &str) -> String {
    for line in content.lines().take(50) {
        if line.contains(old_raw) || line.contains(old_tag) {
            let preview = line.trim().to_string();
            let replaced = preview.replace(old_raw, new_raw).replace(old_tag, new_tag);
            if preview != replaced {
                return format!("{} → {}", preview, replaced);
            }
        }
    }
    String::new()
}

fn discover_version_files(
    cwd: &Path,
    old_raw: &str,
    old_tag: &str,
    new_raw: &str,
    new_tag: &str,
) -> Vec<VersionFileDto> {
    let mut files = Vec::new();

    let known_files = [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "version.txt",
        "VERSION",
        "tauri.conf.json",
        "README.md",
        "CHANGELOG.md",
        "src-tauri/Cargo.toml",
        "src-tauri/tauri.conf.json",
    ];

    for rel_path in &known_files {
        let full_path = cwd.join(rel_path);
        if let Ok(content) = std::fs::read_to_string(&full_path) {
            if !is_binary_content(&content) && (content.contains(old_raw) || content.contains(old_tag)) {
                let preview = make_preview(&content, old_raw, old_tag, new_raw, new_tag);
                if !preview.is_empty() {
                    files.push(VersionFileDto {
                        path: rel_path.to_string(),
                        preview,
                    });
                }
            }
        }
    }

    let skip_exts = [".lock", ".log", ".bin", ".exe", ".dll", ".so", ".dylib"];
    let skip_names = [
        "package-lock.json",
        "Cargo.lock",
        "bun.lock",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "Gemfile.lock",
    ];

    if let Ok(entries) = std::fs::read_dir(cwd) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let rel = path.strip_prefix(cwd).unwrap_or(&path).to_string_lossy().to_string();
            if known_files.contains(&rel.as_str()) {
                continue;
            }
            if rel.starts_with('.') {
                continue;
            }
            if skip_names.contains(&rel.as_str()) {
                continue;
            }
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if skip_exts.iter().any(|s| ext_str == s.strip_prefix('.').unwrap_or(s)) {
                    continue;
                }
            }
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX);
            if size > 1_000_000 {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                if !is_binary_content(&content) && (content.contains(old_raw) || content.contains(old_tag)) {
                    let preview = make_preview(&content, old_raw, old_tag, new_raw, new_tag);
                    if !preview.is_empty() {
                        files.push(VersionFileDto {
                            path: rel,
                            preview,
                        });
                    }
                }
            }
        }
    }

    files
}

fn replace_version_in_file(
    path: &Path,
    old_raw: &str,
    new_raw: &str,
    _old_tag: &str,
    _new_tag: &str,
) -> Result<(), StableError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to read {}: {}", path.display(), e))
    })?;

    let mut updated = content.replace(old_raw, new_raw);

    let v_old = format!("v{}", old_raw);
    let v_new = format!("v{}", new_raw);
    if updated.contains(&v_old) {
        updated = updated.replace(&v_old, &v_new);
    }

    std::fs::write(path, updated).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to write {}: {}", path.display(), e))
    })?;
    Ok(())
}
