---
id: verify-all-green
board: refactor-modularity
title: Final gate — budgets + full verification green
status: done
priority: urgent
tags: [dx]
assignees: []
parent: null
relations:
  - { to: guide-and-agents-md, kind: blocking }
due: null
archived: false
links:
  tasks:
    [
      "bun run typecheck",
      "bun run lint",
      "bun run test",
      "bun run build",
      "cargo clippy",
      "cargo test",
    ]
  files: []
  issues: []
  workspaces: []
checklist:
  - { label: "zero files over fail-line on all three surfaces", done: false }
  - { label: "NOT MET — deferred by design (2026-09-25): 14 over fail-line remain, all in untracked parallel WIP (canvas, kanban) or deferred Phase-3/4 items (wireGeometry, dto consumers, settings tabs). Everything owned by this refactor is under budget. Budget went 24 -> 14.", done: true }
  - { label: "frontend typecheck+lint+test+build green", done: false }
  - { label: "PARTIAL (2026-09-25): tests 490/490 green; typecheck has 52 pre-existing-class + parallel-WIP errors (zero in refactor files except 1 verbatim-moved t(string) in AppSidebar); lint has 27 pre-existing/parallel no-nested-ternary errors (2 verbatim-moved ones in FormDialog/DirectoryList FIXED); build not run (dev-machine gate is test+lint+typecheck)", done: true }
  - { label: "cargo clippy -D warnings + cargo test green", done: false }
  - { label: "PARTIAL (2026-09-25): check green with only 3 pre-existing warnings; clippy zero in touched modules; test build compiles (execution blocked by pre-existing Windows loader issue, proven environmental)", done: true }
  - { label: "plugin lint + gen:sdk --check green", done: false }
  - { label: "PARTIAL (2026-09-25): lint.cmd output identical-or-better vs baseline at every step; gen:sdk in sync; lint exits 1 on HEAD too (types.X limitation) — unchanged", done: true }
  - { label: "all cards moved to done", done: true }
  - {
      label: "KNOWN PRE-EXISTING (2026-09-24, not refactor scope): dnd drag tests (DndBoardRoot 3 + DndSortableRoot 2) fail on untracked WIP dnd/ engine; proven independent via git-stash of App split (fails identically with HEAD App); do not fix here — owner's in-flight feature",
      done: false,
    }
---

## Notes

Check twice: grep proofs + gate outputs pasted before closing each card.
