> **SUPERSEDED** by the full-repo refactor tracked on board `refactor-modularity` (.vault/kanban/boards/refactor-modularity/) + docs/BEST_PRACTICES.md. Kept for history.

# PRD: Frontend Modularity, DX & De-duplication

## Introduction/Overview

The frontend (`src/`, 396 files, ~57.5k lines, avg ~145 lines/file) has 10 files over 600 lines and a long tail of 250–500 line components. The top file (`PluginDashboard.tsx`, ~1876 lines) holds ~7 responsibilities; `App.tsx` (~1178 lines) holds ~10. Duplicated helpers (`openExternal`, `invokeErrorMessage` vs `stableErrorMessage`, `joinPathSync/getRelativePath`, `formatRelativeTime` wrappers, inline `fuzzyMatch`), a triple home for canvas geometry (`canvas/geometry/` vs `canvas/layout/` vs `canvas/components/nodes/whiteboard/`), a split node registry (`canvas/nodes/` vs `canvas/components/nodes/`), 5+ copy-pasted dialog shells, a god DTO module (`src/types/dto.ts`, ~589 lines / ~50 types), and a god Tauri service (`services/tauri/dokploy.ts`, 15KB) next to ~10 single-call wrappers slow down development and review. `src/lib/` (46 files) and `src/services/tauri/` (29 files) have no barrels, forcing deep imports.

This PRD scopes a **structural refactor, no behavior change**: split god files by responsibility, extract each duplicate once, consolidate canvas taxonomy, slice the DTO/service gods by domain, and enforce a soft file budget (warn >300, fail >600) so the codebase stays modular.

## Goals

1. No file over 600 lines; new/edited files warn over 300 lines (CI budget check).
2. One responsibility per file: components render, hooks own state/effects, `lib/` owns pure helpers, `services/tauri/` owns invoke wrappers only.
3. Each duplication in §2 exists exactly once (`open-external`, `path-utils`, unified error helper, single `formatRelativeTime`, `DialogShell`/`CopyButton`, `fuzzy-score`).
4. Canvas has one home per concept: `layout/` for placement/routing, `nodes/` for node UI+registry, no parallel `geometry/` vs `layout/` vs `whiteboard/` split.
5. `dto.ts` sliced by domain with a re-export barrel during migration; `dokploy.ts` moved to `features/dokploy/`.
6. DX: barrels for `lib`, `services/tauri`, canvas sub-trees; i18n key-sync test; one documented store/dialog/error convention.

## User Stories

1. As a developer, I can open any feature file and see one responsibility within ~300 lines, so I can review it in one sitting.
2. As a developer, I import shared UI/helpers from `@/lib`, `@/components`, `@/services/tauri` barrels instead of memorizing deep paths.
3. As a developer, I add a new dialog by composing `DialogShell` instead of copy-pasting `DialogContent/Header/Footer`.
4. As a developer, CI tells me when a file crosses 300/600 lines so splits happen incrementally.

## Functional Requirements

1. **Budgets:** CI script warns >300 lines, fails >600 lines on `src/**/*.{ts,tsx}` (excluding generated + `messages/` — those get a key-sync test instead).
2. **Shared primitives:** new `lib/open-external.ts`, `lib/path-utils.ts`, unified `stableErrorMessage`, single `formatRelativeTime`, `components/DialogShell.tsx`, `components/CopyButton.tsx`, `fuzzyMatch` folded into existing `lib/fuzzy-score.ts`.
3. **God splits (no logic change):** `PluginDashboard`, `App`, `PluginUiBridge`, `ProjectDetailHeader`, `FileTree`, `WhiteboardNode`, `DokployNode`, `FilePreview` split per target trees in `tasks-frontend-modularity.md`. Public import paths kept stable via barrel re-exports.
4. **Canvas consolidation:** merge `canvas/geometry/` → `canvas/layout/`; split `wireGeometry.ts` into `wire-ports/avodance/path/sample`; split `whiteboard/geometry.ts` into `bounds/hit-test/resize/polyline/connectors` with barrel; unify `nodes/` vs `components/nodes/`; merge micro-stores (`linking/wiresStore/manualWires/persistence`); merge `flyout/openCanvasWindow+windowSync`; resolve `blueprints/detector.ts` vs `detectors.ts` duality (delete one path).
5. **Services/types:** slice `dto.ts` by domain (`Canvas*`, `ProjectCleaner*`, `GitHubDevice*`, `Mise*`, `Clipboard*`); move `dokploy.ts` (+test) to `features/dokploy/`; fold trivial single-call Tauri wrappers into callers or `core.ts`.
6. **DX:** barrels `lib/index.ts`, `services/tauri/index.ts`, canvas sub-barrels; `lib/plugin-*.ts` → `lib/plugin/` folder; rename `lib/notification-center.tsx` → `lib/notification-store.tsx`; i18n sync test for `de.ts`/`en.ts`.

## Non-Goals

- No UX, visual, routing, or API behavior change. No new features, no new generic framework (no plugin engine, no form engine beyond `DialogShell`).
- No backend (`src-tauri/`) logic change except DTO moves mirrored 1:1.
- No state-library migration (no Solid → Zustand etc.). Standardize usage of what exists.
- No test-framework or bundler changes.

## Technical Considerations

- Stack: SolidJS + Tauri v2 + TanStack Router/Query + Bun. Path alias `~/*` → `./src/*` already exists — barrels build on it.
- Verification per PR: `bun run typecheck && bun run lint && bun run test && bun run build`. Keep PRs to one god-file split each.
- Techniques: extract-hook (signals/memos/effects move verbatim), extract-component (JSX + minimal props), barrel re-export (old path keeps working for one phase), fold-into-caller for YAGNI wrappers.
- Risks: over-splitting into sub-KB micro-modules (mitigation: merge, don't atomize — see YAGNI list); import churn (mitigation: barrels + alias updates in same PR); i18n drift (mitigation: sync test before any message edit).

## Success Metrics

- Zero files >600 lines in `src/` (excluding `messages/`); median new/edited file ≤300 lines.
- `rg "function openExternal|const openExternal"` → 1 definition; `rg "invokeErrorMessage"` → 0 local definitions; `rg "joinPathSync|getRelativePath"` definitions → 1 module.
- `canvas/geometry/` no longer exists; `blueprints/detector.ts` XOR `detectors.ts` registry remains.
- `dto.ts` is a ≤50-line re-export barrel; `dokploy.ts` lives under `features/dokploy/`.
- Clean `typecheck + lint + test + build` after every phase.

## Open Questions

- [x] Scope: structural full (decided) — not incremental-only.
- [x] Budget: warn at 300 (decided) — fail at 600.
- Which blueprint path dies (`detector.ts` legacy vs `detectors.ts` registry)? Decide in Phase 3 after checking `useCanvasState.ts:74` + `blueprints/index.ts:35,42` callers.
- Which global-store pattern is canonical (context vs store)? Decide in Phase 5 (`event-hub-context` vs `global-terminal-store` vs `live-playtime-context`).
