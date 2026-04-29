## Relevant Files

- `src-tauri/Cargo.toml` - Add `tantivy`, `ignore`, and `notify` dependencies.
- `src-tauri/src/search/mod.rs` - Core search module (indexer, query engine, schema).
- `src-tauri/src/search/index_manager.rs` - Manages per-project index lifecycle (create, open, delete, rebuild).
- `src-tauri/src/search/watcher.rs` - File-system watcher and incremental update queue for the active project.
- `src-tauri/src/search/background.rs` - Background periodic re-indexing task for non-active projects.
- `src-tauri/src/search/gitignore.rs` - Wrapper around `ignore` crate to compute effective skip rules.
- `src-tauri/src/commands/search.rs` - Tauri command handlers (`search_project`, `index_project`, `rebuild_index`, `get_index_meta`, `delete_index`).
- `src-tauri/src/models.rs` - Extend with `SearchHit`, `IndexMeta`, and related DTOs.
- `src-tauri/src/lib.rs` - Wire up search module and background tasks.
- `src-tauri/src/settings.rs` (or existing settings module) - Add `auto_index_projects` boolean.
- `src/services/tauri.ts` - Add TypeScript wrappers for new Tauri commands.
- `src/features/project-detail/FileTree.tsx` - Add search input, results panel, and metadata UI.
- `src/features/settings/components/GeneralSettingsTab.tsx` - Add "Automatically index discovered projects" toggle.
- `src/features/project-detail/components/ProjectMainTabs.tsx` - Minor adjustments to tab layout if needed.
- `src/messages/en.ts` (and `de.ts`) - New i18n strings for search UI and indexing actions.

### Notes

- Unit tests for Rust modules should live in inline `#[cfg(test)]` blocks or adjacent `tests/` directories where appropriate.
- Front-end tests are optional in v1 but can be added for the search UI components if desired.

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

## Tasks

- [ ] 1.0 Bootstrap Rust search infrastructure
  - [ ] 1.1 Add `tantivy`, `ignore`, and `notify` crates to `src-tauri/Cargo.toml` with compatible versions.
  - [ ] 1.2 Create `src-tauri/src/search/` directory and add `mod.rs` to expose the search submodules.
  - [ ] 1.3 Define the Tantivy schema in `search/mod.rs` with fields: `path` (text, indexed, stored), `content` (text, indexed with tokenization, stored), `language` (text, indexed, stored, optional).
  - [ ] 1.4 Create a helper function `index_dir_for_project(project_id: &str) -> PathBuf` that returns a consistent path under the app's data directory for storing Tantivy indices.
  - [ ] 1.5 Define custom error types or variants (e.g., `SearchError`) for indexing and query failures, aligned with the existing error handling style.
  - [ ] 1.6 Register the new `search` module in `src-tauri/src/lib.rs`.

- [ ] 2.0 Implement project indexing engine
  - [ ] 2.1 Create `src-tauri/src/search/gitignore.rs` that uses the `ignore` crate to build a `WalkBuilder` respecting all nested `.gitignore` files.
  - [ ] 2.2 Add a hardcoded safety skip list (`.git`, `node_modules`, `target`, `dist`, etc.) applied regardless of `.gitignore` presence.
  - [ ] 2.3 Implement binary file detection using the existing heuristic (null-byte check or >10 non-printable chars in first 1KB); skip binary files during indexing.
  - [ ] 2.4 Implement a `single_file_index` function in `search/mod.rs` that reads a file, creates a Tantivy document, and adds/updates it in the index writer.
  - [ ] 2.5 Implement a `full_project_index` function that walks the project tree, filters via gitignore + hardcoded skips, skips files >1MB, and indexes all valid files.
  - [ ] 2.6 Implement `delete_project_index` and `rebuild_project_index` functions that remove or recreate the index directory.
  - [ ] 2.7 Write inline Rust unit tests for gitignore filtering, binary detection, and document creation.

- [ ] 3.0 Implement query engine and Tauri commands
  - [ ] 3.1 Add `SearchHit` and `IndexMeta` structs to `src-tauri/src/models.rs` (or a new `search/models.rs`) with `Serialize` derive for Tauri.
  - [ ] 3.2 Implement a query builder that supports:
    - Plain keyword/token queries (default OR behavior)
    - Exact phrase queries when wrapped in double quotes (`"error handler"`)
    - Fuzzy term queries with edit distance `2` for single tokens
  - [ ] 3.3 Implement `search_project(project_id, query) -> Result<Vec<SearchHit>, SearchError>` that parses the query, executes it, and collects results with file path and line numbers.
  - [ ] 3.4 Implement `index_project(project_id) -> Result<IndexMeta, SearchError>` that triggers a full project index and returns metadata.
  - [ ] 3.5 Implement `rebuild_index(project_id) -> Result<IndexMeta, SearchError>` that drops and re-creates the index.
  - [ ] 3.6 Implement `get_index_meta(project_id) -> Result<Option<IndexMeta>, SearchError>` that checks if an index exists and returns file count, disk size, and last updated timestamp.
  - [ ] 3.7 Implement `delete_index(project_id) -> Result<(), SearchError>`.
  - [ ] 3.8 Create `src-tauri/src/commands/search.rs`, wrap the above functions as `#[tauri::command]` handlers, and register them in `lib.rs`.

