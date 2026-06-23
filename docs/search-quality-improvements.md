# File-Search Quality Improvements

A design report for upgrading the Tantivy-backed file search in the Files tab. This is a design document — it describes what changes would be made and why. It is not the implementation itself.

## Why

The Files tab search is functional but has several quality issues that hurt everyday use:

1. **No filename fast-path.** Typing `package.json` runs a fuzzy content search instead of a basename match. The same is true for `Cargo.toml`, `eslint.config.js`, etc.
2. **Path is one big string.** A single `TEXT` field for the relative path is not tokenized, so `path:src` works in `QueryParser` but with no boost and no special handling for the basename component.
3. **Highlights are plain text.** Tantivy's `SnippetGenerator` HTML is computed and then discarded (`_snippet_html` at `src-tauri/src/search/query.rs:54`). The result list shows `line_lower.contains(token)` lines with no `<mark>` markup.
4. **No relevance signal.** The BM25 score from Tantivy is bound to `_score` and never surfaced. All hits appear equally important.
5. **Path-only matches are filtered out.** `FileTree.tsx:540` drops any hit where `lineNumbers.length === 0`, which kills the filename-only use case before it can be useful.
6. **No incremental updates.** The 15-minute background scanner (`src-tauri/src/search/background.rs`) is the only refresh path. New files don't appear in search until the next tick. `update_file_in_index` exists (`src-tauri/src/search/indexer.rs:162`) but is unwired.
7. **No schema versioning.** A new schema means a `Tantivy` schema mismatch on existing indices.

## Scope (chosen)

- Schema, query, highlighting, and ranking upgrades.
- Synthetic snippet for path-only matches (the user confirmed this UX).
- Auto-rebuild on schema mismatch.
- **No live filesystem watcher.** The 15-minute background scanner stays as the only refresh path. The watcher's `update_file_in_index` function is reused for any future wiring but is not connected in this design.

## Files involved

- `src-tauri/src/search/mod.rs` — schema, migration
- `src-tauri/src/search/indexer.rs` — populate new fields
- `src-tauri/src/search/query.rs` — query routing, highlighting
- `src-tauri/src/models.rs` — DTOs
- `src/features/project-detail/FileTree.tsx` — drop filter, sort by score
- `src/features/project-detail/components/SearchResultItem.tsx` — render HTML, dim low-score
- `src/types/dto.ts` — TS DTO mirrors

## 1. Schema changes (`search/mod.rs`)

Extend `SearchSchema` with the following fields and a schema version constant:

- `path_full` — `TEXT | STORED`, same value as the existing `path` field but tokenized on `/`, `.`, `_`, `-`, and case-folded. (Implemented with a custom `TextAnalyzer`.)
- `path_basename` — `STRING | STORED`, exact filename like `package.json` as a single untokenized string. Enables exact `TermQuery` lookups.
- `path_tokens` — `TEXT`, the path broken into directory + filename components, case-folded. Drives partial filename matching.
- `mtime` — `U64`, file modification time in ms since epoch. Allows the indexer to skip unchanged files on a future incremental update.
- `size` — `U64`, file size in bytes. Diagnostic.

Keep `content` and `language`. Drop the original `path` field's role as a fuzzy target and reuse it for storage of the relative path string (rename the *role* but keep the field name to minimize migration churn — Tantivy is name-based, so adding new fields is fine; the field named `path` continues to store the same string value).

Add `pub const CURRENT_SCHEMA_VERSION: u32 = 2;` and persist a `meta.json` next to the index directory containing the version, written on every successful `build_project_index`.

In `open_index` (`mod.rs:56-65`), attempt to read `meta.json`. If the version on disk is missing or less than `CURRENT_SCHEMA_VERSION`, return a `tantivy::Error::SchemaIncompatible`. Callers catch this and route to `delete_project_index` then `build_project_index`.

## 2. Indexer changes (`search/indexer.rs`)

In `index_single_file` (line 97), populate the new fields:

- `path_full` ← existing relative path string
- `path_basename` ← `file_name()` of the relative path, lowercased
- `path_tokens` ← the path split on `/`, `.`, `_`, `-`, with empty fragments removed
- `mtime` ← `meta.modified()` as ms since epoch (or 0 on failure)
- `size` ← `meta.len()`

`update_file_in_index` (line 162) should read the existing doc's `mtime` and short-circuit if the on-disk `mtime` is unchanged. This is a no-op wiring for the chosen scope but is the natural place for the future watcher to call.

