use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

use ignore::WalkBuilder;
use tantivy::collector::TopDocs;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;
use tantivy::{doc, Index, IndexWriter, Term};

use crate::search::{
    guess_language, is_binary, open_index, write_schema_version, SearchSchema, ALWAYS_SKIP,
    DEFAULT_MAX_FILE_SIZE,
};
use crate::error::{codes, StableError};

/// Metadata about a project's search index.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMeta {
    pub indexed_files: u64,
    pub index_size_bytes: u64,
    pub last_updated_ms: Option<i64>,
}

/// Build or rebuild the full index for a project.
pub fn build_project_index(
    app_data_dir: &Path,
    project_id: &str,
    project_path: &Path,
) -> Result<IndexMeta, StableError> {
    let index = open_index(app_data_dir, project_id).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to open index: {e}"))
    })?;

    let schema = SearchSchema::new();
    let mut writer = index.writer(50_000_000).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to create index writer: {e}"))
    })?;

    // Clear existing documents
    writer.delete_all_documents().map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to clear index: {e}"))
    })?;

    let mut indexed_files: u64 = 0;
    let skip_set: HashSet<&str> = ALWAYS_SKIP.iter().copied().collect();

    let walker = WalkBuilder::new(project_path)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .max_depth(None)
        .filter_entry(move |entry| {
            if let Some(name) = entry.file_name().to_str() {
                if skip_set.contains(name) {
                    return false;
                }
            }
            true
        })
        .build();

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        let path = entry.path();

        // Skip files larger than threshold
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() > DEFAULT_MAX_FILE_SIZE {
                continue;
            }
        }

        if let Err(_) = index_single_file(&schema, &mut writer, project_path, path) {
            continue;
        }
        indexed_files += 1;
    }

    writer.commit().map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to commit index: {e}"))
    })?;

    // Persist the schema version so the next `open_index` can verify compatibility.
    write_schema_version(app_data_dir, project_id);

    let meta = index_meta(app_data_dir, project_id)?;
    Ok(IndexMeta {
        indexed_files,
        ..meta
    })
}

/// Index a single file into the given writer.
fn index_single_file(
    schema: &SearchSchema,
    writer: &mut IndexWriter,
    project_path: &Path,
    file_path: &Path,
) -> Result<(), StableError> {
    let meta = fs::metadata(file_path).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("metadata read failed: {e}"))
    })?;

    let data = fs::read(file_path).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("read failed: {e}"))
    })?;

    if is_binary(&data) {
        return Ok(());
    }

    let text = String::from_utf8(data).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("utf-8 decode failed: {e}"))
    })?;

    let rel_path = file_path
        .strip_prefix(project_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace('\\', "/");

    let language = guess_language(file_path);

    let basename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Tokenise the path: split on `/`, `.`, `_`, `-`, drop empty fragments.
    let path_token_str: String = rel_path
        .split(|c: char| c == '/' || c == '.' || c == '_' || c == '-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let size_bytes = meta.len();

    let doc = doc!(
        schema.path => rel_path.clone(),
        schema.path_full => rel_path,
        schema.path_basename => basename,
        schema.path_tokens => path_token_str,
        schema.content => text,
        schema.language => language,
        schema.mtime => mtime_ms,
        schema.size => size_bytes,
    );

    writer.add_document(doc).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("add document failed: {e}"))
    })?;

    Ok(())
}

/// Remove a single file from the index by its relative path.
pub fn remove_file_from_index(
    app_data_dir: &Path,
    project_id: &str,
    rel_path: &str,
) -> Result<(), StableError> {
    let index = open_index(app_data_dir, project_id).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to open index: {e}"))
    })?;

    let schema = SearchSchema::new();
    let mut writer = index.writer(50_000_000).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to create index writer: {e}"))
    })?;

    // Target the `path` field (STRING | STORED) which holds the raw relative path.
    let term = Term::from_field_text(schema.path, rel_path);
    writer.delete_term(term);

    writer.commit().map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to commit deletion: {e}"))
    })?;

    Ok(())
}

