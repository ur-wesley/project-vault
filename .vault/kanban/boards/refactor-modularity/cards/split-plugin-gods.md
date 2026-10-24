---
id: split-plugin-gods
board: refactor-modularity
title: Phase 2c — split plugin gods + telescope dedupe
status: done
priority: high
tags: [plugins]
assignees: []
parent: null
relations:
  - { to: shared-primitives, kind: blocking }
due: null
archived: false
links:
  tasks: ["bun run gen:sdk"]
  files:
    [
      "pv-plugins/postgres/init.luau",
      "pv-plugins/postgres/dialogs.luau",
      "pv-plugins/git/init.luau",
      "pv-plugins/harpoon/init.luau",
      "pv-plugins/shared/telescope-picker.luau",
    ]
  issues: []
  workspaces: []
checklist:
  - {
      label: "postgres/init.luau 1316 -> init 168 + mods 113 + home 341 + commands router 41 + commands_{servers 186, versions 101, clusters ~270, databases ~250}; home/commands loaded lazily inside plugin.execute (metadata-safety preserved); shared pickers exported via commands_servers return; branch returns converted to return true (router contract); luau-analyze clean on all 8 files; lint.cmd output byte-identical to baseline; budget FAIL entries for postgres plugin gone; bun tests 467/467",
      done: true,
    }
  - {
      label: "postgres/dialogs.luau 535 -> dialogs facade 28 + dialogs_pick 98 + dialogs_forms 389 + dialogs_confirm 66; facade keeps require('./dialogs') working; lint.cmd extended with all new postgres files; remaining types.X analyzer hits are the repo-wide pre-existing require-resolution limitation (lint exits 1 on HEAD too); bun tests 467/467",
      done: true,
    }
  - {
      label: "git/init.luau 728 -> init 165 (types/table/delegation) + git/commands.luau router + sync.refresh_ui; wired into the existing-but-unwired sibling flows (branches/commits/footer/header/projects/settings/decorations/parse) — verified equivalent incl. get_status path and settings fallback; requires deferred inside functions (metadata-safe); lint.cmd identical + commands.luau added with zero warnings; budget FAIL 13->12; NOTE: WhiteboardLabelPopup.test.ts failure is parallel whiteboard WIP (untracked canvas dir), not this change",
      done: true,
    }
  - {
      label: "harpoon/init.luau 558 -> init 282 (types/table/execute) + store 131 + picker 144 + footer 71; t threaded as param, requires inside execute (metadata-safe); luau-analyze clean on all 4 files; lint.cmd identical; bun tests 468/468 (whiteboard popup green again — parallel WIP settled)",
      done: true,
    }
  - {
      label: "telescope trio dedupe done (2026-09-25): telescope lib 62->115 (+show_empty/open_indexed_pick/get_basename re-export, v1.1.0); files 234->221, grep 215->200, todos 250->238 (3x get_basename + 3x empty-picker + 3x pick-and-open deleted); cancel_msg conditional preserved via string? return; targeted lint clean; lint.cmd identical; bun tests 472/472",
      done: true,
    }
  - { label: "postgres/init 1246 -> move stray logic into existing modules", done: false }
  - { label: "postgres/dialogs 515 -> per-dialog modules", done: false }
  - { label: "git/init 649 -> flows into branches/commits/sync/projects", done: false }
  - { label: "harpoon/init 500 -> init + store/picker", done: false }
  - { label: "telescope trio consumes shared/telescope-picker, triplicates deleted", done: false }
  - { label: "each file <=600 (aim <=300), plugin lint + gen:sdk --check green", done: false }
---

## Notes

git vs git-hygiene stay separate plugins; only shared/ helpers are common.
