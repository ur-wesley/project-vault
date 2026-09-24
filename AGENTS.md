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
