use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub is_dirty: bool,
    pub has_upstream: bool,
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, StableError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to execute git: {e}")))?;

    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(StableError::new(codes::INTERNAL, format!("git error: {msg}")));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_git_status(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<Option<GitStatusDto>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
        return Ok(None);
    }

    // 1. Current branch
    let branch = run_git(cwd, &["branch", "--show-current"]).unwrap_or_else(|_| "HEAD".to_string());
    if branch.is_empty() {
        return Ok(None);
    }

    // 2. Ahead/Behind
    let mut ahead = 0;
    let mut behind = 0;
    let mut has_upstream = false;

    if let Ok(revs) = run_git(cwd, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
        has_upstream = true;
        let parts: Vec<&str> = revs.split_whitespace().collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    // 3. Dirty state
    let status = run_git(cwd, &["status", "--porcelain"])?;
    let is_dirty = !status.is_empty();

    Ok(Some(GitStatusDto {
        branch,
        ahead,
        behind,
        is_dirty,
        has_upstream,
    }))
}

#[tauri::command]
pub async fn git_pull(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["pull"])?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["push"])?;
    Ok(())
}

fn parse_semver(tag: &str) -> Option<(u64, u64, u64)> {
    let t = tag.strip_prefix('v').unwrap_or(tag);
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = parts[2].parse().ok()?;
    Some((major, minor, patch))
}

fn bump_semver(tag: &str, bump: &str) -> Option<String> {
    let (major, minor, patch) = parse_semver(tag)?;
    let has_v = tag.starts_with('v');
    let (new_major, new_minor, new_patch) = match bump {
        "major" => (major + 1, 0, 0),
        "minor" => (major, minor + 1, 0),
        _ => (major, minor, patch + 1),
    };
    let version = format!("{new_major}.{new_minor}.{new_patch}");
    if has_v {
        Some(format!("v{version}"))
    } else {
        Some(version)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitTagResultDto {
    pub new_tag: String,
}

#[tauri::command]
pub async fn git_tag_and_push(
    db: State<'_, DbInstances>,
    project_id: String,
    bump: String,
) -> Result<GitTagResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
        return Err(StableError::new(codes::INVALID_PATH, "not a git repository"));
    }

    // Get latest tag
    let latest_tag = run_git(cwd, &["describe", "--tags", "--abbrev=0"]);
    let new_tag = if let Ok(tag) = latest_tag {
        bump_semver(&tag, &bump).ok_or_else(|| {
            StableError::new(codes::INTERNAL, format!("could not parse latest tag '{}' as semver", tag))
        })?
    } else {
        // No existing tags — start at 0.0.1 or 0.1.0 or 1.0.0
        match bump.as_str() {
            "major" => "1.0.0".to_string(),
            "minor" => "0.1.0".to_string(),
            _ => "0.0.1".to_string(),
        }
    };

    run_git(cwd, &["tag", &new_tag])?;
    run_git(cwd, &["push"])?;
    run_git(cwd, &["push", "origin", &new_tag])?;

    Ok(GitTagResultDto { new_tag })
}

// ─── Version bump helpers ───────────────────────────────────────────────────

fn get_version_info(cwd: &Path) -> Result<(String, String, bool), StableError> {
    // Returns (raw_version_without_v, current_tag_or_version, use_v_prefix_for_new_tag)

    if let Ok(tag) = run_git(cwd, &["describe", "--tags", "--abbrev=0"]) {
        let use_v = tag.starts_with('v');
        let raw = tag.strip_prefix('v').unwrap_or(&tag).to_string();
        return Ok((raw, tag, use_v));
    }

    if let Ok(content) = std::fs::read_to_string(cwd.join("package.json")) {
        if let Some(v) = extract_json_version(&content) {
            return Ok((v.clone(), v, true));
        }
    }

    if let Ok(content) = std::fs::read_to_string(cwd.join("Cargo.toml")) {
        if let Some(v) = extract_cargo_version(&content) {
            return Ok((v.clone(), v, true));
        }
    }

    if let Ok(content) = std::fs::read_to_string(cwd.join("src-tauri/tauri.conf.json")) {
        if let Some(v) = extract_json_version(&content) {
            return Ok((v.clone(), v, true));
        }
    }

    Err(StableError::new(
        codes::NOT_FOUND,
        "could not determine current version. create an initial git tag or add a version to package.json/Cargo.toml",
    ))
}

fn extract_json_version(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("\"version\"") {
            let parts: Vec<&str> = trimmed.split('"').collect();
            if parts.len() >= 4 {
                return Some(parts[3].to_string());
            }
        }
    }
    None
}

fn extract_cargo_version(content: &str) -> Option<String> {
    let mut in_package = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[package]" {
            in_package = true;
            continue;
        }
        if in_package && trimmed.starts_with('[') && trimmed.ends_with(']') {
            break;
        }
        if in_package && trimmed.starts_with("version") {
            let parts: Vec<&str> = trimmed.split('"').collect();
            if parts.len() >= 2 {
                return Some(parts[1].to_string());
            }
        }
    }
    None
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
    old_tag: &str,
    new_tag: &str,
) -> Result<(), StableError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to read {}: {}", path.display(), e))
    })?;

    let mut updated = content.replace(old_tag, new_tag);
    if old_raw != old_tag {
        updated = updated.replace(old_raw, new_raw);
    }

    std::fs::write(path, updated).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to write {}: {}", path.display(), e))
    })?;
    Ok(())
}

// ─── New DTOs ───────────────────────────────────────────────────────────────

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

// ─── New commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_discover_version_files(
    db: State<'_, DbInstances>,
    project_id: String,
    bump: String,
) -> Result<DiscoverVersionFilesResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
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
    db: State<'_, DbInstances>,
    project_id: String,
    payload: BumpVersionAndTagPayload,
) -> Result<GitTagResultDto, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    if !cwd.join(".git").exists() {
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

    Ok(GitTagResultDto { new_tag })
}

#[tauri::command]
pub async fn git_init(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<(), StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);

    run_git(cwd, &["init"])?;
    run_git(cwd, &["checkout", "-b", "main"])?;
    Ok(())
}
