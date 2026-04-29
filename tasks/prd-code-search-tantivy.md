# PRD: Full-Text Code Search via Tantivy (per-project indexing)

## 1. Introduction / overview

**Problem:** The **Files** tab in Project Vault lets users browse the file tree and preview individual files, but there is no way to **search across file contents**. In medium-to-large projects, finding symbols, configuration values, or specific code patterns requires leaving the app or manually expanding folders.

**Goal:** Add a **fast, per-project full-text search** inside the Files tab using a [Tantivy](https://github.com/quickwit-oss/tantivy) index maintained in the background. Search results must appear in a dedicated panel (file name, matched lines, snippets) and respect `.gitignore` rules so that build artifacts and dependencies are never indexed.

## 2. Goals

- Let users run a **full-text query** against the currently opened project and see results in the Files tab.
- Return **file path**, **line numbers**, and **code snippets** for each match.
- Support **keyword**, **phrase**, and **fuzzy** matching so that queries like `async`, `"error handler"`, and `fucntion` all produce useful results.
- Keep every project **indexed independently** (no global index) to avoid cross-project leakage and simplify incremental updates.
- Refresh indexes **automatically** via a hybrid strategy: file-system watcher for the active project, periodic background scan for all other indexed projects.
- Provide a **settings toggle** to enable/disable automatic indexing of newly discovered projects.
- When automatic indexing is **off**, expose a manual **"Index this project"** action inside the Files tab, plus live metadata (document count, index size on disk).

## 3. User stories

1. As a user viewing a project, I want to **type a query** in the Files tab and see a list of matching files with snippets so I can quickly locate code.
2. As a user, I want **phrases and fuzzy matches** to work so that exact or slightly misspelled queries still find results.
3. As a user, I do **not** want `node_modules`, `target`, `.git`, or other ignored folders to pollute search results.
4. As a user, I want the index to stay **up-to-date automatically** when I edit files so I do not have to trigger re-indexes manually.
5. As a user who disabled automatic indexing in settings, I want a **one-click "Index project"** button in the Files tab with feedback about index health and disk usage.
6. As a user, I want search to feel **instant** (sub-second for typical queries on mid-size codebases) so it does not break my flow.

## 4. Functional requirements

1. **Schema & indexing** (Rust / Tantivy)
   - Each project gets its own Tantivy index directory stored under the app’s data folder (e.g. `AppData/Local/…/indices/{project_id}`).
   - The index schema must contain:
     - `path` — indexed, stored (file path relative to project root)
     - `content` — indexed with tokenization, stored (full file text)
     - `language` — indexed, stored (optional, for future filtering)
   - Files are parsed as UTF-8; binary files must be **skipped** (use the same heuristic the preview pane already uses: null-byte check or excessive non-printable characters).

2. **Gitignore awareness**
   - The indexer must respect **all nested `.gitignore`** files inside the project tree.
   - It must also apply a **hardcoded safety list** so that even if no `.gitignore` exists, the following are always skipped:
     - `.git`, `node_modules`, `target`, `dist`, `build`, `.turbo`, `.next`, `.nuxt`, `__pycache__`, `.venv`, `venv`, `vendor`, `.idea`, `.vs`, `coverage`, `.cache`, `out`, `bin`, `obj`
   - On each indexing pass, the effective ignore rules must be recomputed from disk so that changes to `.gitignore` are picked up.

3. **Query capabilities**
   - The search command must support:
     - **Keyword / token search** — e.g. `async await`
     - **Exact phrase search** — e.g. `"error handler"`
     - **Fuzzy search** — e.g. `fucntion` should match `function` via Tantivy’s fuzzy term query with a configurable edit distance (default `2`)
   - Results must be ordered by relevance (Tantivy default BM25).
   - The front end must receive, per hit:
     - `path` (string)
     - `highlights` — an array of matched line snippets with surrounding context (e.g. 2 lines before/after)
     - `line_numbers` — the 1-based line numbers that contain matches

4. **Automatic index updates (hybrid strategy)**
   - **Active project** — while the Files tab is open, a file-system watcher (`notify` crate or Tauri fs-events) watches the project tree. On `Create`, `Modify`, or `Remove`, enqueue a lightweight incremental update for the affected file(s).
   - **All other indexed projects** — a background job runs periodically (default every **15 minutes**) to re-scan the project, compare file modification times against the index, and apply deltas.
   - The background job must be **cancellable** and **throttled** so it never starves the UI or other backend work.

5. **Settings toggle**
   - A new boolean setting **"Automatically index discovered projects"** must appear in the **Settings → General** tab.
   - When enabled, any project discovered by the library scanner is queued for indexing automatically.
   - When disabled, projects are **not** indexed unless the user explicitly triggers indexing from the Files tab.

6. **Manual indexing UI (Files tab)**
   - When automatic indexing is **disabled** and the current project has **no index**, show a prominent **"Index this project"** action inside the Files tab.
   - When an index exists (regardless of how it was created), show metadata:
     - **Indexed files** count
     - **Index size on disk** (human-readable bytes)
     - **Last updated** timestamp
   - Provide a **"Rebuild index"** action that drops and re-creates the index for the current project.

7. **Search UI (Files tab)**
   - Add a search input above the file tree or in a shared header area.
   - When a query is submitted (or debounced at ~200 ms), invoke the Tauri search command.
   - Display results in a **dedicated panel** (side-by-side or replacing the file preview pane):
     - File name with relative path
     - Clicking a result opens the file in the preview pane and jumps to the first matched line
     - Snippets are syntax-highlighted using the existing Shiki highlighter if feasible, otherwise plain text with matched terms bolded
   - Show an empty state when there are no matches.
   - Show a loading spinner while the query is in flight.

8. **Performance & limits**
   - Initial indexing of a 10 k-file project should complete in the background within **30 seconds** on a modern SSD.
   - Search queries must return in **< 500 ms** for typical codebases.
   - Skip files larger than a configurable threshold (default **1 MB**) to avoid indexing minified bundles or huge generated files.

9. **Platform**
   - Works on **Windows and macOS** (Tantivy is cross-platform; path handling must use Rust `std::path::Path` and be aware of Windows backslashes).

## 5. Non-goals (out of scope)

- **Cross-project search** — search is scoped to a single project at a time.
- **Regex search** — Tantivy regex queries are not required in v1.
- **Symbol / definition search** — no AST parsing; this is plain full-text search only.
- **Search history / saved queries** — not required in v1.
- **File-content preview inside results** — clicking a result opens the existing preview pane; results show snippets only.
- **Index encryption or cloud sync** — indices remain local.

## 6. Design considerations (UI/UX)

- **Placement:** The search input lives at the top of the Files tab; results appear in the right-hand preview area (replacing the empty/selected-file state) while the file tree remains visible on the left. A clear query button restores the normal preview pane.
- **i18n:** New strings in `en.json` for:
  - Search placeholder, empty state, loading state
  - "Index this project", "Rebuild index"
  - Metadata labels: "Indexed files", "Index size", "Last updated"
- **Accessibility:** Search input must have an accessible label; result items must be keyboard-navigable (arrow keys + Enter to open).

## 7. Technical considerations (optional)

- **Tantivy crate:** Add `tantivy = "0.21"` (or current stable) to the Tauri `Cargo.toml`.
- **Gitignore parsing:** Use `ignore` crate (already handles nested `.gitignore` efficiently) or `gitignore` crate. The `ignore` crate is recommended because it provides `WalkBuilder` with automatic `.gitignore` support and fast directory filtering.
- **File watcher:** Use `notify` crate with a debounced channel. On event, queue a small job that re-indexes the changed file(s) rather than rebuilding the whole index.
- **Background scheduler:** A lightweight Tokio task or Tauri background task that sleeps between periodic scans. Store scan progress in memory only (no DB schema changes required).
- **Tauri commands:**
  - `search_project(project_id, query) -> Vec<SearchHit>`
  - `index_project(project_id) -> IndexMeta`
  - `rebuild_index(project_id) -> IndexMeta`
  - `get_index_meta(project_id) -> Option<IndexMeta>`
  - `delete_index(project_id) -> ()`
- **Front-end integration:**
  - Add TanStack Query keys for `["project", projectId, "search", query]` (auto-cache and deduplicate).
  - Add TanStack Query key for `["project", projectId, "index-meta"]`.
- **Settings storage:** Re-use the existing settings mechanism (SQLite or local config) to persist the "automatic indexing" flag.

## 8. Success metrics

- A user can open the Files tab, type a known symbol, and find the correct file within **3 seconds**.
- Search results exclude every entry from `.gitignore` (verified with a test project containing a `node_modules` copy).
- Index rebuild completes without blocking the UI (user can still browse files while indexing runs).
- No measurable CPU spike when the app is idle (background scans are throttled and low-priority).

## 9. Open questions (clarify in planning or a short follow-up)

1. **Index location:** Should indices live next to the app database, or is a user-configurable path desired? _(Default: app data directory, non-configurable in v1.)_
2. **Language field:** Should the indexer try to detect file language (via extension) and store it for future filtering, or omit the field to keep v1 minimal? _(PRD: keep field in schema, optional usage in v1.)_
3. **Concurrent searches:** If a user types quickly, should the front end cancel the previous in-flight query (standard TanStack Query cancellation via AbortSignal) or let Tantivy handle it? _(Recommended: cancel via TanStack Query to avoid wasted work.)_

---

_Document generated per `/ai/create-prd.md`. Implementation should not start until this scope is agreed; adjust "Open questions" and re-export if the team prefers a different UI placement or indexing strategy._
