use std::collections::HashMap;
use std::path::Path;

use tantivy::query::{FuzzyTermQuery, PhraseQuery, QueryParser};
use tantivy::{Index, SnippetGenerator, Term};

use crate::error::{codes, StableError};
use crate::models::{SearchHitDto, SearchSnippetDto};
use crate::search::open_index;
use crate::search::SearchSchema;

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

    let (query, processed_raw) = build_query(&index, &schema, query_str)?;

    let top_docs = searcher
        .search(&query, &tantivy::collector::TopDocs::with_limit(limit))
        .map_err(|e| StableError::new(codes::INTERNAL, format!("search failed: {e}")))?;

    let snippet_gen = SnippetGenerator::create(&searcher, &*query, schema.content).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("snippet generator failed: {e}"))
    })?;

    let mut hits = Vec::new();
    for (_score, doc_address) in top_docs {
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

            let snippet = snippet_gen.snippet_from_doc(&doc);
            let _snippet_html = snippet.fragment().to_string();

            let (highlights, line_numbers) =
                extract_highlights(&content, &processed_raw);

            hits.push(SearchHitDto {
                path,
                highlights,
                line_numbers,
            });
        }
    }

    Ok(hits)
}

/// Build a Tantivy query from a user query string.
///
/// Supported Google-like syntax:
///   - `"exact phrase"`    -> phrase query (exact, no fuzzy)
///   - `word`              -> fuzzy term query (distance 2)
///   - `foo -bar`          -> foo required, bar excluded (QueryParser)
///   - `foo +bar`          -> both required (QueryParser)
///   - `path:foo`          -> field query (QueryParser)
///   - `term~` / `term~2`  -> custom fuzzy (QueryParser)
///
/// Returns the query object plus the raw / processed query strings so the
/// highlighter can know which terms to look for.
fn build_query(
    index: &Index,
    schema: &SearchSchema,
    query_str: &str,
) -> Result<(Box<dyn tantivy::query::Query>, String), StableError> {
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

    // 2. Single bare token -> direct FuzzyTermQuery (most common case)
    if !raw.contains(' ') && !raw.contains('"') && !raw.contains(':') && !raw.contains('~') {
        let term = Term::from_field_text(schema.content, raw);
        return Ok((Box::new(FuzzyTermQuery::new(term, 2, true)), raw.to_string()));
    }

    // 3. Complex query -> preprocess + QueryParser
    let processed = preprocess_query(raw);

    let mut parser = QueryParser::for_index(index, vec![schema.content, schema.path]);
    parser.set_conjunction_by_default();

    let query = parser.parse_query(&processed).map_err(|e| {
        StableError::new(codes::INTERNAL, format!("query parse error: {e}"))
    })?;

    Ok((query, processed))
}

/// Pre-process a raw user query so bare words become fuzzy (`~2`) while
/// quoted phrases and advanced syntax (`:`, `~`, `*`) are left alone.
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

            result.push_str(&word);
            if !has_advanced {
                result.push_str("~2");
            }
        } else {
            result.push(ch);
        }
    }

    result
}

/// Scan the file content for lines that contain the query terms.
///
/// Rules:
///   - Phrases in `"..."` → line must contain the whole phrase.
///   - Space-separated terms → line must contain **any** of them.
///   - Fuzzy `~` is ignored for line detection (we search the literal term).
///   - Prohibited `-` terms are ignored (they only affect scoring/exclusion).
fn extract_highlights(content: &str, processed_query: &str) -> (Vec<SearchSnippetDto>, Vec<usize>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut matched_lines = HashMap::new();

    // Extract search tokens from the processed query.
    let tokens = extract_search_tokens(processed_query);

    for (idx, line) in lines.iter().enumerate() {
        let line_lower = line.to_lowercase();
        for token in &tokens {
            if line_lower.contains(token) {
                matched_lines.insert(idx + 1, *line);
                break;
            }
        }
    }

    let mut sorted: Vec<_> = matched_lines.into_iter().collect();
    sorted.sort_by_key(|(k, _)| *k);

    let highlights: Vec<SearchSnippetDto> = sorted
        .iter()
        .take(5)
        .map(|(num, text)| SearchSnippetDto {
            line_number: *num,
            text: text.to_string(),
        })
        .collect();

    let line_numbers: Vec<usize> = sorted.iter().map(|(num, _)| *num).collect();

    (highlights, line_numbers)
}

/// Strip out the tokens we should search for in raw content.
///
/// - Keeps phrases (text inside quotes) as one token.
/// - Keeps bare words (drops the trailing `~2` fuzzy marker).
/// - Drops prohibited terms (those prefixed with `-`).
/// - Keeps required terms (those prefixed with `+`).
fn extract_search_tokens(processed: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = processed.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if ch == '"' {
            in_quotes = !in_quotes;
            if !in_quotes {
                continue;
            }
            // Start of phrase — collect until closing quote.
            let mut phrase = String::new();
            while let Some(next) = chars.next() {
                if next == '"' {
                    in_quotes = false;
                    break;
                }
                phrase.push(next);
            }
            if !phrase.is_empty() {
                tokens.push(phrase.to_lowercase());
            }
            continue;
        }

        if in_quotes {
            continue;
        }

        if ch.is_whitespace() {
            continue;
        }

        // Skip prohibited terms entirely.
        if ch == '-' {
            while let Some(&next) = chars.peek() {
                if next.is_alphanumeric() || next == '_' || next == '-' {
                    chars.next();
                } else {
                    break;
                }
            }
            // Skip any trailing `~` / digits.
            if chars.peek() == Some(&'~') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    if next.is_ascii_digit() {
                        chars.next();
                    } else {
                        break;
                    }
                }
            }
            continue;
        }

        // Collect a word (skip leading `+` if present).
        let mut word = String::new();
        if ch != '+' {
            word.push(ch);
        }

        // Consume the rest of the word characters.
        while let Some(&next) = chars.peek() {
            if next.is_alphanumeric() || next == '_' || next == '-' {
                word.push(next);
                chars.next();
            } else {
                break;
            }
        }

        // Consume trailing fuzzy marker `~N` (e.g. `~2`).
        if chars.peek() == Some(&'~') {
            chars.next(); // consume '~'
            while let Some(&next) = chars.peek() {
                if next.is_ascii_digit() {
                    chars.next();
                } else {
                    break;
                }
            }
        }

        if !word.is_empty() {
            tokens.push(word.to_lowercase());
        }
    }

    tokens
}
