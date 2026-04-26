# Tasks: Monorepo detection and nested project discovery

Derived from [prd-monorepo-nested-project-detection.md](prd-monorepo-nested-project-detection.md).

## Relevant Files

- `src-tauri/src/discovery/walk.rs` — `collect_projects_under_root`, `filter_outermost_projects`, `MAX_DEPTH`, `should_skip_directory` / `skip_dir_name`; will host or call new monorepo merge logic.
- `src-tauri/src/discovery/detectors.rs` — `PackageJsonDetector` and how roots are identified (orthogonal to stack tags).
- `src-tauri/src/discovery/draft.rs` — `ProjectDraft` shape used for discovered projects.
- `src-tauri/src/discovery/registry.rs` — `DetectorRegistry::standard()`; candidate paths from workspace expansion must still be validated by detectors.
- `src-tauri/Cargo.toml` — New deps only if required (e.g. glob / serde helpers); prefer std + existing crates.
- `src-tauri/src/commands/scan.rs` — `scan_library_location`: pipeline from raw drafts through filter to upsert/prune; extend `ScanResultDto` if needed.
- `src-tauri/src/models.rs` — `ScanResultDto` and related types for new warning/counter fields.
- `src-tauri/src/lib.rs` — `mod` wiring if new `discovery` submodule files are added.
- `src-tauri/src/discovery/mod.rs` — Re-exports for new monorepo/workspace helpers.
- `src-tauri/src/discovery/workspace.rs` (new) — Optional home for: parse `package.json` `workspaces`, resolve globs, apply caps, produce member paths; or split `parse` vs `resolve` across small modules.
- `src-tauri/tests/` or `src-tauri/src/discovery/*_test.rs` / `src-tauri/src/discovery/.../fixtures/` — Unit tests and minimal directory fixtures (workspace root + `packages/*`).
- `src/services/tauri.ts` (or `invoke` wrappers) — Only if the front end must display new `ScanResultDto` fields; otherwise no change.
- `tasks/prd-monorepo-nested-project-detection.md` — Scope reference.
- `tasks/tasks-project-vault.md` — Optional line items after feature ships (per project convention).

### Notes

- Run Rust tests with `cargo test` from `src-tauri` (or the workspace root if configured). Add integration-style tests with temp dirs under `src-tauri/tests/` or `fixtures/` as the PRD suggests.
- Front end: `bun test` (Vitest) per `package.json` if you add any TS unit tests; this feature is mostly backend.
- Stakeholder defaults from PRD §9 / appendix: **strict** workspace list (A), **pnpm-workspace** as V1.1 (B) unless you explicitly promote it, cap **+ warning** when 200+ members (A), show root if detectors pass (A). Adjust tasks if product picks otherwise.

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, check it off by changing `- [ ]` to `- [x]`.

## Tasks

- [x] 1.0 Parse and validate `package.json` workspace manifests
  - [x] 1.1 Add a function to read and parse a root `package.json` and extract the `workspaces` field (array, or `{ "packages": [...] }` per npm docs), returning a list of **glob pattern strings** or an empty list.
  - [x] 1.2 Reject or ignore malformed JSON with a path-scoped, non-fatal result (log or warning counter) per PRD “non-blocking” error style.
  - [x] 1.3 Add unit tests for several shapes: `["packages/*"]`, nested object with `packages`, and missing `workspaces`.
  - [x] 1.4 (Optional / V1.1) Stub or feature-flag a second entry point for `pnpm-workspace.yaml` only if scope explicitly includes it in this release.

- [x] 2.0 Resolve workspace globs to directory paths (safe and bounded)
  - [x] 2.1 For a monorepo root path, resolve each pattern to **absolute** `PathBuf` directories that **exist** and look like project roots, using glob semantics consistent with npm (document library choice: `glob` crate or manual + `read_dir` where simple).
  - [x] 2.2 **Exclude** any match whose path is under `node_modules`, `dist`, or any path for which `should_skip_directory` / `skip_dir_name` would apply to a segment.
  - [x] 2.3 **Enforce** max depth and max **additional** members per root (e.g. 200) with ordered truncation; when truncated, set a result flag for warnings.
  - [x] 2.4 Deduplicate resolved paths (canonical / `path_key` style) before returning.
  - [x] 2.5 Unit tests for glob resolution with a tempdir fixture: two packages, one intentionally under `node_modules` (must not appear), one valid.

- [x] 3.0 Monorepo-aware deduplication (replace “outermost only” for workspace members)
  - [x] 3.1 Design `filter_monorepo_and_outermost` (or two-phase merge): from full `raw` drafts, **identify** which draft roots are monorepo roots (valid workspace manifest with resolvable members).
  - [x] 3.2 For each monorepo root, **not** remove child drafts that are **in** the resolved member set; still drop **non-listed** inner drafts per existing outermost rules **unless** a separate rule keeps them.
  - [x] 3.3 For locations **without** a workspace manifest, keep current `filter_outermost_projects` behavior unchanged.
  - [x] 3.4 Each **member path** that should become a project must be turned into a `ProjectDraft` by running the existing `DetectorRegistry` on that path (re-detect) or an equivalent that preserves `ProjectDto` shape as today.
  - [x] 3.5 **Include monorepo root** as a project if its path already produced a `ProjectDraft` in `raw` and detectors agree (PRD: root is not only a blank parent).
  - [x] 3.6 Unit tests: fixture “root + two packages” yields three drafts when root is a project, or two when root is not detected; “single package repo” still yields one project (regression test).

- [x] 4.0 Wire `scan_library_location` and extend scan results
  - [x] 4.1 Replace `let drafts = filter_outermost_projects(raw)` with the new pipeline and keep `path_key` / `HashSet` dedupe before upsert.
  - [x] 4.2 Extend `ScanResultDto` (or logs) to carry: **monorepos expanded** count, **warnings** (e.g. cap hit, glob parse error per root), in line with `dirs_skipped_errors` style—**must not** fail the full scan.
  - [x] 4.3 Update TypeScript DTOs if the front end serializes `ScanResultDto` anywhere.
  - [x] 4.4 Manually run a rescan on a real small monorepo and a non-monorepo to confirm DB rows and no duplicate paths.

- [x] 5.0 Performance, docs, and cleanup
  - [x] 5.1 Profile or time a representative large tree; ensure glob resolution runs **once per** monorepo root (not per file in walk) and document any intentional tradeoff.
  - [x] 5.2 Add short developer note (code comment in `walk.rs` or `workspace.rs` module doc) describing interaction between `filter_outermost_projects` and workspace members (PRD FR9).
  - [x] 5.3 Run `cargo fmt` / `clippy` on touched Rust; fix lints.
  - [x] 5.4 Optional: add a one-line entry to `tasks/tasks-project-vault.md` or changelog when done.

## Parent task map (for quick reference)

| ID  | Title                                |
| --- | ------------------------------------ |
| 0.0 | Feature branch                       |
| 1.0 | Parse `workspaces` in `package.json` |
| 2.0 | Resolve and cap workspace globs      |
| 3.0 | New dedupe + draft generation        |
| 4.0 | Scan command + DTO + integration     |
| 5.0 | Performance, documentation, quality  |
