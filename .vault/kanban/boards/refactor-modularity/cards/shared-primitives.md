---
id: shared-primitives
board: refactor-modularity
title: Phase 1 — shared helpers FE/BE/plugins
status: done
priority: high
tags:
  - frontend
  - backend
  - plugins
assignees: []
parent: null
relations:
  - to: guardrails-budgets
    kind: blocking
due: null
archived: false
links:
  tasks:
    - bun run typecheck
    - bun run lint
    - cargo clippy
  files:
    - src/lib/open-external.ts
    - src/lib/path-utils.ts
    - src/components/DialogShell.tsx
    - src/components/CopyButton.tsx
    - src-tauri/src/common/
    - pv-plugins/shared/
  issues: []
  workspaces: []
checklist:
  - label: "FE: open-external, path-utils, stableErrorMessage unify, formatRelativeTime, DialogShell, CopyButton, fuzzy/color folds"
    done: false
  - label: "FE done: open-external (5->1), path-utils (3->1), unknownErrorMessage (lib), normalizeHexColor (lib/color), DialogShell + Input dialog migrated, CopyButton + 2 header buttons migrated"
    done: true
  - label: "FE intentionally kept: fuzzyMatch (different null-contract + arg order vs fuzzyScore), relativeTime adapter (not a dupe), header 1-arg formatRelativeTime (pre-existing WIP breakage)"
    done: true
  - label: "BE: common/{app_dirs,shell_pref,sh_quote,emit,db_row}.rs adopted"
    done: true
  - label: "BE done: common.rs (app_data_dir, resolve_shell_pref, sh_single_quote) + emit_task_snapshot in task_monitor/db_events; 10 consumer files; row_to_dto NOT merged (same name, different types — good convention); plugin:reload 1-liners left (helper saves nothing); lua postgres app_data_dir left (different fallback contract)"
    done: true
  - label: "plugins: shared/{i18n,basename,footer,telescope-picker}.luau adopted"
    done: true
  - label: "plugins done: vault.luau synced from SDK (45 vs 46 lint errors, fixed duplicate show_form); translate stays per-plugin (documented lib/ pattern); basename 3-liners stay colocated; footer UIs custom; telescope flow deferred to Phase 2c"
    done: true
  - label: grep single-definition proofs + gates green
    done: true
---

## Verification (2026-09-23, FE part)

- `rg function openExternal` -> 1 def (`lib/open-external.ts`), 5 consumers.
- `rg (joinPathSync|parentDirOf|getRelativePath)` defs -> 1 module (`lib/path-utils.ts`), 3 consumers.
- `invokeErrorMessage` -> 0 hits; `unknownErrorMessage` in `lib/invoke-error.ts`, 5 call sites.
- `normalizeHexColor` -> `lib/color.ts` (was single-use; moved for Phase 2 config-form split).
- `bun run test` 59 files / 412 tests green (2 consecutive runs). Note: suite grew 54->59 files across runs; disk shows 59 test files (some untracked WIP), suite consistent with disk.
- `bun run lint` exit 0; no new warnings in touched files.
- `bun run typecheck`: zero errors in touched/new files (CopyButton JSX import fixed); remaining errors pre-existing WIP breakage incl. header AlertDialog/Dialog/Checkbox unused + 1-arg formatRelativeTime.
- `cargo check` (Phase 0) passed; Rust BE helpers + Luau shared/ still open.

## Verification (2026-09-24, BE part)

- `rg fn app_data_dir|resolve_shell_pref|sh_single_quote|emit_task_snapshot` -> 1 def each (`common.rs`, `db_events.rs`); 10 consumer files.
- `cargo check` green; warnings back to the 5 pre-existing (screenshot x2, workspaces monitors, dokploy dead fns x2). Fixed own fallout: `&app` at 10 owned-handle sites, removed orphaned `Manager` imports.
- `cargo test --lib --no-run` builds clean; `cargo test --lib` execution fails with STATUS_ENTRYPOINT_NOT_FOUND at process start (Windows loader/DLL env issue, pre-existing — no test code runs).

## Verification (2026-09-24, Luau part)

- `pv-plugins/vault.luau` synced from `src-tauri/lua-sdk/vault.luau` (types-only IDE snapshot the app regenerates on launch).
- `lint.cmd` before: 46 lines incl. `vault.luau duplicate show_form`; after: 45 lines, all pre-existing `types.X` errors in git-hygiene/postgres (type-only, runtime-erased; Phase 2c material). Zero new errors.
- No `shared/` dir created: relative requires are plugin-scoped per loader + docs (`lib/` pattern) — cross-plugin sharing lives in the telescope library / vendor externals.
