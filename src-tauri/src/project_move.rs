use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use sqlx::Pool;
use sqlx::Sqlite;
use walkdir::WalkDir;

use crate::error::{codes, StableError};
use crate::models::MoveProjectProgress;

fn map_move_io(context: &str, e: std::io::Error) -> StableError {
    let detail = e.to_string();
    match e.kind() {
        ErrorKind::PermissionDenied => StableError::new(
            codes::MOVE_FAILED,
            format!("Access denied {context} ({detail}). On Windows, use a local folder you own; avoid read-only, OneDrive, or other protected locations if the app cannot write there, and check antivirus or folder permissions."),
        ),
        _ => StableError::new(codes::MOVE_FAILED, format!("{context}: {detail}")),
    }
}

fn map_path_io(context: &str, e: std::io::Error) -> StableError {
    let detail = e.to_string();
    match e.kind() {
        ErrorKind::PermissionDenied => StableError::new(
            codes::INVALID_PATH,
            format!("Access denied {context} ({detail}). Choose a library folder you can read and write, or a different drive."),
        ),
        _ => StableError::new(codes::INVALID_PATH, format!("{context}: {detail}")),
    }
}

fn is_skip_name(name: &str) -> bool {
    const ANY_DEPTH: &[&str] = &[
        "node_modules",
        "target",
        "dist",
        "build",
        "out",
        ".next",
        "venv",
        ".venv",
        "vendor",
        "Pods",
        "__pycache__",
        "coverage",
        ".nuxt",
        ".output",
        ".turbo",
        "tmp",
        "temp",
    ];
    ANY_DEPTH.iter().any(|s| name.eq_ignore_ascii_case(s))
}

fn should_skip_path(rel: &Path) -> bool {
    for c in rel.components() {
        if let std::path::Component::Normal(os) = c {
            if let Some(n) = os.to_str() {
                if is_skip_name(n) {
                    return true;
                }
            }
        }
    }
    false
}

fn should_include_entry(e: &walkdir::DirEntry, src: &Path) -> bool {
    if e.depth() == 0 {
        return true;
    }
    let rel = e.path().strip_prefix(src);
    let Ok(r) = rel else {
        return true;
    };
    !should_skip_path(r)
}

#[derive(Debug, Clone, Copy)]
pub struct DirStats {
    pub file_count: u64,
    pub total_bytes: u64,
    pub last_edited_at_ms: i64,
}

pub fn count_filtered_dir(src: &Path) -> Result<DirStats, std::io::Error> {
    let mut n = 0u64;
    let mut total = 0u64;
    let mut latest_ms = 0i64;

    for entry in WalkDir::new(src)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| should_include_entry(e, src))
    {
        let entry = entry?;
        if entry.file_type().is_file() {
            n += 1;
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
                if let Ok(mtime) = meta.modified() {
                    if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                        let ms = dur.as_millis() as i64;
                        if ms > latest_ms {
                            latest_ms = ms;
                        }
                    }
                }
            }
        }
    }
    Ok(DirStats {
        file_count: n,
        total_bytes: total,
        last_edited_at_ms: latest_ms,
    })
}

pub fn count_all_dir(dir: &Path) -> Result<(u64, u64), std::io::Error> {
    let mut n = 0u64;
    let mut total = 0u64;
    for entry in WalkDir::new(dir).min_depth(1) {
        let entry = entry?;
        if entry.file_type().is_file() {
            n += 1;
            total += entry.metadata()?.len();
        }
    }
    Ok((n, total))
}

fn copy_tree_filtered_with_progress<F: FnMut(MoveProjectProgress)>(
    project_id: &str,
    src: &Path,
    dest: &Path,
    files_total: u64,
    bytes_total: u64,
    on_progress: &mut F,
) -> Result<(), std::io::Error> {
    let mut files_done = 0u64;
    let mut bytes_done = 0u64;
    let mut last_emit = Instant::now();
    let pid = project_id.to_string();
    for entry in WalkDir::new(src)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| should_include_entry(e, src))
    {
        let entry = entry?;
        let rel = entry.path().strip_prefix(src).expect("child of src");
        if should_skip_path(rel) {
            continue;
        }
        let to = dest.join(rel);
        let meta = entry.metadata()?;
        let kind = meta.file_type();
        if kind.is_dir() {
            fs::create_dir_all(&to)?;
        } else if kind.is_file() {
            if let Some(p) = to.parent() {
                fs::create_dir_all(p)?;
            }
            let len = meta.len();
            fs::copy(entry.path(), &to)?;
            files_done += 1;
            bytes_done += len;
            let should_emit = files_done == files_total
                || files_done % 16 == 0
                || last_emit.elapsed() > Duration::from_millis(100);
            if should_emit {
                on_progress(MoveProjectProgress {
                    project_id: pid.clone(),
                    phase: "copying".to_string(),
                    files_total,
                    bytes_total,
                    files_done,
                    bytes_done,
                });
                last_emit = Instant::now();
            }
        }
    }
    on_progress(MoveProjectProgress {
        project_id: pid,
        phase: "copying".to_string(),
        files_total,
        bytes_total,
        files_done,
        bytes_done,
    });
    Ok(())
}

