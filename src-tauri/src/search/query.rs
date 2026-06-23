use std::path::Path;

use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, PhraseQuery, Query, QueryParser, TermQuery,
};
use tantivy::schema::IndexRecordOption;
use tantivy::{Index, Snippet, SnippetGenerator, Term};

use crate::error::{codes, StableError};
use crate::models::{SearchHitDto, SearchSnippetDto};
use crate::search::open_index;
use crate::search::SearchSchema;

/// Wrapper used to mark up snippet text from Tantivy. Tantivy's default
/// wrapper is `<b>`; we swap to `<mark class="pv-mark">` for the frontend.
const MARK_START: &str = "<mark class=\"pv-mark\">";
const MARK_END: &str = "</mark>";

/// Search a project's index with the given query string.
pub fn search_project_index(
    app_data_dir: &Path,
    project_id: &str,
    query_str: &str,
    limit: usize,
) -> Result<Vec<SearchHitDto>, StableError> {
    let index = open_index(app_data_dir, project_id).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to open index: {e}"))
    })?;

    let schema = SearchSchema::new();
    let reader = index.reader().map_err(|e| {
        StableError::new(codes::INTERNAL, format!("failed to create reader: {e}"))
    })?;
    let searcher = reader.searcher();

    let (query, _processed_raw) = build_query(&index, &schema, query_str)?;

    let top_docs = searcher
        .search(&query, &tantivy::collector::TopDocs::with_limit(limit))
        .map_err(|e| StableError::new(codes::INTERNAL, format!("search failed: {e}")))?;

    // Snippet generator over `content` — drives the body snippet HTML.
    let content_snip = SnippetGenerator::create(&searcher, &*query, schema.content).ok();
    // Snippet generator over `path_full` — used for path-only matches so the
    // synthetic highlight position aligns with the path string.
    let path_snip = SnippetGenerator::create(&searcher, &*query, schema.path_full).ok();

    let mut hits = Vec::new();
    for (score, doc_address) in top_docs {
        if let Ok(doc) = searcher.doc(doc_address) {
            let path = doc
                .get_first(schema.path)
                .and_then(|v| v.as_text())
                .unwrap_or("")
                .to_string();

            let content = doc
                .get_first(schema.content)
                .and_then(|v| v.as_text())
                .unwrap_or("")
                .to_string();

            let (highlights, line_numbers) = build_snippets(
                content_snip.as_ref(),
                path_snip.as_ref(),
                &doc,
                &content,
                &path,
            );

            hits.push(SearchHitDto {
                path,
                score,
                highlights,
                line_numbers,
            });
        }
    }

    Ok(hits)
}

/// Build a Tantivy query from a user query string.
///
/// Dispatcher routes to one of four branches:
///   1. Filename fast-path  — `package.json`, `eslint.config.js`, `Dockerfile`
///   2. Exact phrase       — `"foo bar"`
///   3. Single bare token  — `bar`
///   4. Complex query      — anything else (uses `QueryParser` with safer fuzzy)
fn build_query(
    index: &Index,
    schema: &SearchSchema,
    query_str: &str,
) -> Result<(Box<dyn Query>, String), StableError> {
    let raw = query_str.trim();
    if raw.is_empty() {
        return Err(StableError::new(codes::INTERNAL, "empty query"));
    }

    // 1. Exact phrase in quotes -> direct PhraseQuery (fast, reliable)
    if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        let phrase = &raw[1..raw.len() - 1];
        let terms: Vec<Term> = phrase
            .split_whitespace()
            .map(|w| Term::from_field_text(schema.content, w))
            .collect();
        if terms.is_empty() {
            return Err(StableError::new(codes::INTERNAL, "empty phrase"));
        }
        return Ok((Box::new(PhraseQuery::new(terms)), raw.to_string()));
    }

    // 2. Filename fast-path — `package.json`, `eslint.config.js`, `Dockerfile`, etc.
    if let Some(q) = build_filename_query(schema, raw) {
        return Ok((q, raw.to_string()));
    }

    // 3. Single bare token -> boosted: path > content (fuzzy).
    if !raw.contains(' ') && !raw.contains('"') && !raw.contains(':') && !raw.contains('~') {
        let q = build_single_token_query(schema, raw);
        return Ok((q, raw.to_string()));
    }

    // 4. Complex query -> preprocess + QueryParser
    let processed = preprocess_query(raw);

    // Pass `path_full` (tokenised path) ahead of `content` so `path:foo` and
    // bare `foo` terms hit path matches first.
    let mut parser =
        QueryParser::for_index(index, vec![schema.content, schema.path_full, schema.path_basename]);
    parser.set_conjunction_by_default();

    let query = parser.parse_query(&processed).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("query parse error: {e}"))
    })?;

    Ok((query, processed))
}