- [ ] 4.0 Implement automatic index updates (watcher + background)
  - [ ] 4.1 Create `src-tauri/src/search/watcher.rs` that sets up a `notify` file-system watcher on the active project's root path.
  - [ ] 4.2 Implement debounced event handling: on `Create`/`Modify`/`Remove`, enqueue a lightweight job to re-index or delete the affected file(s).
  - [ ] 4.3 Create `src-tauri/src/search/background.rs` with a Tokio background task that sleeps for a configurable interval (default 15 minutes) and performs a delta re-scan for all indexed projects.
  - [ ] 4.4 Implement delta detection in the background task: compare file mtime against index timestamps and only re-index changed files.
  - [ ] 4.5 Add cancellation and throttling mechanisms so the background task can be shut down cleanly and never spikes CPU.
  - [ ] 4.6 Wire up active project tracking in the backend so the watcher starts/stops when the user switches projects in the Files tab.
  - [ ] 4.7 Add a startup routine in `lib.rs` that resumes the background scanner if indices already exist.

- [ ] 5.0 Build front-end search UI in Files tab
  - [ ] 5.1 Add a search input field at the top of `FileTree.tsx` with a debounce of ~200 ms.
  - [ ] 5.2 Create a `SearchResultsPanel` component (inline or new file) that receives `SearchHit[]` and renders file paths, line numbers, and code snippets.
  - [ ] 5.3 Integrate TanStack Query: use a query key `["project", projectId, "search", query]` for search results with cancellation support.
  - [ ] 5.4 Implement click handling on search results: open the file in the existing `FilePreview` pane and scroll to the first matched line.
  - [ ] 5.5 Add loading state (spinner) while a search query is in flight.
  - [ ] 5.6 Add empty state when no results are found.
  - [ ] 5.7 Add a clear-search button that resets the view to the normal file preview pane.
  - [ ] 5.8 Ensure the file tree sidebar remains visible during search; results occupy the preview area.

- [ ] 6.0 Add settings toggle and manual indexing controls
  - [ ] 6.1 Extend the app's settings storage (SQLite or local config) with a boolean `auto_index_projects`; default to `true`.
  - [ ] 6.2 Add a toggle in `GeneralSettingsTab.tsx` labeled "Automatically index discovered projects" bound to the new setting.
  - [ ] 6.3 In `FileTree.tsx`, query index metadata via TanStack Query key `["project", projectId, "index-meta"]`.
  - [ ] 6.4 When automatic indexing is **disabled** and no index exists, show an "Index this project" button that calls `index_project`.
  - [ ] 6.5 When an index exists, display metadata: indexed file count, index size on disk (human-readable), and last updated timestamp.
  - [ ] 6.6 Add a "Rebuild index" button next to the metadata that calls `rebuild_index`.
  - [ ] 6.7 Show indexing progress/busy state while an index operation is running.

- [ ] 7.0 Integration, testing, and polish
  - [ ] 7.1 Add all new UI strings to `src/messages/en.ts` and `src/messages/de.ts` (placeholders for other locales).
  - [ ] 7.2 Run a manual end-to-end test: open a project, type a known symbol, verify results appear within 3 seconds.
  - [ ] 7.3 Verify `.gitignore` exclusions: create a test project with a `node_modules` copy and confirm no results from ignored paths.
  - [ ] 7.4 Verify watcher behavior: edit a file in the active project and confirm the change is reflected in search within seconds.
  - [ ] 7.5 Verify background scan: wait for the periodic interval (or temporarily shorten it) and confirm stale indexes are refreshed.
  - [ ] 7.6 Run `cargo check` and `cargo clippy` on the Rust code; fix any warnings.
  - [ ] 7.7 Run the TypeScript build and linter; fix any issues.
  - [ ] 7.8 Write inline Rust unit tests for critical paths (gitignore filtering, query parsing, binary detection).
  - [ ] 7.9 Review and clean up debug logs, TODO comments, and unused imports.
  - [ ] 7.10 Update `AGENTS.md` or relevant docs with notes about the new search dependencies and index storage location.