## 3. Query changes (`search/query.rs`)

Replace the three-branch `build_query` (lines 82-122) with a four-branch dispatcher:

### 3a. Filename fast-path (new)

Detector: `looks_like_filename(raw)` is true when:

- No whitespace
- Contains a `.` followed by 1-5 lowercase alphanumeric chars (an extension)
- Only contains `a-z`, `0-9`, `.`, `_`, `-`
- Does not contain `:`, `"`, `~`, `*`, `+`, `-` at the start

Examples that match: `package.json`, `cargo.toml`, `eslint.config.js`, `Dockerfile`, `Makefile` (the dot check is on `.dockerfile` style — for `Dockerfile` without an extension, the detector is false and we fall through to the path-boosted content path below).

Query:

- `TermQuery` on `path_basename` exact, boost 10.0
- `BooleanQuery::should` of `TermQuery`s on each path token (split on `.`/`_`/`-`) against `path_tokens`, each boost 6.0
- `FuzzyTermQuery` on `path_tokens` (distance 1), boost 3.0
- `FuzzyTermQuery` on `content` (distance 2), boost 1.0

Wrapped in `BooleanQuery` with `Occur::Should`.

### 3b. Phrase (existing, kept verbatim)

Lines 92-103 stay. Optionally route to `path_full` if the phrase contains `/`.

### 3c. Single bare token (existing, augmented)

Replace lines 105-109 (currently `FuzzyTermQuery` on `content` only) with a `BooleanQuery` of `should`:

- `FuzzyTermQuery` on `content` (distance 2), boost 1.0
- `TermQuery` on `path_tokens` exact, boost 4.0
- `FuzzyTermQuery` on `path_tokens` (distance 1), boost 2.0

This makes typing `bar` find `src/foo/bar.ts` before any content match.

### 3d. Complex query (made safer)

Keep `QueryParser` path but:

- Pass `[content, path_full, path_tokens, path_basename]` as the parser fields (priority order).
- Replace `preprocess_query`'s aggressive `~2` injection with: only inject `~2` when the term is 4+ chars and not preceded by `path:`. Short terms (1-3 chars) get exact matching only.
- Document `+`/`-` semantics in code comments. The current `set_conjunction_by_default()` already gives `+term` → `Occur::Must` and `-term` → `Occur::MustNot`.

### 3e. Surfacing score

In `search_project_index` (line 31), the loop iterates over `(score, doc_address)`. Drop the `_` prefix and propagate the score into `SearchHitDto`. Add `score: f32` to `SearchHitDto` (see §4). Sort by `b.score - a.score` on the frontend rather than relying on Tantivy's order, so future server-side reshuffles (e.g. grouping) work transparently.

## 4. DTO changes

### Rust (`src-tauri/src/models.rs`)

```rust
pub struct SearchHitDto {
    pub path: String,
    pub score: f32,
    pub highlights: Vec<SearchSnippetDto>,
    pub line_numbers: Vec<usize>,
}

pub struct SearchSnippetDto {
    pub line_number: usize,
    pub text: String,    // plain (existing)
    pub html: String,    // new — Tantivy's snippet HTML with <mark>
}
```

### TS (`src/types/dto.ts`)

Mirror the new fields.

## 5. Highlighting changes (`search/query.rs`)

Use the `SnippetGenerator` that's already created at line 35 instead of the hand-rolled `extract_highlights`.

