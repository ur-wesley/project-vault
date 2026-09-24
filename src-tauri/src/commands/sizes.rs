use std::path::Path;

use serde::Serialize;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use walkdir::WalkDir;

use crate::db;
use crate::error::{codes, StableError};
use crate::project_move::{is_skip_name, should_skip_path};

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
                let name = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                if name.starts_with('.')
                    || should_skip_path(&path.strip_prefix(root).unwrap_or(&path))
                {
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
pub fn get_largest_entries(path: String, limit: u32) -> Result<Vec<LargestEntry>, StableError> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }

    let mut entries: Vec<LargestEntry> = Vec::new();

    // First pass: top-level files + directories with recursive sizes
    if let Ok(dir_entries) = std::fs::read_dir(root) {
        for entry in dir_entries.flatten() {
            let entry_path = entry.path();
            let name = entry_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSizeEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub is_skip: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSizeBreakdown {
    pub path: String,
    pub total_bytes: u64,
    pub entries: Vec<DirSizeEntry>,
}

pub fn compute_dir_size_breakdown(root: &Path) -> Result<DirSizeBreakdown, StableError> {
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }

    let mut entries: Vec<DirSizeEntry> = Vec::new();
    if let Ok(dir_entries) = std::fs::read_dir(root) {
        for entry in dir_entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_str().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            let is_dir = entry_path.is_dir();
            let size = if is_dir {
                count_all_dir_unfiltered(&entry_path)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            };
            entries.push(DirSizeEntry {
                is_skip: is_skip_name(&name),
                name,
                path: entry_path.to_string_lossy().to_string(),
                size_bytes: size,
                is_dir,
            });
        }
    }

    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = entries.iter().map(|e| e.size_bytes).sum();

    Ok(DirSizeBreakdown {
        path: root.to_string_lossy().to_string(),
        total_bytes,
        entries,
    })
}

#[tauri::command]
pub async fn get_dir_size_breakdown(path: String) -> Result<DirSizeBreakdown, StableError> {
    tauri::async_runtime::spawn_blocking(move || compute_dir_size_breakdown(Path::new(&path)))
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSizeNode {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub is_skip: bool,
    pub children: Vec<DirSizeNode>,
}

/// Caps for the recursive size tree. Keeps the payload bounded so the
/// frontend treemap stays fast even on large projects (e.g. node_modules).
const TREE_MAX_DEPTH: u32 = 4;
const TREE_MAX_CHILDREN: usize = 60;
const TREE_MIN_BYTES: u64 = 4096;

fn compute_dir_size_node(path: &Path, depth: u32) -> Option<DirSizeNode> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return None;
    }
    let is_skip = is_skip_name(&name);
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return None;
    };
    if meta.is_symlink() {
        return None;
    }
    if !meta.is_dir() {
        return Some(DirSizeNode {
            name,
            path: path.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            is_dir: false,
            is_skip,
            children: Vec::new(),
        });
    }
    // Directory: at max depth, collapse to a leaf with the recursive total.
    if depth >= TREE_MAX_DEPTH {
        return Some(DirSizeNode {
            name,
            path: path.to_string_lossy().to_string(),
            size_bytes: count_all_dir_unfiltered(path),
            is_dir: true,
            is_skip,
            children: Vec::new(),
        });
    }
    let Ok(dir_entries) = std::fs::read_dir(path) else {
        return Some(DirSizeNode {
            name,
            path: path.to_string_lossy().to_string(),
            size_bytes: 0,
            is_dir: true,
            is_skip,
            children: Vec::new(),
        });
    };
    let mut children: Vec<DirSizeNode> = dir_entries
        .flatten()
        .filter_map(|e| compute_dir_size_node(&e.path(), depth + 1))
        .collect();
    children.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    // Aggregate tiny entries so small files don't flood the treemap but
    // the parent total stays accurate.
    let mut kept: Vec<DirSizeNode> = Vec::with_capacity(children.len().min(TREE_MAX_CHILDREN + 1));
    let mut other_bytes = 0u64;
    let mut other_count = 0usize;
    for child in children {
        if kept.len() >= TREE_MAX_CHILDREN || (child.size_bytes < TREE_MIN_BYTES && kept.len() >= 8)
        {
            other_bytes += child.size_bytes;
            other_count += 1;
        } else {
            kept.push(child);
        }
    }
    if other_count > 0 {
        kept.push(DirSizeNode {
            name: format!("… {other_count} more"),
            path: path.to_string_lossy().to_string(),
            size_bytes: other_bytes,
            is_dir: false,
            is_skip: false,
            children: Vec::new(),
        });
    }

    let size_bytes = kept.iter().map(|c| c.size_bytes).sum();
    Some(DirSizeNode {
        name,
        path: path.to_string_lossy().to_string(),
        size_bytes,
        is_dir: true,
        is_skip,
        children: kept,
    })
}

