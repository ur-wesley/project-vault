use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tantivy::schema::{Field, Schema, INDEXED, STORED, STRING, TEXT, U64};
use tantivy::tokenizer::{LowerCaser, SimpleTokenizer, TextAnalyzer};
use tantivy::{Index, IndexWriter};

pub mod background;
pub mod indexer;
pub mod query;

/// Hard-coded directory names that are always skipped during indexing.
pub const ALWAYS_SKIP: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".turbo", ".next", ".nuxt",
    "__pycache__", ".venv", "venv", "vendor", ".idea", ".vs", "coverage", ".cache",
    "out", "bin", "obj",
];

/// Default max file size to index (1 MB).
pub const DEFAULT_MAX_FILE_SIZE: u64 = 1_048_576;

/// Bump this whenever the Tantivy schema layout changes. Persisted to
/// `meta.json` next to the index directory; mismatches trigger an
/// automatic rebuild on the next search.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// Tantivy schema fields wrapper.
pub struct SearchSchema {
    pub schema: Schema,
    /// Stored (untokenised at search time) relative path string, e.g. `src/foo/bar.ts`.
    /// Kept for STORED + the legacy `Term` deletes that target this field by name.
    pub path: Field,
    /// Tokenised variant of the path (case-folded, split on `/`, `.`, `_`, `-`).
    pub path_full: Field,
    /// Unt tokenised basename (lowercased), e.g. `package.json`. Drives exact filename lookups.
    pub path_basename: Field,
    /// Tokenised path components, case-folded. Drives partial filename matching.
    pub path_tokens: Field,
    /// File contents — tokenised, stored so we can build a snippet from the doc body.
    pub content: Field,
    /// Guessed language identifier.
    pub language: Field,
    /// File mtime in ms since epoch. Diagnostic; lets `update_file_in_index` short-circuit.
    pub mtime: Field,
    /// File size in bytes. Diagnostic.
    pub size: Field,
}

impl SearchSchema {
    pub fn new() -> Self {
        let mut schema_builder = Schema::builder();

        // Custom analyzer for `path_full`: lowercase, split on whitespace/punctuation.
        let path_analyzer = TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build();

        let path_full = schema_builder.add_text_field("path_full", TEXT | STORED);
        schema_builder.set_field_tokenizer(path_full, path_analyzer);

        let path = schema_builder.add_text_field("path", STRING | STORED);
        let path_basename = schema_builder.add_text_field("path_basename", STRING | STORED);

        // `path_tokens` uses the default tokenizer (which lowercases via LowerCaser
        // by default in tantivy 0.21? — no, default is SimpleTokenizer, case-sensitive).
        // We apply a lowercase filter to make matching case-insensitive.
        let token_analyzer = TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build();
        let path_tokens = schema_builder.add_text_field("path_tokens", TEXT);
        schema_builder.set_field_tokenizer(path_tokens, token_analyzer);

        let content = schema_builder.add_text_field("content", TEXT | STORED);
        let language = schema_builder.add_text_field("language", STRING | STORED);
        let mtime = schema_builder.add_u64_field("mtime", INDEXED | STORED);
        let size = schema_builder.add_u64_field("size", INDEXED | STORED);

        let schema = schema_builder.build();
        Self {
            schema,
            path,
            path_full,
            path_basename,
            path_tokens,
            content,
            language,
            mtime,
            size,
        }
    }
}

impl Default for SearchSchema {
    fn default() -> Self {
        Self::new()
    }
}

/// Persisted alongside the index. The presence (and version) of this file is what
/// lets us detect a schema mismatch and rebuild the index transparently.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMetaFile {
    pub schema_version: u32,
    pub updated_at_ms: i64,
}

/// Resolve the directory where a project's Tantivy index lives.
pub fn index_dir(base: &Path, project_id: &str) -> PathBuf {
    base.join("indices").join(project_id)
}

