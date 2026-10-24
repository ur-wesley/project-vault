---
id: split-backend-gods
board: refactor-modularity
title: Phase 2b — split Rust gods
status: done
priority: high
tags: [backend]
assignees: []
parent: null
relations:
  - { to: shared-primitives, kind: blocking }
due: null
archived: false
links:
  tasks: ["cargo clippy", "cargo test"]
  files:
    [
      "src-tauri/src/postgres/mod.rs",
      "src-tauri/src/commands/dokploy.rs",
      "src-tauri/src/lua/loader.rs",
      "src-tauri/src/commands/plugins.rs",
      "src-tauri/src/spawn/embedded.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/models.rs",
    ]
  issues: []
  workspaces: []
checklist:
  - {
      label: "commands/dokploy.rs 2006 -> dokploy/{api 309, matching 721, status 91, candidates 309, commands 508, dto 128, mod 9}; collect_matches/collect_candidates marked #[cfg(test)] (were test-only, killed 2 dead-code warnings); tests split per module with local stub_server; lib.rs registrations updated; cargo check green (5->3 warnings), clippy only verbatim-move hits, test build compiles (execution blocked by pre-existing STATUS_ENTRYPOINT_NOT_FOUND loader issue); budget FAIL 17->16",
      done: true,
    }
  - {
      label: "commands/plugins.rs 1437 -> plugins/{repo 268, monorepo 408, link 380 (incl. tests), updates 160, lockfile 145, paths 74, dto 63, mod 11}; pull_repo_at+update_repo_checkout moved to monorepo (checkout-domain), merge stays there; dual lockfiles colocated in lockfile.rs as documented split (main vs vendor, different backends — merging would change behavior); crate::error::codes:: normalized to short form; lib.rs 26 registrations + plugins_dir call sites (lib, project_wizard) repointed; cargo check green (3 pre-existing warnings), clippy zero in plugins/, test build compiles; bun tests 435/435; budget FAIL 16->15",
      done: true,
    }
  - {
      label: "postgres/mod.rs 2416 -> postgres/{clusters 498, engine 547, versions 402, settings 354, records 280, extensions 222, docker 182, mod 28}; tcp_open/postmaster_pid/cluster_status/list_statuses/probe_free_port moved to clusters (status-domain); Endpoint fields pub(crate); sibling glob imports + pub(crate) fns (cycles fine in Rust); crate::postgres::* paths preserved via mod.rs glob re-exports (40+ lua-module call sites untouched); tests split per module; cargo check green (3 pre-existing warnings), clippy only verbatim-move hits, test build compiles; bun tests 454/454; budget FAIL 15->14",
      done: true,
    }
  - {
      label: "lua/loader.rs 1774 -> lua/loader/{spec 743, load 558, runtime 382, manager 123, mod 14}; loader.rs became loader/mod.rs facade with glob re-exports so all crate::lua::loader::* paths work unchanged (zero call-site changes); recovered cut #[derive] on PluginPageMetadata; shared test helpers as #[cfg(test)] pub(crate) in spec.rs; trimmed 8 unused json test imports; cargo check green (3 pre-existing warnings), clippy only verbatim-move hits, test build compiles; bun tests 454/454; budget FAIL 14->13",
      done: true,
    }
  - {
      label: "spawn merge + lib.rs setup done (2026-09-25): spawn/emit.rs 67 (shared encode/append/emit sink; 3 reader loops + 3 payload dupes unified); register/reregister merged via insert_and_watch (silent-recovery difference preserved + documented); setup/{plugins 134, orphans 48, mcp 45, watchers 29, playtime 15, mod 10}; lib.rs 654->445; cargo check green, clippy zero in new code (fixed own parens lint); bun tests 454/454",
      done: true,
    }
  - {
      label: "postgres/mod.rs 2261 -> version/clusters/docker/extensions/engine/psql_csv",
      done: false,
    }
  - { label: "lua/loader.rs 1658 -> runtime_state/spec_parse/plugin_load", done: false }
  - {
      label: "commands/plugins.rs 1304 -> repo/monorepo/lockfile/link/updates, unify dual lockfiles",
      done: false,
    }
  - {
      label: "spawn reader-thread x3 -> one reader_emit helper; register/reregister merge",
      done: false,
    }
  - { label: "lib.rs setup -> setup/{watchers,orphan,playtime,mcp}", done: false }
  - { label: "each module <=800 (aim <=400), clippy+test green", done: false }
---

## Notes

Commands stay thin: #[command] validates + delegates to module. No logic change.
