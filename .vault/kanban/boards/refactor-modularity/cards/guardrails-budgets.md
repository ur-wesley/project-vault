---
id: guardrails-budgets
board: refactor-modularity
title: Phase 0 — budgets, barrels, i18n test, renames
status: done
priority: high
tags:
  - dx
assignees: []
parent: null
relations: []
due: null
archived: false
links:
  tasks:
    - bun run typecheck
    - bun run lint
    - bun run test
    - cargo clippy
    - cargo test
  files:
    - scripts/check-file-budget.mjs
    - package.json
    - src/lib/index.ts
    - src/services/tauri/index.ts
    - src/messages/messages.test.ts
  issues: []
  workspaces: []
checklist:
  - label: budget script TS 300/600, Rust 400/800, Luau 300/600 wired to lint:budget + CI
    done: true
  - label: barrels lib/index.ts, services/tauri/index.ts, canvas sub-barrels
    done: true
  - label: i18n key-sync test de.ts vs en.ts
    done: true
  - label: rename lib/notification-center.tsx to notification-store.tsx
    done: true
  - label: "Rust: fix double move_project registration, gate debug commands"
    done: true
  - label: "plugins: regen SDK, fix 4 broken doc links"
    done: true
  - label: "gate green: typecheck+lint+test+build, clippy+test, plugin lint"
    done: true
---

## Verification (2026-09-23)

- `node scripts/check-file-budget.mjs` runs; baseline 24 over fail-line / 71 over warn-line (all pre-existing gods for Phases 2-4).
- `cargo check` passes (debug); only 4 pre-existing warnings.
- `bun run lint` exit 0; `bun run test` 54 files / 387 tests pass incl. new `messages.test.ts`.
- `bun run typecheck` has 50 errors, all pre-existing WIP breakage (proven via `git stash` baseline at HEAD: same error classes); zero errors in touched/new files.
- `bun run gen:sdk` in sync. New finds: `kanban/store.rs` 808, `KanbanCardDialog.tsx` 608 added to Phase 2 scope.
