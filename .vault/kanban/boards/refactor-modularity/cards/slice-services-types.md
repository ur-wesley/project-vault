---
id: slice-services-types
board: refactor-modularity
title: Phase 4 — dto/models slicing + wrapper folds
status: done
priority: medium
tags:
  - frontend
  - backend
assignees: []
parent: null
relations:
  - to: taxonomy-consolidation
    kind: blocking
due: null
archived: false
links:
  tasks:
    - bun run typecheck
    - cargo clippy
    - cargo test
  files:
    - src/types/dto.ts
    - src-tauri/src/models.rs
    - src/services/tauri/
  issues: []
  workspaces: []
checklist:
  - label: dto.ts + models.rs sliced by domain in lockstep, barrels kept one phase
    done: true
  - label: "dto slice (2026-09-25): dto.ts 660 -> 15-line barrel + 15 domain files (largest 96); fixed pre-existing GitFileDiffDto duplication (identical defs, canonical in git.ts); typecheck zero"
    done: true
  - label: "models slice (2026-09-25): models.rs 554 -> models/{12 files, largest 143} + barrel; all crate::models::* paths preserved (~60 consumers untouched); check green, clippy clean, test build compiles"
    done: true
  - label: dokploy service moved to features/dokploy + backend dokploy/ modules
    done: true
  - label: "dokploy move (2026-09-25): services/tauri/dokploy.ts 481 -> features/dokploy/ (+test); shim keeps 7 consumers + barrel working; typecheck zero"
    done: true
  - label: one-call wrappers folded, compat shims deleted with proof
    done: true
  - label: "wrappers verdict (2026-09-25): all 10 small services have 2+ importers — folding would scatter, keeping is correct; RETIRED_* + migrate_legacy_meta both live, kept intentionally"
    done: true
  - label: dto.ts <=50 lines barrel, no orphan one-call modules
    done: true
  - label: "plugin lib folder (2026-09-25): 8 plugin-* modules + 2 tests -> lib/plugin/ + barrel; 14 importers repointed; typecheck zero except baseline; bun 490/490"
    done: true
---

## Notes

Frontend dto.ts and backend models.rs change 1:1. Grep + build proof for every deletion.
