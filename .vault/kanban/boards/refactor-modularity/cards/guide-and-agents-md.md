---
id: guide-and-agents-md
board: refactor-modularity
title: Phase 5 — BEST_PRACTICES.md + AGENTS.md + v2 tasks
status: done
priority: medium
tags:
  - guide
  - dx
assignees: []
parent: null
relations:
  - to: slice-services-types
    kind: blocking
due: null
archived: false
links:
  tasks: []
  files:
    - docs/BEST_PRACTICES.md
    - AGENTS.md
    - tasks/prd-fullrepo-modularity.md
    - tasks/tasks-fullrepo-modularity.md
  issues: []
  workspaces: []
checklist:
  - label: docs/BEST_PRACTICES.md ~150 lines with good/bad snippets per surface
    done: true
  - label: root AGENTS.md ~60 lines strict rules + budgets + gates
    done: true
  - label: v2 prd/tasks written, old frontend-only files marked superseded
    done: true
  - label: store pattern standardized + documented
    done: true
  - label: "done (2026-09-25): AGENTS.md extended (budgets, modularity, no-dupe, Luau constraints, verification); BEST_PRACTICES.md written (7 sections); tasks/*modularity.md marked SUPERSEDED (board is live plan, no v2 files needed); store pattern documented in guide §1"
    done: true
---

## Notes

AGENTS.md links BEST_PRACTICES, stack-guide, plugin docs. Strict = machine-checkable.