pub fn compute_dir_size_tree(root: &Path) -> Result<DirSizeNode, StableError> {
    if !root.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "not a directory"));
    }
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("root")
        .to_string();
    let Ok(dir_entries) = std::fs::read_dir(root) else {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "cannot read directory",
        ));
    };
    let mut children: Vec<DirSizeNode> = dir_entries
        .flatten()
        .filter_map(|e| compute_dir_size_node(&e.path(), 1))
        .collect();
    children.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let mut kept: Vec<DirSizeNode> = Vec::with_capacity(children.len().min(TREE_MAX_CHILDREN + 1));
    let mut other_bytes = 0u64;
    let mut other_count = 0usize;
    for child in children {
        if kept.len() >= TREE_MAX_CHILDREN || (child.size_bytes < TREE_MIN_BYTES && kept.len() >= 8)
        {
            other_bytes += child.size_bytes;
            other_count += 1;
        } else {
            kept.push(child);
        }
    }
    if other_count > 0 {
        kept.push(DirSizeNode {
            name: format!("… {other_count} more"),
            path: root.to_string_lossy().to_string(),
            size_bytes: other_bytes,
            is_dir: false,
            is_skip: false,
            children: Vec::new(),
        });
    }

    let size_bytes = kept.iter().map(|c| c.size_bytes).sum();
    Ok(DirSizeNode {
        name,
        path: root.to_string_lossy().to_string(),
        size_bytes,
        is_dir: true,
        is_skip: false,
        children: kept,
    })
}

#[tauri::command]
pub async fn get_dir_size_tree(path: String) -> Result<DirSizeNode, StableError> {
    tauri::async_runtime::spawn_blocking(move || compute_dir_size_tree(Path::new(&path)))
        .await
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))?
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::Write;

    use super::*;

    #[test]
    fn breakdown_includes_skip_dirs_and_sizes() {
        let base = std::env::temp_dir().join(format!("pv-size-breakdown-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        let mut f = File::create(base.join("readme.txt")).unwrap();
        f.write_all(b"hello").unwrap();

        fs::create_dir_all(base.join("src")).unwrap();
        let mut f = File::create(base.join("src/main.rs")).unwrap();
        f.write_all(b"fn main(){}").unwrap();

        fs::create_dir_all(base.join("node_modules/pkg")).unwrap();
        let mut f = File::create(base.join("node_modules/pkg/index.js")).unwrap();
        f.write_all(&vec![0u8; 100]).unwrap();

        let result = compute_dir_size_breakdown(&base).unwrap();

        assert_eq!(result.entries.len(), 3);

        let nm = result
            .entries
            .iter()
            .find(|e| e.name == "node_modules")
            .unwrap();
        assert!(nm.is_dir);
        assert!(nm.is_skip);
        assert_eq!(nm.size_bytes, 100);

        let src = result.entries.iter().find(|e| e.name == "src").unwrap();
        assert!(src.is_dir);
        assert!(!src.is_skip);
        assert_eq!(src.size_bytes, 10);

        let readme = result
            .entries
            .iter()
            .find(|e| e.name == "readme.txt")
            .unwrap();
        assert!(!readme.is_dir);
        assert!(!readme.is_skip);
        assert_eq!(readme.size_bytes, 5);

        assert_eq!(result.total_bytes, 115);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn tree_returns_nested_capped_structure() {
        let base = std::env::temp_dir().join(format!("pv-size-tree-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        let mut f = File::create(base.join("readme.txt")).unwrap();
        f.write_all(b"hello").unwrap();

        fs::create_dir_all(base.join("src")).unwrap();
        let mut f = File::create(base.join("src/main.rs")).unwrap();
        f.write_all(b"fn main(){}").unwrap();

        fs::create_dir_all(base.join("node_modules/pkg")).unwrap();
        let mut f = File::create(base.join("node_modules/pkg/index.js")).unwrap();
        f.write_all(&vec![0u8; 100]).unwrap();

        let result = compute_dir_size_tree(&base).unwrap();

        assert!(result.is_dir);
        assert_eq!(result.size_bytes, 115);
        assert_eq!(result.children.len(), 3);

        let nm = result
            .children
            .iter()
            .find(|e| e.name == "node_modules")
            .unwrap();
        assert!(nm.is_dir);
        assert!(nm.is_skip);
        assert_eq!(nm.size_bytes, 100);
        assert_eq!(nm.children.len(), 1);
        assert_eq!(nm.children[0].name, "pkg");

        let _ = fs::remove_dir_all(&base);
    }
}
