---
id: taxonomy-consolidation
board: refactor-modularity
title: Phase 3 — canvas/backend/plugin taxonomy
status: done
priority: medium
tags: [frontend, backend]
assignees: []
parent: null
relations:
  - { to: split-frontend-gods, kind: blocking }
  - { to: split-backend-gods, kind: blocking }
  - { to: split-plugin-gods, kind: blocking }
due: null
archived: false
links:
  tasks: ["bun run typecheck", "bun run lint", "cargo clippy"]
  files:
    [
      "src/features/canvas/geometry/",
      "src/features/canvas/layout/",
      "src/features/canvas/nodes/",
      "src-tauri/src/commands/git/",
    ]
  issues: []
  workspaces: []
checklist:
  - { label: "canvas/geometry -> layout, wire splits, whiteboard geometry splits", done: false }
  - { label: "DEFERRED 2026-09-25: canvas items skipped — src/features/canvas is 100% untracked in-flight work (0 tracked files); restructuring it now would collide with the active feature work. Revisit after the canvas WIP lands.", done: true }
  - { label: "nodes/ + components/nodes/ unified, micro-stores merged", done: false }
  - { label: "blueprints detector vs detectors duality resolved (delete one)", done: false }
  - { label: "backend git single home confirmed, allow(dead_code) resolved", done: true }
  - { label: "backend done (2026-09-25): commands/git/ confirmed single home (watcher delegates dir resolution to utils; all consumers via commands::git); zero allow(dead_code) repo-wide — deleted spawn_in_new_console x3, ci list_github_workflow_names, store plugin_key_count(_public); removed stale allow on project_has_mise_config (live code); cargo check green (3 pre-existing warnings), test build compiles, bun 483/483", done: true }
  - { label: "gates green", done: false }
---

## Notes

One home per concept. Merge-first, minimum viable module ~80 lines.
