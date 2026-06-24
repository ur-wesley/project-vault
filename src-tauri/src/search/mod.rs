use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, INDEXED, STORED, STRING,
};
use tantivy::tokenizer::{LowerCaser, SimpleTokenizer, TextAnalyzer};
use tantivy::{Index, IndexWriter, TantivyError};

use crate::error::{codes, StableError};

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
pub const CURRENT_SCHEMA_VERSION: u32 = 3;

/// Name under which the custom path analyzer is registered with a Tantivy index.
pub const PATH_TOKENIZER: &str = "pv_path";

/// Name under which the case-insensitive content analyzer is registered.
/// The default `SimpleTokenizer` is case-sensitive, which made searches for
/// `google_places` miss content like `GooglePlaces` even after we added
/// `LowerCaser` to the query — both sides have to fold case.
pub const CONTENT_TOKENIZER: &str = "pv_content";

/// Single source of truth for the path analyzer used by `path_full` and
/// `path_tokens`. Callers must register this with the index after creation
/// (see `register_tokenizers`).
pub fn path_tokenizer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .build()
}

/// Single source of truth for the content analyzer used by the `content`
/// field. Same shape as the path analyzer (tokenise + lowercase) so a
/// user query and the indexed text are always in the same case.
pub fn content_tokenizer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .build()
}

/// Register the project's custom analyzers with the given index. Must be
/// called once for every freshly created or opened index — Tantivy persists
/// only the tokenizer *name*, not the analyzer itself, so the manager needs
/// the concrete implementation to resolve it at query time.
pub fn register_tokenizers(index: &Index) {
    index.tokenizers().register(PATH_TOKENIZER, path_tokenizer());
    index.tokenizers().register(CONTENT_TOKENIZER, content_tokenizer());
}

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
    /// File contents — tokenised (case-folded) and stored so we can build a snippet from the doc body.
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

        let path_indexing = TextFieldIndexing::default()
            .set_tokenizer(PATH_TOKENIZER)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let path_full_options =
            TextOptions::default().set_indexing_options(path_indexing.clone()).set_stored();
        let path_full = schema_builder.add_text_field("path_full", path_full_options);

        let path = schema_builder.add_text_field("path", STRING | STORED);
        let path_basename = schema_builder.add_text_field("path_basename", STRING | STORED);

        let path_tokens_options = TextOptions::default().set_indexing_options(path_indexing);
        let path_tokens = schema_builder.add_text_field("path_tokens", path_tokens_options);

        let content_indexing = TextFieldIndexing::default()
            .set_tokenizer(CONTENT_TOKENIZER)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let content_options = TextOptions::default()
            .set_indexing_options(content_indexing)
            .set_stored();
        let content = schema_builder.add_text_field("content", content_options);

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

/// Filename for our schema-version metadata. Lives at the root of the index
/// directory but uses a Tantivy-safe name — earlier builds wrote this at
/// `meta.json`, which is the same path Tantivy uses for its own segment
/// metadata, silently corrupting every existing index.
const SCHEMA_META_FILE: &str = ".pv-meta.json";

/// Resolve the directory where a project's Tantivy index lives.
pub fn index_dir(base: &Path, project_id: &str) -> PathBuf {
    base.join("indices").join(project_id)
}

/// Path to our schema-version metadata file.
pub fn schema_meta_file(base: &Path, project_id: &str) -> PathBuf {
    index_dir(base, project_id).join(SCHEMA_META_FILE)
}

/// One-time migration for users who installed a build that wrote our
/// `IndexMetaFile` payload at `<index>/meta.json`. That filename collides
/// with Tantivy's own `meta.json` (segment metadata), so the legacy build
/// silently overwrote Tantivy's metadata and rendered every index
/// unrecoverable. Detection: the legacy file parses as our schema, which
/// Tantivy's metadata never will. Action: wipe the whole index directory
/// and signal `SCHEMA_INCOMPATIBLE` so the caller's auto-rebuild kicks in.
fn migrate_legacy_meta(base: &Path, project_id: &str) -> bool {
    let dir = index_dir(base, project_id);
    let legacy = dir.join("meta.json");
    let Ok(content) = std::fs::read_to_string(&legacy) else {
        return false;
    };
    if serde_json::from_str::<IndexMetaFile>(&content).is_ok() {
        let _ = std::fs::remove_dir_all(&dir);
        return true;
    }
    false
}

/// Read the persisted schema version, or `None` if missing/unreadable.
pub fn read_schema_version(base: &Path, project_id: &str) -> Option<u32> {
    let path = schema_meta_file(base, project_id);
    let data = std::fs::read_to_string(&path).ok()?;
    let parsed: IndexMetaFile = serde_json::from_str(&data).ok()?;
    Some(parsed.schema_version)
}

/// Persist the current schema version. Best-effort: a write failure is non-fatal
/// (the next rebuild will overwrite).
pub fn write_schema_version(base: &Path, project_id: &str) {
    let path = schema_meta_file(base, project_id);
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
/// Returns `StableError` with code `SCHEMA_INCOMPATIBLE` when:
/// - the index directory is left over from the legacy build that wrote our
///   metadata at Tantivy's own `meta.json` path (the directory is wiped
///   before returning so the next `build_project_index` recreates it), or
/// - a stored schema version is older than `CURRENT_SCHEMA_VERSION`.
///
/// Fresh indices and opened-from-disk indices have the custom path
/// tokenizer registered on them before being returned.
pub fn open_index(base: &Path, project_id: &str) -> Result<Index, StableError> {
    if migrate_legacy_meta(base, project_id) {
        return Err(StableError::new(
            codes::SCHEMA_INCOMPATIBLE,
            "legacy meta.json detected, index directory wiped for clean rebuild",
        ));
    }

    let dir = index_dir(base, project_id);
    let schema = SearchSchema::new().schema;
    if dir.exists() {
        match read_schema_version(base, project_id) {
            Some(v) if v < CURRENT_SCHEMA_VERSION => {
                return Err(StableError::new(
                    codes::SCHEMA_INCOMPATIBLE,
                    "schema version older than CURRENT_SCHEMA_VERSION",
                ));
            }
            Some(_) => {}
            None => {
                // No `.pv-meta.json` and no legacy `meta.json` (migration
                // handled the latter above). Treat as a pre-v2 directory.
                return Err(StableError::new(
                    codes::SCHEMA_INCOMPATIBLE,
                    "missing schema metadata (pre-v2 index)",
                ));
            }
        }
        let index = Index::open_in_dir(&dir).map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("failed to open index: {e}"),
            )
        })?;
        register_tokenizers(&index);
        Ok(index)
    } else {
        std::fs::create_dir_all(&dir).map_err(|e| {
            StableError::new(
                codes::INTERNAL,
                format!("failed to create index dir: {e}"),
            )
        })?;
        let index = Index::create_in_dir(&dir, schema).map_err(|e| match e {
            TantivyError::IndexAlreadyExists => StableError::new(
                codes::SCHEMA_INCOMPATIBLE,
                "index directory already contains a Tantivy index",
            ),
            other => StableError::new(
                codes::INTERNAL,
                format!("failed to create index: {other}"),
            ),
        })?;
        register_tokenizers(&index);
        Ok(index)
    }
}

/// Create a new index writer with a reasonable buffer size (50 MB).
pub fn index_writer(index: &Index) -> Result<IndexWriter, StableError> {
    index
        .writer(50_000_000)
        .map_err(|e| StableError::new(codes::INTERNAL, format!("failed to create index writer: {e}")))
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