/// True when the raw string looks like a filename the user is targeting
/// (e.g. `package.json`, `eslint.config.js`, `Dockerfile`).
///
/// Rules:
///   - No whitespace
///   - Only contains `a-z`, `A-Z`, `0-9`, `.`, `_`, `-`
///   - Does not start with `:`, `"`, `~`, `*`, `+`, `-`
///   - Has at least one alphanumeric character
fn looks_like_filename(raw: &str) -> bool {
    if raw.is_empty() || raw.contains(char::is_whitespace) {
        return false;
    }

    let first = raw.chars().next().unwrap();
    if matches!(first, ':' | '"' | '~' | '*' | '+' | '-') {
        return false;
    }

    if !raw
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return false;
    }

    if !raw.chars().any(|c| c.is_ascii_alphanumeric()) {
        return false;
    }

    true
}

fn build_filename_query(schema: &SearchSchema, raw: &str) -> Option<Box<dyn Query>> {
    if !looks_like_filename(raw) {
        return None;
    }

    let lower = raw.to_lowercase();
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

    // Exact basename match — strongest signal.
    let basename_term = Term::from_field_text(schema.path_basename, &lower);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(TermQuery::new(basename_term, IndexRecordOption::Basic)),
            10.0,
        )),
    ));

    // Tokenised path components — strong signal for partial matches.
    for tok in lower.split(|c: char| c == '.' || c == '_' || c == '-') {
        if tok.is_empty() {
            continue;
        }
        let term = Term::from_field_text(schema.path_tokens, tok);
        clauses.push((
            Occur::Should,
            Box::new(BoostQuery::new(
                Box::new(TermQuery::new(term, IndexRecordOption::Basic)),
                6.0,
            )),
        ));
    }

    // Fuzzy on the longest token (usually the file stem).
    let stem = lower
        .split(|c: char| c == '.' || c == '_' || c == '-')
        .find(|s| !s.is_empty())
        .unwrap_or(&lower);
    let stem_term = Term::from_field_text(schema.path_tokens, stem);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new(stem_term, 1, true)),
            3.0,
        )),
    ));

    // Fuzzy on content (distance 2) as a safety net.
    let content_term = Term::from_field_text(schema.content, &lower);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new(content_term, 2, true)),
            1.0,
        )),
    ));

    Some(Box::new(BooleanQuery::new(clauses)))
}

fn build_single_token_query(schema: &SearchSchema, raw: &str) -> Box<dyn Query> {
    let lower = raw.to_lowercase();
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

    // Content fuzzy (distance 2).
    let content_term = Term::from_field_text(schema.content, &lower);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new(content_term, 2, true)),
            1.0,
        )),
    ));

    // Path token exact.
    let token_term = Term::from_field_text(schema.path_tokens, &lower);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(TermQuery::new(token_term, IndexRecordOption::Basic)),
            4.0,
        )),
    ));

    // Path token fuzzy.
    let fuzzy_term = Term::from_field_text(schema.path_tokens, &lower);
    clauses.push((
        Occur::Should,
        Box::new(BoostQuery::new(
            Box::new(FuzzyTermQuery::new(fuzzy_term, 1, true)),
            2.0,
        )),
    ));

    Box::new(BooleanQuery::new(clauses))
}

