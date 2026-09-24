# Best Practices — Modularity, DX & De-duplication

Distilled from the full-repo refactor (Phases 0–5, see board
`refactor-modularity`). Principles: SOLID (SRP/ISP), DRY (3rd occurrence),
KISS (fold > abstract), YAGNI (delete, don't generalize).

## 1. One responsibility per file

A file earns its existence with one reason to change. When a component grows
a second job, extract — don't append.

- **SolidJS**: components render; hooks own signals/effects. Domain state
  goes in `model/` (feature) or `app/` (shell); never mix fetch, filter, and
  JSX in one file. Split pattern that worked: verbatim logic moves →
  thin aliases keep JSX compiling → move JSX per tab → delete aliases.
- **Rust**: `#[command]` validates, delegates to a domain module, emits.
  Pure logic (matching, parsing, sorting) lives in modules with unit tests;
  the command layer stays a thin orchestrator.
- **Luau**: `init.luau` is types + locales + plugin table + delegation.
  Flows live in sibling modules; the dispatcher routes by command id.

## 2. Shared helpers — on the 3rd occurrence only

```
// BAD: 5th copy of the same 8 lines across node components
async function openExternal(href: string): Promise<void> {
  if (isTauri()) { await openUrl(href); return; }
  window.open(href, "_blank", "noopener,noreferrer");
}

// GOOD: lib/open-external.ts — one definition, N importers
import { openExternal } from "~/lib/open-external";
```

Dedupe only what repeats 3+ times. Two copies is a coincidence; a shared
module for two call sites is overhead. And same name ≠ same contract:
`fuzzyMatch` (null = no match) vs `fuzzyScore` (0 = no match, swapped args)
must NOT merge — merging silently reorders rankings. Document the exception.

## 3. No new frameworks

```rust
// BAD: generic "emit framework" for two call sites
// GOOD: one 10-line helper where the pattern repeats 5+ times
pub fn emit_task_snapshot(app: &AppHandle, snapshot: &TaskMonitorEntry) {
    let _ = app.emit("task-state-changed", task_state_emit(snapshot));
    let _ = app.emit("task-tree-changed", task_tree_emit(snapshot));
}
```

Prefer folding over abstracting: one-call Tauri wrappers belong in their
caller; a module needs 2+ consumers or a distinct responsibility. Never
introduce a plugin engine, form engine, or event framework for one feature.

## 4. Delete, don't generalize (YAGNI)

- Test-only helpers get `#[cfg(test)]` (kills dead-code warnings honestly).
- Zero-caller code gets deleted after `rg` proof — not `#[allow(dead_code)]`.
- Debug commands get release gates (`cfg(debug_assertions)` early-return),
  never registration removal (keeps debug builds working).
- Dual implementations get ONE survivor: verify equivalence per flow first
  (the git plugin's modular siblings were complete but unwired — wiring them
  deleted 500 lines of inline duplication). When equivalence can't be
  verified (no visual/functional oracle), keep verbatim and document why.

## 5. Splits must be behavior-preserving

- Move code verbatim first; wire props/imports after. Every step compiles.
- Barrels keep old import paths alive for one phase (`export *` re-exports).
- Splice bottom-up with line-range scripts; verify close tags after every
  splice (off-by-one drops `</TabsContent>`/`SidebarInset` silently).
- Prefer the `edit` tool for text with non-ASCII characters; after any
  scripted edit, `rg` the special chars back to confirm they survived.

## 6. Respect in-flight work

- `git ls-files` before restructuring: untracked trees are someone's
  feature branch. Restructure around them, never through them.
- Pre-existing failures get a stash-baseline proof (`git stash` → same
  failure → not yours), recorded on the card — never "fixed" blindly.

## 7. Verify per surface, record per card

- Frontend `typecheck + lint + test`, backend `clippy + test --no-run`,
  plugins `lint.cmd` diffed against baseline. Zero new warnings is the bar;
  pre-existing ones get named, not fixed drive-by.
- Kanban card per phase with per-item evidence (sizes, grep proofs, gate
  outputs). Memory entries for decisions future sessions will need.
