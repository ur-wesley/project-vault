# PRD: Monorepo detection and nested project discovery

## 1. Introduction / Overview

**Problem:** When a library path contains a **monorepo** (e.g. npm/pnpm/yarn workspaces, or similar), the app currently walks subfolders and may detect many valid project roots (e.g. `package.json` in each `packages/*`), but **`filter_outermost_projects` then keeps only the outermost match** and **drops** deeper projects. Users expect **each workspace package (or other nested roots)** to appear as its own project in the library, with predictable behavior and performance.

**Goal:** Introduce **monorepo-aware discovery** so that **nested projects that belong to a defined workspace (or equivalent)** are **found, deduplicated, and stored** as separate projects, while **accidental** nested noise (e.g. examples inside `node_modules` remains skipped by existing rules) does not flood the database.

**Default assumptions (confirm in §9):** The first version focuses on **JavaScript/TypeScript monorepos** using **`package.json` `workspaces`** (and optional `pnpm-workspace.yaml` / Lerna / Turborepo / Nx markers). Other ecosystems (Go workspaces, Rust `Cargo` workspace) are out of scope for V1 unless listed otherwise.

---

## 2. Goals

1. **Surface nested projects:** Library scan results include **separate** projects for the monorepo root (if it is itself a project) and for **declared** nested packages, when the scanner can prove they are part of a workspace.
2. **Stay safe:** Do not register every random nested `package.json`—only paths that are **listed** in a workspace config or follow **documented** layout rules with clear caps (depth, count).
3. **Preserve performance:** Scan time and memory stay acceptable on large `node_modules`-heavy trees (reuse existing **skip** lists and add workspace-specific short-circuits where useful).
4. **Observable behavior:** Scans report how many monorepos were expanded and, in debug or logs, which roots were added as workspace members.
5. **Backwards compatible:** Single-package repos and **non-workspace** nested folders **behave** as today (outermost-only) unless a workspace manifest applies.

---

## 3. User stories

1. As a **developer with a pnpm monorepo**, I add my repo root as a library location; after scan, I see **each package** I care about as its own project so I can open it in an IDE, run tasks, and view metadata **per package**.
2. As a **maintainer of a small monorepo**, I want the **root** to remain a project if it has scripts/meta, and **sub-packages** to appear **without** duplicating the same path under two incompatible rules.
3. As a **user**, I do not want **hundreds** of spurious projects from `packages/` that are not in `workspaces` or from **vendor** trees.
4. As a **user migrating from the current app**, I want a **rescan** to **add** nested workspace projects that were previously hidden, without manual re-import of each folder.

---

## 4. Functional requirements

1. The system must **parse workspace membership** for at least: **`package.json` `workspaces` field** (array or `{ packages: [...] }` / glob support per npm docs).
2. The system must **resolve** declared workspace **globs** to **absolute** directory paths under the monorepo root, ignoring matches under `node_modules`, `dist`, and existing **`skip_dir_name`** / **`should_skip_directory`** rules.
3. The system must **treat a directory as a monorepo root** when a supported workspace manifest is present and valid enough to list members (exact definition of “valid” in implementation notes: **non-empty** member list or successful glob resolution).
4. The system must **change deduplication logic** for scans: when a monorepo root is identified, the system must **not** apply the current **“outermost only”** rule in a way that **drops** listed workspace package directories that are **children** of that root; it must **retain** `ProjectDraft` entries for each **resolved** member path that **passes** existing `ProjectDetector` rules.
5. The system must **deduplicate** by **canonical project path** (existing `path_key` behavior) so the same path is not inserted twice.
6. The system must **enforce a maximum** count of **additional** nested projects per monorepo root (configurable constant, e.g. 200) to avoid abuse; if exceeded, the scan must **record** a warning in scan results (extend `ScanResultDto` or logs) and **not** fail the whole scan.
7. The system must **enforce a maximum depth** for workspace resolution consistent with or stricter than existing **`MAX_DEPTH`** in the walker.
8. The application must **include** the monorepo root in the project list **if** it is itself detectable as a project (e.g. root `package.json` passes the existing `PackageJsonDetector`); the application must **not** require the root to be a “blank” parent only.
9. The system must **document** in developer-facing notes: interaction between **workspace list** and **outermost filter** (e.g. `filter_outermost_projects` is **replaced or bypassed** for paths that are **explicit** workspace members).
10. Optional for V1.1: Support **`pnpm-workspace.yaml`** `packages` globs\*\* when `package.json` workspaces is absent.
11. Optional for V1.1: Read **Turborepo** / **Nx** project graph files **only** if they can be parsed safely without full JS execution; otherwise defer to workspace globs only.

---

## 5. Non-goals (out of scope)