/// Read the stored mtime for a given relative path, or `None` if missing.
///
/// The mtime lookup is best-effort: a `Tantivy` error here is non-fatal — we
/// treat it as "unknown mtime" and force a re-index.
fn read_doc_mtime(index: &Index, schema: &SearchSchema, rel_path: &str) -> Option<u64> {
    let reader = index.reader().ok()?;
    let searcher = reader.searcher();
    let term = Term::from_field_text(schema.path, rel_path);
    let term_query = TermQuery::new(term, IndexRecordOption::Basic);
    let top = searcher.search(&term_query, &TopDocs::with_limit(1)).ok()?;
    let (_score, addr) = top.first()?;
    let doc = searcher.doc(*addr).ok()?;
    let val = doc.get_first(schema.mtime)?;
    val.as_u64()
}

/// Update (add or replace) a single file in the index.
///
/// If the on-disk mtime matches the stored mtime, the call short-circuits —
/// a no-op wiring for the future watcher to call.
pub fn update_file_in_index(
    app_data_dir: &Path,
    project_id: &str,
    project_path: &Path,
    file_path: &Path,
) -> Result<(), StableError> {
    let rel_path = file_path
        .strip_prefix(project_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace('\\', "/");

    // Read on-disk mtime (or 0 on failure).
    let on_disk_mtime: u64 = fs::metadata(file_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Short-circuit: if the stored doc already has the same mtime, skip the work.
    if let Ok(index) = open_index(app_data_dir, project_id) {
        let schema = SearchSchema::new();
        if let Some(stored_mtime) = read_doc_mtime(&index, &schema, &rel_path) {
            if stored_mtime == on_disk_mtime && on_disk_mtime != 0 {
                return Ok(());
            }
        }
    }

    // Remove existing doc for this path
    let _ = remove_file_from_index(app_data_dir, project_id, &rel_path);

    let index = open_index(app_data_dir, project_id).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to open index: {e}"))
    })?;

    let schema = SearchSchema::new();
    let mut writer = index.writer(50_000_000).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to create index writer: {e}"))
    })?;

    if let Ok(meta) = fs::metadata(file_path) {
        if meta.len() > DEFAULT_MAX_FILE_SIZE {
            return Ok(());
        }
    }

    index_single_file(&schema, &mut writer, project_path, file_path)?;

    writer.commit().map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to commit update: {e}"))
    })?;

    Ok(())
}

/// Delete the entire index for a project.
pub fn delete_project_index(app_data_dir: &Path, project_id: &str) -> Result<(), StableError> {
    let dir = crate::search::index_dir(app_data_dir, project_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| {
            StableError::new(codes::INTERNAL, format!("failed to remove index directory: {e}"))
        })?;
    }
    Ok(())
}

/// Get metadata about a project's index.
pub fn index_meta(app_data_dir: &Path, project_id: &str) -> Result<IndexMeta, StableError> {
    let dir = crate::search::index_dir(app_data_dir, project_id);
    let mut index_size_bytes: u64 = 0;
    let mut last_updated_ms: Option<i64> = None;
    let mut indexed_files: u64 = 0;

    if dir.exists() {
        // Calculate directory size recursively
        fn dir_size(path: &std::path::Path) -> u64 {
            let mut size = 0u64;
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_symlink() {
                            continue;
                        }
                        if ft.is_file() {
                            if let Ok(meta) = entry.metadata() {
                                size += meta.len();
                            }
                        } else if ft.is_dir() {
                            size += dir_size(&entry.path());
                        }
                    }
                }
            }
            size
        }
        index_size_bytes = dir_size(&dir);

        // Try to get last modified time of the directory
        if let Ok(meta) = fs::metadata(&dir) {
            if let Ok(modified) = meta.modified() {
                if let Ok(duration) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                    last_updated_ms = Some(duration.as_millis() as i64);
                }
            }
        }

        // Try to open index and count documents
        if let Ok(index) = Index::open_in_dir(&dir) {
            if let Ok(reader) = index.reader() {
                let searcher = reader.searcher();
                indexed_files = searcher.num_docs() as u64;
            }
        }
    }

    Ok(IndexMeta {
        indexed_files,
        index_size_bytes,
        last_updated_ms,
    })
}

/// Check whether an index exists for a project.
pub fn index_exists(app_data_dir: &Path, project_id: &str) -> bool {
    crate::search::index_dir(app_data_dir, project_id).exists()
}
