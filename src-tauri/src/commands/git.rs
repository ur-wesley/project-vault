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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitPreviewVersionsDto {
    pub current_version: String,
    pub patch_version: String,
    pub minor_version: String,
    pub major_version: String,
}

#[tauri::command]
pub async fn git_preview_versions(
    db: State<'_, DbInstances>,
    project_id: String,
) -> Result<GitPreviewVersionsDto, StableError> {
    println!("[git_preview_versions] called for project {}", project_id);
    let pool = db::sqlite_pool(&*db).await?;
    let project = db::get_project(&pool, &project_id).await?;
    let cwd = Path::new(&project.path);
    println!("[git_preview_versions] cwd: {:?}", cwd);

    if !cwd.join(".git").exists() {
        return Err(StableError::new(codes::INVALID_PATH, "not a git repository"));
    }

    let version_info = get_version_info(cwd);
    println!("[git_preview_versions] version_info: {:?}", version_info);
    let raw_version = version_info.map(|(r, _, _)| r).unwrap_or_else(|_| "0.0.0".to_string());
    println!("[git_preview_versions] raw_version: {}", raw_version);
    let patch = bump_semver(&raw_version, "patch").unwrap_or_else(|| "0.0.1".to_string());
    let minor = bump_semver(&raw_version, "minor").unwrap_or_else(|| "0.1.0".to_string());
    let major = bump_semver(&raw_version, "major").unwrap_or_else(|| "1.0.0".to_string());
    println!("[git_preview_versions] patch: {}, minor: {}, major: {}", patch, minor, major);

    Ok(GitPreviewVersionsDto {
        current_version: raw_version,
        patch_version: patch,
        minor_version: minor,
        major_version: major,
    })
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
    println!("[get_version_info] cwd: {:?}", cwd);

    // 1. Try package.json first (most common JS/web projects)
    let package_json_path = cwd.join("package.json");
    println!("[get_version_info] checking {:?}", package_json_path);
    if let Ok(content) = std::fs::read_to_string(&package_json_path) {
        println!("[get_version_info] package.json content length: {}", content.len());
        if let Some(v) = extract_json_version(&content) {
            println!("[get_version_info] found version in package.json: {}", v);
            return Ok((v.clone(), v, true));
        }
        println!("[get_version_info] package.json has no version field");
    } else {
        println!("[get_version_info] package.json not found");
    }

    // 2. Try Cargo.toml at root
    let cargo_path = cwd.join("Cargo.toml");
    println!("[get_version_info] checking {:?}", cargo_path);
    if let Ok(content) = std::fs::read_to_string(&cargo_path) {
        if let Some(v) = extract_cargo_version(&content) {
            println!("[get_version_info] found version in Cargo.toml: {}", v);
            return Ok((v.clone(), v, true));
        }
    }

    // 3. Try src-tauri/Cargo.toml (Tauri apps)
    let tauri_cargo = cwd.join("src-tauri").join("Cargo.toml");
    println!("[get_version_info] checking {:?}", tauri_cargo);
    if let Ok(content) = std::fs::read_to_string(&tauri_cargo) {
        if let Some(v) = extract_cargo_version(&content) {
            println!("[get_version_info] found version in src-tauri/Cargo.toml: {}", v);
            return Ok((v.clone(), v, true));
        }
    }

    // 4. Try tauri.conf.json
    let tauri_conf = cwd.join("src-tauri").join("tauri.conf.json");
    println!("[get_version_info] checking {:?}", tauri_conf);
    if let Ok(content) = std::fs::read_to_string(&tauri_conf) {
        if let Some(v) = extract_json_version(&content) {
            println!("[get_version_info] found version in src-tauri/tauri.conf.json: {}", v);
            return Ok((v.clone(), v, true));
        }
    }
    let tauri_conf2 = cwd.join("tauri.conf.json");
    println!("[get_version_info] checking {:?}", tauri_conf2);
    if let Ok(content) = std::fs::read_to_string(&tauri_conf2) {
        if let Some(v) = extract_json_version(&content) {
            println!("[get_version_info] found version in tauri.conf.json: {}", v);
            return Ok((v.clone(), v, true));
        }
    }

    // 5. Try git tags
    println!("[get_version_info] trying git describe");
    if let Ok(tag) = run_git(cwd, &["describe", "--tags", "--abbrev=0"]) {
        println!("[get_version_info] found git tag: {}", tag);
        let use_v = tag.starts_with('v');
        let raw = tag.strip_prefix('v').unwrap_or(&tag).to_string();
        return Ok((raw, tag, use_v));
    }

    // 6. Try pyproject.toml
    let pyproject = cwd.join("pyproject.toml");
    println!("[get_version_info] checking {:?}", pyproject);
    if let Ok(content) = std::fs::read_to_string(&pyproject) {
        if let Some(v) = extract_cargo_version(&content) {
            println!("[get_version_info] found version in pyproject.toml: {}", v);
            return Ok((v.clone(), v, true));
        }
    }

    // 7. Try version.txt
    let version_txt = cwd.join("version.txt");
    println!("[get_version_info] checking {:?}", version_txt);
    if let Ok(content) = std::fs::read_to_string(&version_txt) {
        let v = content.trim().to_string();
        if !v.is_empty() {
            println!("[get_version_info] found version in version.txt: {}", v);
            return Ok((v.clone(), v, true));
        }
    }
    let version_upper = cwd.join("VERSION");
    println!("[get_version_info] checking {:?}", version_upper);
    if let Ok(content) = std::fs::read_to_string(&version_upper) {
        let v = content.trim().to_string();
        if !v.is_empty() {
            println!("[get_version_info] found version in VERSION: {}", v);
            return Ok((v.clone(), v, true));
        }
    }

    println!("[get_version_info] no version found anywhere");
    Err(StableError::new(
        codes::NOT_FOUND,
        "could not determine current version. add a version to package.json, Cargo.toml, or create a git tag.",
    ))
}

fn extract_json_version(content: &str) -> Option<String> {
    // Try line-by-line first (formatted JSON)
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("\"version\"") || trimmed.contains("\"version\"") {
            if let Some(v) = parse_quoted_value(trimmed, "version") {
                return Some(v);
            }
        }
    }
    // Fallback: scan entire content for "version" : "x.y.z"
    if let Some(idx) = content.find("\"version\"") {
        let rest = &content[idx..];
        if let Some(v) = parse_quoted_value(rest, "version") {
            return Some(v);
        }
    }
    None
}

fn parse_quoted_value(s: &str, key: &str) -> Option<String> {
    let key_quoted = format!("\"{}\"", key);
    if let Some(start) = s.find(&key_quoted) {
        let after_key = &s[start + key_quoted.len()..];
        // Skip whitespace and colon
        let after_colon = after_key.trim_start().strip_prefix(':')?;
        let trimmed = after_colon.trim_start();
        if trimmed.starts_with('"') {
            let inner = &trimmed[1..];
            if let Some(end) = inner.find('"') {
                return Some(inner[..end].to_string());
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
            if let Some(v) = parse_quoted_value(trimmed, "version") {
                return Some(v);
            }
            // Also try single quotes
            if let Some(start) = trimmed.find('\'') {
                let inner = &trimmed[start + 1..];
                if let Some(end) = inner.find('\'') {
                    return Some(inner[..end].to_string());
                }
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