1. **Submodules / git** detection as first-class (clone strategy, `.gitmodules`).
2. **Arbitrary** nested projects **without** a workspace (or V1 heuristics): e.g. “any folder with `package.json` 3 levels down” is **out** unless added as a follow-up with product approval.
3. **UI** for toggling “show nested” per location (may be a later story); V1 is **scan behavior** + DB contents.
4. **Cross-location** monorepos (one package on `D:\` and another on `E:\`) with a **single** workspace file—**out** of scope.
5. **Real-time** file watching for workspace file changes; **full rescan** remains the main refresh mechanism.

---

## 6. Design considerations (UI/UX)

1. **Library list** may grow; ensure **search/filter** (existing) remains usable; no mandatory UI change in V1.
2. If product adds a badge, prefer **“Workspace”** or **“monorepo”** on the root project in a follow-up; **not** required for V1.
3. **Error messaging:** If a workspace glob fails to parse, show a **non-blocking** path-level warning in scan output rather than failing the entire location scan (align with `dirs_skipped_errors` style).

---

## 7. Technical considerations

1. **Current flow:** `collect_projects_under_root` returns **all** `ProjectDraft` matches; **`filter_outermost_projects` in `src-tauri/src/discovery/walk.rs`** removes **nested** drafts. Monorepo work likely requires **a new function** (e.g. `filter_monorepo_and_outermost` or a two-phase **merge**): classify drafts whose roots have **workspace manifests**, expand members, then filter.
2. **Registry:** Reuse `DetectorRegistry::standard()`; workspace expansion may produce paths that are **only** valid via `package.json` at `packages/foo` without a parent re-detection pass—ensure each candidate path is still **detected** or explicitly **upserted** with the same `ProjectDto` shape.
3. **DB:** `upsert_project` and prune-by-paths remain; **`keep` set** in `scan_library_location` must include **all** final paths. Pruning still removes projects **removed** from disk or no longer in the resolved set.
4. **Tests:** Add unit tests for **workspace glob resolution** and for **“root + two packages”** vs **“outermost-only legacy”** behavior on fixture directories in `src-tauri` (or `fixtures/`).
5. **Performance:** Resolve globs **once per monorepo root**; avoid re-walking the whole tree for each member if possible (reuse `walkdir` or batch).

---

## 8. Success metrics

1. On a **sample pnpm** and **npm workspaces** repo fixture, a scan produces **N + 1** projects (root + N members) or **N** if root is not a project—**matching** the workspace definition.
2. **Zero** duplicate rows for the same **canonical** path in SQLite after a scan.
3. **Rescan** on a **non-monorepo** project shows **no regression** in project count.
4. Scan completes in **< 2×** the time of the same tree **without** monorepo expansion on a **reference** dev machine (tune in implementation; document if slower with justification).

---

## 9. Open questions (stakeholder confirmation)

1. **Root vs packages only:** Should the monorepo **root** always be a project if it has `package.json`, or should V1 only register **package folders** and skip a “metapackage” root?
   - _Suggested default:_ Register root **if** it passes existing detectors; otherwise register only members.
2. **Tooling beyond npm workspaces in V1:** Is **`pnpm-workspace.yaml`** required in V1 or acceptable as V1.1?
   - _Suggested default:_ V1.1 unless many users use pnpm-only layout without `package.json` workspaces.
3. **Cap numbers:** Is **200** nested projects per root acceptable, or should it be **50**?
4. **Gitignored paths:** Should workspace globs that resolve into **.gitignore**d directories be **excluded**?
   - _Suggested default:_ Follow existing “skip” dirs; do not add full `git` parsing in V1.
5. **Clarification from process (`ai/create-prd.md`):** Confirm **A** or **B** for product:
   - **A.** Nested projects appear **only** when listed in a workspace manifest (strict).
   - **B.** Also allow a **heuristic** (e.g. `packages/*` with root `workspaces: ["packages/*"]` implicit)—usually **A** is satisfied by reading the manifest, not an extra heuristic.

---

## Appendix: References in codebase

- `src-tauri/src/discovery/walk.rs` — `collect_projects_under_root`, `filter_outermost_projects`, `MAX_DEPTH`, `should_skip_directory`
- `src-tauri/src/commands/scan.rs` — `scan_library_location`, `upsert`, prune
- `src-tauri/src/discovery/detectors.rs` — `PackageJsonDetector` and stack tagging (orthogonal but relevant for per-package `stack`)

---

## Stakeholder prompt (per `ai/create-prd.md`)

If you want to lock scope before implementation, reply with selections, e.g. `1A, 2B, 3A`:

1. Primary outcome for v1?  
   **A.** Only workspace-listed nested packages (strict)  
   **B.** Strict + heuristics for `packages/*` when manifest is empty  
   **C.** Defer; spike first
2. Include `pnpm-workspace.yaml` in v1?  
   **A.** Yes  
   **B.** No (follow-up)
3. When workspace has 200+ packages?  
   **A.** Cap + warning  
   **B.** Fail the location scan  
   **C.** No cap (not recommended)
4. Show monorepo root in the list?  
   **A.** Yes, if it passes detectors  
   **B.** Only leaf packages
