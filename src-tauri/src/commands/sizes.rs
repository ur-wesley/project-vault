use std::path::Path;

use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use walkdir::WalkDir;

use crate::db;
use crate::error::{codes, StableError};
use crate::project_move::should_skip_path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSizeEntry {
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn get_location_project_sizes(
    db: State<'_, DbInstances>,
    location_id: String,
) -> Result<Vec<ProjectSizeEntry>, StableError> {
    let pool = db::sqlite_pool(&*db).await?;
    let loc = db::get_location(&pool, &location_id).await?;
    let projects = db::list_projects(&pool).await?;
    let mut out = Vec::new();
    for p in projects {
        if p.location_id == location_id && p.size_bytes > 0 {
            out.push(ProjectSizeEntry {
                project_id: p.id,
                path: p.path,
                name: p.name,
                size_bytes: p.size_bytes,
            });
        }
    }
    // Also include any projects on disk that aren't in DB yet
    let root = Path::new(&loc.path);
    if root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                if name.starts_with('.') || should_skip_path(&path.strip_prefix(root).unwrap_or(&path)) {
                    continue;
                }
                // Check if already in DB
                let path_str = path.to_string_lossy().to_string();
                if out.iter().any(|e| e.path == path_str) {
                    continue;
                }
                // Compute size on the fly
                let size = count_all_dir_unfiltered(&path);
                if size > 0 {
                    out.push(ProjectSizeEntry {
                        project_id: String::new(),
                        path: path_str,
                        name,
                        size_bytes: size,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargestEntry {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

#[tauri::command]
pub fn get_largest_entries(
    path: String,
    limit: u32,
) -> Result<Vec<LargestEntry>, StableError> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }

    let mut entries: Vec<LargestEntry> = Vec::new();

    // First pass: top-level files + directories with recursive sizes
    if let Ok(dir_entries) = std::fs::read_dir(root) {
        for entry in dir_entries.flatten() {
            let entry_path = entry.path();
            let name = entry_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_dir = entry_path.is_dir();
            if is_dir {
                if should_skip_path(&entry_path.strip_prefix(root).unwrap_or(&entry_path)) {
                    continue;
                }
                let size = count_all_dir_unfiltered(&entry_path);
                if size > 0 {
                    entries.push(LargestEntry {
                        path: entry_path.to_string_lossy().to_string(),
                        name,
                        size_bytes: size,
                        is_dir: true,
                    });
                }
            } else {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                if size > 0 {
                    entries.push(LargestEntry {
                        path: entry_path.to_string_lossy().to_string(),
                        name,
                        size_bytes: size,
                        is_dir: false,
                    });
                }
            }
        }
    }

    // Second pass: large files deeper in the tree (skip ignored dirs)
    for walker in WalkDir::new(root).min_depth(2) {
        let Ok(entry) = walker else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(root).unwrap_or(entry.path());
        if should_skip_path(rel) {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size > 10 * 1024 * 1024 {
            // Only include files > 10MB from deep paths
                entries.push(LargestEntry {
                    path: entry.path().to_string_lossy().to_string(),
                    name: format!("{}", rel.to_string_lossy()),
                size_bytes: size,
                is_dir: false,
            });
        }
    }

    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    entries.truncate(limit as usize);
    Ok(entries)
}

fn count_all_dir_unfiltered(dir: &Path) -> u64 {
    let mut total = 0u64;
    for entry in WalkDir::new(dir).min_depth(1) {
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}