/// Pre-process a raw user query so bare words become fuzzy (`~2`) while
/// quoted phrases and advanced syntax (`:`, `~`, `*`) are left alone.
///
/// Be conservative: only inject `~2` when the term is 4+ chars long. Short
/// terms (1-3 chars) get exact matching only — fuzzy on `bar` would match
/// `baz`, `bat`, etc., which is noise.
fn preprocess_query(query: &str) -> String {
    let mut result = String::new();
    let mut chars = query.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if ch == '"' {
            in_quotes = !in_quotes;
            result.push(ch);
            continue;
        }

        if in_quotes {
            result.push(ch);
            continue;
        }

        // Unquoted segment — look for words and optionally fuzzy them.
        if ch.is_alphanumeric() || ch == '_' {
            let mut word = String::new();
            word.push(ch);

            while let Some(&next) = chars.peek() {
                if next.is_alphanumeric() || next == '_' || next == '-' {
                    word.push(next);
                    chars.next();
                } else {
                    break;
                }
            }

            let has_advanced = word.contains('~') || word.contains(':') || word.contains('*');
            let preceded_by_path = word.starts_with("path") && word.contains(':');
            let long_enough = word.chars().count() >= 4;

            result.push_str(&word);
            if !has_advanced && !preceded_by_path && long_enough {
                result.push_str("~2");
            }
        } else {
            result.push(ch);
        }
    }

    result
}

/// Build the snippet payload for a single hit. Returns `(highlights, line_numbers)`.
///
/// - For content matches, the snippet comes from the `content` field. The
///   `line_numbers` vector contains one entry — the line of the first match,
///   derived from the number of newlines in the snippet's pre-context.
/// - For path-only matches, the snippet comes from the `path_full` field. The
///   `line_numbers` vector is empty; the user navigates by clicking the card.
fn build_snippets(
    content_gen: Option<&SnippetGenerator>,
    path_gen: Option<&SnippetGenerator>,
    doc: &tantivy::TantivyDocument,
    _content: &str,
    path: &str,
) -> (Vec<SearchSnippetDto>, Vec<usize>) {
    // Try content snippet first.
    if let Some(gen) = content_gen {
        let snippet = gen.snippet_from_doc(doc);
        if !snippet.is_empty() {
            let (line_number, html) = rewrap_snippet(&snippet);
            let plain = strip_marks(&html);
            return (
                vec![SearchSnippetDto {
                    line_number,
                    text: plain,
                    html,
                }],
                vec![line_number],
            );
        }
    }

    // Fall back to path snippet for path-only matches.
    if let Some(gen) = path_gen {
        let snippet = gen.snippet_from_doc(doc);
        if !snippet.is_empty() {
            let (line_number, html) = rewrap_snippet(&snippet);
            let plain = strip_marks(&html);
            return (
                vec![SearchSnippetDto {
                    line_number,
                    text: plain,
                    html,
                }],
                Vec::new(),
            );
        }
    }

    // Last resort: empty path snippet, so we still show the user *something*
    // about why this file matched (the path itself).
    let _ = path;
    (Vec::new(), Vec::new())
}

/// Re-wrap Tantivy's `<b>...</b>` snippet HTML in our `<mark class="pv-mark">` tag,
/// and return the line number of the first match (1-based).
fn rewrap_snippet(snippet: &Snippet) -> (usize, String) {
    let line_number = snippet.pre_snippet().matches('\n').count() + 1;
    let raw = snippet.to_html();
    let html = raw
        .replace("<b>", MARK_START)
        .replace("</b>", MARK_END);
    (line_number, html)
}

/// Strip `<mark ...>` / `</mark>` wrappers for a plain-text rendering.
fn strip_marks(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find(MARK_START) {
        out.push_str(&rest[..start]);
        rest = &rest[start + MARK_START.len()..];
        if let Some(end) = rest.find(MARK_END) {
            out.push_str(&rest[..end]);
            rest = &rest[end + MARK_END.len()..];
        } else {
            break;
        }
    }
    out.push_str(rest);
    out
}
