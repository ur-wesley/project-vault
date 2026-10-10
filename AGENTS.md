# AGENTS.md

Agent conventions for this repo. Detailed UI/Tauri/Rust rules live in `ai/styleguide*.md`.
Modularity rules and rationale: `docs/BEST_PRACTICES.md`.

## Type guards — use the shared helpers

- Use `isRecord` / `isPlainObject` / `isStableError` / `asString` from `src/lib/guards.ts`.
  Do not inline `typeof x === "object"` ladders, `as any`, or `as unknown as`.
- Unvalidated data (`res.json()`, `JSON.parse`, Tauri events, plugin payloads): type as
  `unknown`, validate with Zod `safeParse` or `isRecord` + `Array.isArray`.
- Errors: use `mapInvokeError` from `src/services/tauri/utils.ts`.
  Never `(e as any).code`.
- Nullish: use `?.` / `??` / `!= null`. Never `x !== undefined && x !== null` chains.
- Ternaries: max depth 1 (enforced by `no-nested-ternary`). Extract a helper with
  early returns instead of nesting.
- Keep: `typeof window/document/localStorage`, `ReturnType<typeof ...>`,
  `z.infer<typeof ...>`, feature-flag function checks (`typeof crypto.randomUUID === "function"`).

## File budgets — enforced by `lint:budget`

- TS warn 300 / fail 600; Rust warn 400 / fail 800 (tests excluded);
  Luau warn 300 / fail 600 (`vault.luau` excluded — generated).
- Over warn: split or justify in the PR. Over fail: CI blocks.
- Minimum viable module ~80 lines — merge, don't atomize.

## Modularity — one responsibility per file

- Components render; hooks own state/effects (`model/` or `app/`);
  pure helpers live in `lib/`; `services/tauri/` owns invoke wrappers only.
- New shared helper only on the 3rd occurrence (DRY). First two stay local.
- No new frameworks or generic engines. Fold one-call wrappers into callers;
  keep a module only when it has 2+ consumers or a distinct responsibility.
- Tauri `#[command]`s stay thin: validate, delegate to a domain module, emit.

## No-duplicate rule — check before adding

- `rg` for the function name across the surface first. Single home per
  concept: `lib/open-external.ts`, `lib/path-utils.ts`, `stableErrorMessage`,
  one `formatRelativeTime`, `DialogShell`/`CopyButton` for dialogs.
- Same name ≠ same contract: `fuzzyMatch` (null-contract) vs `fuzzyScore`
  (zero-contract) and per-plugin `translate` (own locales) stay separate.
  Merging changes behavior — document the exception instead.

## Plugin (Luau) constraints

- Never hand-edit `pv-plugins/vault.luau` — regen with `bun run gen:sdk`.
- `init.luau` top level stays declarative (types, locales, plugin table);
  requires go inside functions so metadata reads never execute modules.
- Sharing across plugins lives in `category = "library"` exports or
  `vendor/` externals — never relative requires across plugin dirs.

## Verification — per surface, every change

- Frontend: `bun run typecheck && bun run lint && bun run test`.
- Backend: `cargo clippy` (zero new warnings) + `cargo test --lib --no-run`.
- Plugins: `lint.cmd` in `pv-plugins/` (compare against baseline — it fails
  on HEAD for the known `types.X` require-resolution limitation).
- One god-file split per PR, verbatim moves first, no behavior change.
  Prove deletions with `rg` + a green gate before closing.


<!-- BEGIN BEADS INTEGRATION v:1 profile:full hash:bacef91e -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Quality
- Use `--acceptance` and `--design` fields when creating issues
- Use `--validate` to check description completeness

### Lifecycle
- `bd defer <id>` / `bd supersede <id>` for issue management
- `bd stale` / `bd orphans` / `bd lint` for hygiene
- `bd human <id>` to flag for human decisions
- `bd formula list` / `bd mol pour <name>` for structured workflows

### Sync

bd stores issue history in Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- Do not treat `.beads/issues.jsonl` as the sync protocol

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and https://github.com/gastownhall/beads/blob/main/docs/getting-started/quickstart.md.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.

<!-- END BEADS INTEGRATION -->

## Fabrik workflow

Run `fabrik show workflow` for the full workflow.