- Configure: `set_max_num_chars(240)`, three lines of context window via `Snippet::set_snippet_prefix_postfix`.
- For each hit, get `snippet.html()` (Tantivy's default wrapper is `<b>`; post-process by replacing `<b>` with `<mark class="pv-mark">` — Tantivy escapes user content, so the only HTML we introduce is the wrapper tag).
- Drop `extract_highlights` (lines 178-210) and the `extract_search_tokens` helper (lines 218-309). Replace with the snippet HTML stored in `SearchSnippetDto.html`. The plain `text` field is computed by stripping the `<mark>` wrappers.
- **Path-only matches**: when the snippet generator returns an empty fragment (e.g. a basename match with no body content), build a synthetic highlight: take `path_full`, escape it, and wrap the matched token in `<mark>`. This requires also running a `SnippetGenerator` on `path_full` so the highlight position aligns.

## 6. Frontend changes

### `FileTree.tsx`

- Drop the `h.lineNumbers.length > 0` filter (line 540). The backend should decide what counts as a hit.
- Sort `filteredHits` by `b.score - a.score`.
- The `index:built` listener at line 464 only refetches `indexMetaQ`. Add `searchQ.refetch()` so an in-flight search re-runs after a background rebuild.

### `SearchResultItem.tsx`

- Render the snippet HTML via `innerHTML` on a `<span>`. Solid doesn't have a `dangerouslySetInnerHTML` equivalent; the idiomatic pattern is `ref={(el) => el && (el.innerHTML = snippet.html)}`. Tantivy's snippet HTML is safe — user content is escaped, only the wrapper tag is HTML.
- Add CSS for `.pv-mark` (e.g. `background: rgba(primary, 0.2); color: inherit`) at the component level or in the global stylesheet.
- Add an optional relevance indicator: if `hit.score < 0.3 * topScore`, apply `opacity-60` to the card.

### `dto.ts`

Add `score: number` to `SearchHitDto` and `html: string` to `SearchSnippetDto`.

## 7. Migration

On startup, the existing background scanner will trigger `build_project_index` for every project (already does so on a 15-minute cadence). The first call to `search_project_index` after a schema bump will hit the new `open_index` schema check and return `SchemaIncompatible`. The caller — `commands/search.rs:search_project` — catches this and falls through to `delete_project_index` + `build_project_index` synchronously, then re-runs the search.

The user's chosen migration behavior is **auto-rebuild on schema mismatch**: no UI prompt, no manual step. The rebuild happens on the first search after upgrade and is a one-time cost per project.

## 8. Verification

End-to-end checks against a real project:

1. **Filename only** — type `package.json`. Expect files named `package.json` at the top with the highest score; no body match required.
2. **Content only** — type a unique body phrase like `FuzzyTermQuery::new`. Expect files containing the literal text, in score order.
3. **Phrase** — type `"exact phrase"`. Expect literal phrase matches only.
4. **Multi-term** — type `foo bar`. Expect files matching both, then either.
5. **Fuzzy** — type `paccage` (typo of `package`). Expect filename hits via fuzzy path match.
6. **Boolean** — type `+foo -bar`. Expect only files with `foo` and without `bar`.
7. **Path operator** — type `path:src`. Expect only files under `src/`.
8. **Score ordering** — confirm the list is sorted by score; verify a dim/low-opacity style for low-score hits.
9. **Snippet rendering** — confirm `<mark>` tags appear around matched terms in the rendered snippet HTML, and that user content is properly escaped (no XSS).
10. **Path-only matches** — type a known filename like `Dockerfile` (no extension) and verify it appears even if its content doesn't contain the term; the synthetic path snippet should be visible.
11. **Schema migration** — delete `indices/<project_id>` for one project, restart, expect automatic rebuild on first search.

Build commands:

- `cd src-tauri && cargo build` (debug) and `cargo build --release` (release).
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`.
- `pnpm tsc --noEmit` (or whatever the project's typecheck script is) for the frontend.

## Out of scope (intentional)

- Live filesystem watcher with `notify`. The 15-minute scanner is the only refresh path. `update_file_in_index` is ready to be wired later but is not connected in this design.
- Cross-project search, advanced filters, or saved searches. The current single-project, single-field design is preserved.
- Re-tokening the `content` field. The existing default analyzer is good enough; the bottleneck is filename matching, not content.
- Boost tuning beyond the initial values. The boosts (10/6/3/1) are reasonable starting points; iterate via real-world testing.

## Open questions to resolve during implementation

- Should the `path` field name stay as-is for storage, or be renamed to `path_full`? Renaming changes the on-disk schema; keeping the name preserves `STRING` field compatibility for any future use. Recommendation: keep the field named `path` for storage, but use it for the original relative-path string (not the tokenized variant). Add new fields alongside.
- Should `looks_like_filename` also accept paths-without-extension like `Dockerfile`? Recommendation: yes — a separate detector `looks_like_basename` (no `.` required, all-lowercase alphanumeric + `-_.`, no whitespace) routes to the same fast-path. A `Dockerfile` query should hit the basename path, not the content-fuzzy path.
- The `pv-mark` class — define it inline in `SearchResultItem.tsx` via a `<style>` tag, or add to a global stylesheet? Recommendation: inline, scoped to the component.
