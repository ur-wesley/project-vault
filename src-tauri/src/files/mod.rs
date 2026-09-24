//! Project file IO domain.
//!
//! Owns text reads with binary/size guards, atomic writes, and path
//! operations (create/rename/delete) that are constrained to a project root.
//! The commands layer stays thin and delegates here.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::codes;
use crate::error::StableError;

/// Hard cap for text loads. Larger files are still returned but truncated so
/// the editor never has to hold an unbounded string.
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;

/// Matches the preview pane's existing binary heuristic (see FilePreview.tsx):
/// a NUL byte or more than 10 control characters in the first 1 KiB.
const BINARY_PROBE_BYTES: usize = 1024;

#[derive(Debug, Clone)]
pub struct TextFile {
    pub text: String,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct FileStat {
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub is_dir: bool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Normalize a path for the path-escape check.
///
/// `canonicalize` fails for not-yet-created paths (new file), so we fall back
/// to canonicalizing the deepest existing ancestor and appending the `..`-free
/// remainder lexically.
fn canonical_or_lexical(path: &Path) -> PathBuf {
    if let Ok(c) = fs::canonicalize(path) {
        return c;
    }
    let mut existing = path;
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    while let Some(parent) = existing.parent() {
        if let Ok(c) = fs::canonicalize(existing) {
            let mut out = c;
            for part in suffix.iter().rev() {
                out.push(part);
            }
            return out;
        }
        if let Some(name) = existing.file_name() {
            suffix.push(name.to_os_string());
        }
        existing = parent;
    }
    path.to_path_buf()
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Ensure `target` resolves inside `root`. Blocks `..` traversal and absolute
/// paths that escape the project.
pub fn ensure_within_root(root: &Path, target: &Path) -> Result<PathBuf, StableError> {
    let root_norm = lexical_normalize(&canonical_or_lexical(root));
    let target_norm = lexical_normalize(&canonical_or_lexical(target));

    if target_norm == root_norm || target_norm.starts_with(&root_norm) {
        return Ok(target_norm);
    }
    Err(StableError::new(
        codes::INVALID_PATH,
        "path escapes the project root",
    ))
}

/// Reject names that would escape or confuse the tree.
pub fn validate_name(name: &str) -> Result<(), StableError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(StableError::new(codes::INVALID_PATH, "name is empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(StableError::new(codes::INVALID_PATH, "invalid name"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "name must not contain path separators",
        ));
    }
    if trimmed.contains('\0') {
        return Err(StableError::new(codes::INVALID_PATH, "name contains NUL"));
    }
    Ok(())
}

fn looks_binary(bytes: &[u8]) -> bool {
    let probe = &bytes[..bytes.len().min(BINARY_PROBE_BYTES)];
    if probe.contains(&0) {
        return true;
    }
    let control = probe
        .iter()
        .filter(|b| **b < 32 && **b != 9 && **b != 10 && **b != 13)
        .count();
    control > 10
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms)
}

pub fn stat_path(root: &Path, path: &Path) -> Result<FileStat, StableError> {
    let safe = ensure_within_root(root, path)?;
    let meta = fs::metadata(&safe).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StableError::new(codes::NOT_FOUND, "file not found")
        } else {
            StableError::new(codes::INTERNAL, format!("stat failed: {e}"))
        }
    })?;
    Ok(FileStat {
        size_bytes: meta.len(),
        mtime_ms: mtime_ms(&meta),
        is_dir: meta.is_dir(),
    })
}

/// Read a UTF-8 text file. Binary files return an `INVALID_PATH` error so the
/// caller falls back to the read-only preview instead of opening an editor.
pub fn read_text(root: &Path, path: &Path) -> Result<TextFile, StableError> {
    let safe = ensure_within_root(root, path)?;
    let meta = fs::metadata(&safe).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StableError::new(codes::NOT_FOUND, "file not found")
        } else {
            StableError::new(codes::INTERNAL, format!("stat failed: {e}"))
        }
    })?;

    if meta.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "path is a directory"));
    }

    let bytes = fs::read(&safe)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("read failed: {e}")))?;

    if looks_binary(&bytes) {
        return Err(StableError::new(codes::INVALID_PATH, "binary file"));
    }

    let truncated = bytes.len() as u64 > MAX_TEXT_BYTES;
    let slice = if truncated {
        &bytes[..MAX_TEXT_BYTES as usize]
    } else {
        &bytes[..]
    };

    let text = String::from_utf8_lossy(slice).into_owned();

    Ok(TextFile {
        text,
        size_bytes: meta.len(),
        mtime_ms: mtime_ms(&meta),
        truncated,
    })
}

