use std::path::Path;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_sql::DbInstances;

use crate::db;
use crate::error::{codes, StableError};
use super::utils::run_git;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitTagResultDto {
    pub new_tag: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitPreviewVersionsDto {
    pub current_version: String,
    pub latest_tag: Option<String>,
    pub patch_version: String,
    pub minor_version: String,
    pub major_version: String,
    pub beta_version: String,
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
    let raw_version = version_info.as_ref().map(|(r, _, _)| r.clone()).unwrap_or_else(|_| "0.0.0".to_string());
    println!("[git_preview_versions] raw_version: {}", raw_version);

    let latest_tag = run_git(cwd, &["describe", "--tags", "--abbrev=0"]).ok();
    println!("[git_preview_versions] latest_tag: {:?}", latest_tag);

    let patch = bump_semver(&raw_version, "patch").unwrap_or_else(|| "0.0.1".to_string());
    let minor = bump_semver(&raw_version, "minor").unwrap_or_else(|| "0.1.0".to_string());
    let major = bump_semver(&raw_version, "major").unwrap_or_else(|| "1.0.0".to_string());
    let beta = bump_semver(&raw_version, "beta").unwrap_or_else(|| "0.0.1-beta.0".to_string());
    println!("[git_preview_versions] patch: {}, minor: {}, major: {}, beta: {}", patch, minor, major, beta);

    Ok(GitPreviewVersionsDto {
        current_version: raw_version,
        latest_tag,
        patch_version: patch,
        minor_version: minor,
        major_version: major,
        beta_version: beta,
    })
}

#[tauri::command]
pub async fn git_tag_and_push(
    app: AppHandle,
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
            "beta" => "0.0.1-beta.0".to_string(),
            _ => "0.0.1".to_string(),
        }
    };

    run_git(cwd, &["tag", &new_tag])?;
    run_git(cwd, &["push"])?;
    run_git(cwd, &["push", "origin", &new_tag])?;

    crate::models::emit_project_changed(&app, &project_id, "version-bump");
    Ok(GitTagResultDto { new_tag })
}

pub fn split_prerelease(tag: &str) -> (&str, &str) {
    if let Some(pos) = tag.find('-') {
        (&tag[..pos], &tag[pos..])
    } else {
        (tag, "")
    }
}

pub fn parse_semver(tag: &str) -> Option<(u64, u64, u64)> {
    let t = tag.strip_prefix('v').unwrap_or(tag);
    let (core, _prerelease) = split_prerelease(t);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = parts[2].parse().ok()?;
    Some((major, minor, patch))
}

pub fn bump_semver(tag: &str, bump: &str) -> Option<String> {
    let has_v = tag.starts_with('v');
    let t = tag.strip_prefix('v').unwrap_or(tag);
    let (core, prerelease) = split_prerelease(t);

    if bump == "beta" {
        let new_version = if prerelease.is_empty() {
            format!("{}-beta.0", core)
        } else if let Some(idx) = prerelease.rfind('.') {
            let base = &prerelease[..idx];
            let num_str = &prerelease[idx + 1..];
            if let Ok(num) = num_str.parse::<u64>() {
                format!("{}{}.{}", core, base, num + 1)
            } else {
                format!("{}-beta.0", core)
            }
        } else {
            format!("{}-beta.0", core)
        };
        if has_v {
            Some(format!("v{}", new_version))
        } else {
            Some(new_version)
        }
    } else {
        let (major, minor, patch) = parse_semver(tag)?;
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
}

pub fn get_version_info(cwd: &Path) -> Result<(String, String, bool), StableError> {
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
