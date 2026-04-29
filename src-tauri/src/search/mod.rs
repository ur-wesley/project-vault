use std::path::{Path, PathBuf};

use tantivy::schema::{Field, Schema, STORED, TEXT};
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

/// Tantivy schema fields wrapper.
pub struct SearchSchema {
    pub schema: Schema,
    pub path: Field,
    pub content: Field,
    pub language: Field,
}

impl SearchSchema {
    pub fn new() -> Self {
        let mut schema_builder = Schema::builder();
        let path = schema_builder.add_text_field("path", TEXT | STORED);
        let content = schema_builder.add_text_field("content", TEXT | STORED);
        let language = schema_builder.add_text_field("language", TEXT | STORED);
        let schema = schema_builder.build();
        Self {
            schema,
            path,
            content,
            language,
        }
    }
}

impl Default for SearchSchema {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolve the directory where a project's Tantivy index lives.
pub fn index_dir(base: &Path, project_id: &str) -> PathBuf {
    base.join("indices").join(project_id)
}

/// Open (or create) a Tantivy index for the given project.
pub fn open_index(base: &Path, project_id: &str) -> tantivy::Result<Index> {
    let dir = index_dir(base, project_id);
    let schema = SearchSchema::new().schema;
    if dir.exists() {
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