/// Path to the `meta.json` file written next to the index directory.
pub fn index_meta_file(base: &Path, project_id: &str) -> PathBuf {
    index_dir(base, project_id).join("meta.json")
}

/// Read the persisted schema version, or `None` if missing/unreadable.
pub fn read_schema_version(base: &Path, project_id: &str) -> Option<u32> {
    let path = index_meta_file(base, project_id);
    let data = std::fs::read_to_string(&path).ok()?;
    let parsed: IndexMetaFile = serde_json::from_str(&data).ok()?;
    Some(parsed.schema_version)
}

/// Persist the current schema version. Best-effort: a write failure is non-fatal
/// (the next rebuild will overwrite).
pub fn write_schema_version(base: &Path, project_id: &str) {
    let path = index_meta_file(base, project_id);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let updated_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let payload = IndexMetaFile {
        schema_version: CURRENT_SCHEMA_VERSION,
        updated_at_ms,
    };
    if let Ok(json) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(&path, json);
    }
}

/// Open (or create) a Tantivy index for the given project.
///
/// If the index directory exists and its `meta.json` reports an older schema
/// version, this returns `tantivy::Error::SchemaIncompatible` so callers can
/// route to a transparent delete + rebuild.
pub fn open_index(base: &Path, project_id: &str) -> tantivy::Result<Index> {
    let dir = index_dir(base, project_id);
    let schema = SearchSchema::new().schema;
    if dir.exists() {
        match read_schema_version(base, project_id) {
            Some(v) if v < CURRENT_SCHEMA_VERSION => {
                return Err(tantivy::Error::SchemaIncompatible(
                    "schema version older than CURRENT_SCHEMA_VERSION".to_string(),
                ));
            }
            Some(_) => {}
            None => {
                // No meta file → legacy index. Treat as incompatible so we
                // rebuild with the new schema. This is the migration path
                // for users upgrading from v1.
                return Err(tantivy::Error::SchemaIncompatible(
                    "missing meta.json (legacy index)".to_string(),
                ));
            }
        }
        Index::open_in_dir(&dir)
    } else {
        std::fs::create_dir_all(&dir)?;
        Index::create_in_dir(&dir, schema)
    }
}

/// Create a new index writer with a reasonable buffer size (50 MB).
pub fn index_writer(index: &Index) -> tantivy::Result<IndexWriter> {
    index.writer(50_000_000)
}

/// Detect whether a byte slice represents a binary file.
/// Mirrors the frontend heuristic: null bytes or >10 non-printable chars in first 1024 bytes.
pub fn is_binary(data: &[u8]) -> bool {
    if data.is_empty() {
        return true;
    }
    if data.contains(&0) {
        return true;
    }
    let sample = &data[..data.len().min(1024)];
    let non_printable = sample
        .iter()
        .filter(|&&b| b < 32 && b != 9 && b != 10 && b != 13)
        .count();
    non_printable > 10
}

/// Guess a language identifier from a file path (extension or filename).
pub fn guess_language(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let lang = match name.as_str() {
        "dockerfile" => "docker",
        "makefile" => "sh",
        "gemfile" => "ruby",
        "rakefile" => "ruby",
        "procfile" => "yaml",
        "cmakelists.txt" => "cpp",
        ".gitignore" => "plaintext",
        ".env" => "sh",
        _ => match ext.as_str() {
            "cs" => "csharp",
            "rs" => "rust",
            "py" => "python",
            "js" => "javascript",
            "ts" => "typescript",
            "tsx" => "typescript",
            "jsx" => "javascript",
            "rb" => "ruby",
            "ex" => "elixir",
            "exs" => "elixir",
            "sh" => "sh",
            "bash" => "sh",
            "yml" => "yaml",
            "gradle" => "kotlin",
            "kts" => "kotlin",
            _ if !ext.is_empty() => &ext,
            _ => "plaintext",
        },
    };
    lang.to_string()
}