/// Atomically replace a file's contents: write a sibling temp file, flush it to
/// disk, then rename over the target. A crash mid-write leaves the original
/// intact.
pub fn write_text(root: &Path, path: &Path, content: &str) -> Result<FileStat, StableError> {
    let safe = ensure_within_root(root, path)?;

    if safe.is_dir() {
        return Err(StableError::new(codes::INVALID_PATH, "path is a directory"));
    }

    let parent = safe
        .parent()
        .ok_or_else(|| StableError::new(codes::INVALID_PATH, "path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("create dir failed: {e}")))?;

    let file_name = safe
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());

    let mut tmp = parent.to_path_buf();
    tmp.push(format!(".{file_name}.{}.pv-tmp", std::process::id()));

    {
        let mut handle = fs::File::create(&tmp)
            .map_err(|e| StableError::new(codes::INTERNAL, format!("create temp failed: {e}")))?;
        handle
            .write_all(content.as_bytes())
            .map_err(|e| StableError::new(codes::INTERNAL, format!("write failed: {e}")))?;
        handle
            .sync_all()
            .map_err(|e| StableError::new(codes::INTERNAL, format!("sync failed: {e}")))?;
    }

    if let Err(e) = fs::rename(&tmp, &safe) {
        let _ = fs::remove_file(&tmp);
        return Err(StableError::new(
            codes::INTERNAL,
            format!("atomic replace failed: {e}"),
        ));
    }

    stat_path(root, &safe)
}

/// Create an empty file. Fails when the target already exists.
pub fn create_file(root: &Path, path: &Path) -> Result<FileStat, StableError> {
    let safe = ensure_within_root(root, path)?;
    if safe.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "file already exists",
        ));
    }
    let parent = safe
        .parent()
        .ok_or_else(|| StableError::new(codes::INVALID_PATH, "path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("create dir failed: {e}")))?;
    fs::File::create(&safe)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("create file failed: {e}")))?;
    stat_path(root, &safe)
}

/// Create a directory (recursively). Fails when the target already exists.
pub fn create_dir(root: &Path, path: &Path) -> Result<FileStat, StableError> {
    let safe = ensure_within_root(root, path)?;
    if safe.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "folder already exists",
        ));
    }
    fs::create_dir_all(&safe)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("create dir failed: {e}")))?;
    stat_path(root, &safe)
}

/// Rename or move a file/folder within the project. Refuses to overwrite.
pub fn rename_path(root: &Path, from: &Path, to: &Path) -> Result<FileStat, StableError> {
    let from_safe = ensure_within_root(root, from)?;
    let to_safe = ensure_within_root(root, to)?;

    if !from_safe.exists() {
        return Err(StableError::new(codes::NOT_FOUND, "source not found"));
    }
    if to_safe.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "target already exists",
        ));
    }
    // Refuse to move a directory into its own subtree.
    if from_safe.is_dir() && to_safe.starts_with(&from_safe) {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "cannot move a folder into itself",
        ));
    }

    if let Some(parent) = to_safe.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| StableError::new(codes::INTERNAL, format!("create dir failed: {e}")))?;
    }

    fs::rename(&from_safe, &to_safe)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("rename failed: {e}")))?;
    stat_path(root, &to_safe)
}

/// Delete a file or folder. Directories are removed recursively.
pub fn delete_path(root: &Path, path: &Path) -> Result<(), StableError> {
    let safe = ensure_within_root(root, path)?;

    if safe == lexical_normalize(&canonical_or_lexical(root)) {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "cannot delete the project root",
        ));
    }
    if !safe.exists() {
        return Err(StableError::new(codes::NOT_FOUND, "path not found"));
    }

    if safe.is_dir() {
        fs::remove_dir_all(&safe)
            .map_err(|e| StableError::new(codes::INTERNAL, format!("delete dir failed: {e}")))?;
    } else {
        fs::remove_file(&safe)
            .map_err(|e| StableError::new(codes::INTERNAL, format!("delete file failed: {e}")))?;
    }
    Ok(())
}

/// Posix-normalized path relative to the project root, for the search index.
pub fn relative_slash_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
