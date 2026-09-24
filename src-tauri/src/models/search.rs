use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultDto {
    pub projects_discovered: u64,
    pub projects_upserted: u64,
    pub projects_pruned: u64,
    pub dirs_skipped_errors: u64,
    pub monorepos_expanded: u64,
    pub workspace_warnings: u64,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetaDto {
    pub indexed_files: u64,
    pub index_size_bytes: u64,
    pub last_updated_ms: Option<i64>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    pub path: String,
    /// Tantivy BM25 score for this hit. Used to sort results on the frontend
    /// and to dim low-relevance hits.
    pub score: f32,
    pub highlights: Vec<SearchSnippetDto>,
    pub line_numbers: Vec<usize>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippetDto {
    pub line_number: usize,
    /// Plain-text line, suitable for fallback rendering.
    pub text: String,
    /// Tantivy-generated snippet HTML with `<mark class="pv-mark">` wrappers
    /// around the matched terms. User content is escaped by Tantivy; only the
    /// wrapper tag is HTML.
    pub html: String,
}