fn copy_and_verify<F: FnMut(MoveProjectProgress)>(
    project_id: &str,
    src: &Path,
    dest: &Path,
    on_progress: &mut F,
) -> Result<(u64, u64), StableError> {
    let stats =
        count_filtered_dir(src).map_err(|e| map_move_io("while listing files to copy", e))?;
    let files_total = stats.file_count;
    let bytes_total = stats.total_bytes;
    on_progress(MoveProjectProgress {
        project_id: project_id.to_string(),
        phase: "preparing".to_string(),
        files_total,
        bytes_total,
        files_done: 0,
        bytes_done: 0,
    });
    if dest.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "destination already exists",
        ));
    }
    let cleanup_on_err = || {
        if dest.exists() {
            let _ = fs::remove_dir_all(dest);
        }
    };
    fs::create_dir(dest).map_err(|e| map_move_io("while creating the destination folder", e))?;
    on_progress(MoveProjectProgress {
        project_id: project_id.to_string(),
        phase: "copying".to_string(),
        files_total,
        bytes_total,
        files_done: 0,
        bytes_done: 0,
    });
    if let Err(e) = copy_tree_filtered_with_progress(
        project_id,
        src,
        dest,
        files_total,
        bytes_total,
        on_progress,
    ) {
        cleanup_on_err();
        return Err(map_move_io("while copying project files", e));
    }
    on_progress(MoveProjectProgress {
        project_id: project_id.to_string(),
        phase: "verifying".to_string(),
        files_total,
        bytes_total,
        files_done: files_total,
        bytes_done: bytes_total,
    });
    let stats = count_filtered_dir(src).map_err(|e| {
        cleanup_on_err();
        map_move_io("while verifying the copy (source)", e)
    })?;
    let a_n = stats.file_count;
    let a_b = stats.total_bytes;
    let (d_n, d_b) = count_all_dir(dest).map_err(|e| {
        cleanup_on_err();
        map_move_io("while verifying the copy (destination)", e)
    })?;
    if a_n != d_n || a_b != d_b {
        cleanup_on_err();
        return Err(StableError::new(
            codes::MOVE_FAILED,
            "copy verification failed: file count or total size did not match",
        ));
    }
    Ok((files_total, bytes_total))
}

fn paths_invalid_move(src: &Path, dest: &Path) -> Option<&'static str> {
    let ok_src = dunce::canonicalize(src).ok()?;
    let ok_dest = dunce::canonicalize(dest).ok()?;
    if ok_src == ok_dest {
        return Some("source and destination are the same");
    }
    if ok_dest.starts_with(&ok_src) {
        return Some("the destination cannot be inside the project you are moving");
    }
    None
}

fn normalize_path(p: &Path) -> String {
    dunce::canonicalize(p)
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string_lossy().to_string())
}

pub struct MovePrepared {
    pub source: PathBuf,
    pub dest: PathBuf,
    pub dest_path_string: String,
    pub location_id: String,
}

pub async fn prepare_move(
    pool: &Pool<Sqlite>,
    project_id: &str,
    destination_parent: &str,
) -> Result<MovePrepared, StableError> {
    let project = crate::db::get_project(pool, project_id).await?;
    let src = PathBuf::from(&project.path);
    if !src.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "project path is not a directory",
        ));
    }
    let src = dunce::canonicalize(&src).map_err(|e| map_path_io("for the project folder", e))?;
    let parent = Path::new(destination_parent);
    if !parent.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "parent folder is not a directory",
        ));
    }
    let parent = dunce::canonicalize(parent)
        .map_err(|e| map_path_io("for the destination library folder", e))?;
    if parent.starts_with(&src) {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "the target library folder is inside this project. Add or pick a location outside the project directory.",
        ));
    }
    let name = src
        .file_name()
        .ok_or_else(|| StableError::new(codes::INVALID_PATH, "invalid project folder name"))?;
    let dest = parent.join(name);
    if let Some(m) = paths_invalid_move(&src, &dest) {
        return Err(StableError::new(codes::INVALID_PATH, m));
    }
    if dest.exists() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "a folder with that name already exists at the destination",
        ));
    }
    let parent_path_string = parent.to_string_lossy().to_string();
    let location_id = crate::db::find_location_id_for_path(pool, &parent_path_string).await?;
    let dest_path_string = normalize_path(&dest);
    let other: Option<String> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE location_id = ?1 AND path = ?2 AND id != ?3",
    )
    .bind(&location_id)
    .bind(&dest_path_string)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| StableError::new(codes::DB_ERROR, e.to_string()))?;
    if other.is_some() {
        return Err(StableError::new(
            codes::ALREADY_EXISTS,
            "the library already has another project at that path",
        ));
    }
    Ok(MovePrepared {
        source: src,
        dest,
        dest_path_string,
        location_id,
    })
}

pub fn run_copy_and_verify<F: FnMut(MoveProjectProgress) + Send>(
    project_id: &str,
    src: &Path,
    dest: &Path,
    on_progress: &mut F,
) -> Result<(u64, u64), StableError> {
    copy_and_verify(project_id, src, dest, on_progress)
}

pub async fn update_after_move(
    pool: &Pool<Sqlite>,
    project_id: &str,
    new_path: &str,
    location_id: &str,
) -> Result<crate::models::ProjectDto, StableError> {
    crate::db::update_project_path_and_location(pool, project_id, new_path, location_id).await
}
