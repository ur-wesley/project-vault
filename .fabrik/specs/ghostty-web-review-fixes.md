# ghostty-web review fixes - fix plan (branch `feat/ghostty-web`)

## 1. Title and context

Fix plan for review findings on branch `feat/ghostty-web` (xterm to ghostty-web migration, changes currently uncommitted).

Review inputs: critical and major findings plus style-smells and a security pass over the new terminal surface.

Gate baseline at review time (recorded in the request):

- `bun run typecheck` - PASS
- `bun run lint` - PASS
- `bun run test` - 1 flaky failure (`markdown.test.ts` timeout, passes in isolation)
- `lint:budget` - FAIL, pre-existing (9 fail and 94 warn); branch adds zero new violations
- `cargo clippy` - 250 pre-existing warnings, zero new
- `cargo test --lib --no-run` - PASS
- Tauri exec - BLOCKED in this environment
- Luau (`lint.cmd` in `pv-plugins/`) - SKIP (no plugin changes in this branch)

Key files under review (full paths, no truncation):

- `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (535 lines, over warn budget 300)
- `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx`
- `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts`
- `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` (17 lines, under min-viable-module of about 80)
- `C:\Arbeit\project-vault\src\components\terminal\terminal-io.ts`
- `C:\Arbeit\project-vault\src\lib\open-external.ts`
- `C:\Arbeit\project-vault\src\features\project-detail\lib\terminal-buffer.ts`
- `C:\Arbeit\project-vault\vite.config.ts`
- `C:\Arbeit\project-vault\src\lib\guards.ts`
- `C:\Arbeit\project-vault\src\types\error.ts` (StableError contract)
- `C:\Arbeit\project-vault\App.css` (lines 432-444, hidden textarea rule)
- `C:\Arbeit\project-vault\scripts\check-file-budget.mjs`
- `C:\Arbeit\project-vault\src\services\tauri\terminal.ts` (thin command invoke wrappers)

Repo conventions that bind this plan (AGENTS.md):

- Use shared type guards `isRecord`, `isPlainObject`, `isStableError`, `asString` from `C:\Arbeit\project-vault\src\lib\guards.ts`. Never inline `typeof x === object` ladders, `as any`, or `as unknown as`. Unvalidated data (`res.json()`, `JSON.parse`, Tauri events, plugin payloads) is typed `unknown` and validated with Zod `safeParse` or `isRecord` plus `Array.isArray`. Errors go through `mapInvokeError` from `C:\Arbeit\project-vault\src\services\tauri\utils.ts`, never `(e as any).code`. Nullish uses `?.`, `??`, `!= null`. Max ternary depth 1.
- File budgets enforced by `lint:budget` - TS warn 300, fail 600 (tests excluded). Over warn: split or justify in the PR. Over fail: CI blocks. Minimum viable module about 80 lines - merge, do not atomize.
- One responsibility per file: components render; hooks own state and effects (`model/` or `app/`); pure helpers live in `lib/`; `services/tauri/` owns invoke wrappers only. New shared helper only on the 3rd occurrence (DRY). No new frameworks or generic engines. Tauri commands stay thin: validate, delegate to a domain module, emit.
- No-duplicate rule: run `rg` for the function name across the surface first. Single home per concept (`lib/open-external.ts`, `lib/path-utils.ts`, `stableErrorMessage`, one `formatRelativeTime`, `DialogShell` and `CopyButton` for dialogs). Same name with a different contract stays separate only with a documented exception.
- Verification per surface, every change: frontend `bun run typecheck && bun run lint && bun run test`; backend `cargo clippy` (zero new warnings) plus `cargo test --lib --no-run`; one god-file split per PR, verbatim moves first, no behavior change; prove deletions with `rg` plus a green gate before closing.

## 2. Scope

### In scope

- All Critical, Major, security Medium and Low, and style-smell items listed below (P0, P1, P2).
- `vite build` proof plus a Tauri dev smoke checklist (spawn, resize, copy and paste, link click, dialog open and close, WASM-offline failure path).
- Pinning and config work for `ghostty-web` WASM under Vite plus Tauri prod `file://` plus CSP.

### Out of scope (do NOT do in this plan)

- Landing Beads issues (`bd` and fabrik issue landing) - spec only, no issue creation.
- Implementing the fixes - spec only, no code changes.
- New terminal features, theme overhauls, backend PTY rework, plugin (Luau) changes.
- Changing the `lint:budget` thresholds themselves or fixing the 9 pre-existing budget failures outside the touched terminal surface (only rule: branch must add zero new violations; justify or split what it touches).
- Re-architecting `ghostty-web` internals or forking the library.

## 3. Phased tasks

Ordering: P0 (ship-blockers: blank terminal plus unsafe link open) to P1 (correctness and config debt: duplication, private-API coupling, Vite and CSP, library link detection) to P2 (hygiene: guards, constants, module shape, dims, copy-paste, dialog, textarea, timers). Each task lists files, the fix shape (no code landing here, this is the contract the builder follows), acceptance criteria, and verification.

---

### P0 - Critical plus security-medium (ship-blockers, do first)

#### P0-1 - Handle `ensureGhosttyReady()` rejection (blank-terminal fix)

- Files:
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 250-251: `void (async () => { await ensureGhosttyReady(); ... })()`)
  - `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (lines 134-135: same `void (async ...)` idiom)
  - `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` (whole file - `initPromise` reset-on-failure contract)
  - `C:\Arbeit\project-vault\src\lib\invoke-error.ts` (`stableErrorMessage(t, ...)` helper already used at `TerminalHost.tsx:369`)
- Problem: unhandled WASM-load rejection leads to silent blank terminal, unhandled promise rejection in console, no user-visible error.
- Fix shape: wrap each `void (async () => ...)` body in `try/catch`; on catch call the existing `onError(stableErrorMessage(t, err))` path (host) or a dialog-visible error state (dialog) plus a fallback message when i18n is unavailable; guard `cancelled` before touching disposed state; add a comment noting `ensureGhosttyReady()` already resets `initPromise` on failure so a retry reloads WASM. Do NOT swallow: surface via `onError` and `console.error`.
- Acceptance:
  - [ ] Blocked offline or corrupt-WASM load shows an error message instead of a blank terminal in both host and dialog.
  - [ ] No unhandled promise rejection in console.
  - [ ] Retry after transient failure re-attempts `init()` (relies on documented `ghostty-init.ts` reset behavior).
  - [ ] Guards used for the caught error (`isStableError` and `stableErrorMessage`), no `as any`.
- Verification: `bun run typecheck && bun run lint && bun run test`; manual offline WASM failure checklist item (see section 4); `rg ensureGhosttyReady src` shows exactly the two guarded call sites.

#### P0-2 - [Security:Medium] Allowlist terminal link targets before `openUrl` (file, data, javascript guard)

- Files:
  - `C:\Arbeit\project-vault\src\lib\open-external.ts` (lines 21-27: `openExternal` passes `href` straight to `openUrl`)
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 93-97: `void openExternal(link.text)`)
  - `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (lines 76-80: same sink)
- Problem: terminal link text flows unchecked into Tauri `openUrl` - `file://`, `data:`, `javascript:` (and other non-web schemes) must never reach the OS handler from terminal content. Note `open-external.ts:6-13` already allowlists `http(s)://` plus `mailto:` in the `window.open` shim - the direct `openExternal()` Tauri path does not.
- Fix shape (single home per no-duplicate rule - fix inside `openExternal`, not at each call site): parse and trim `href`, allowlist `http:`, `https:`, `mailto:`, `tel:` only (DECIDED section 8 OQ-5) (case-insensitive, after trim; reject protocol-relative and leading-control-char tricks); on disallowed scheme, no-op plus `console.warn` (and optional `onError` at call sites - decided by builder, default warn-only to avoid error spam on hover text). Keep the web fallback (`window.open(href, _blank, noopener,noreferrer)`) behind the same allowlist. Add unit test for `openExternal` scheme gating (mock `openUrl`).
- Acceptance:
  - [ ] `http://`, `https://`, `mailto:`, `tel:` open (DECIDED section 8 OQ-5); `file://`, `data:`, `javascript:`, `vbscript:`, bare paths, and whitespace or control-char-prefixed URLs are blocked.
  - [ ] Both terminal link sinks covered by the single `openExternal` fix (no per-callsite filtering duplication).
  - [ ] Test covers allowed plus representative blocked schemes.
  - [ ] No `as any` in new code; uses `asString` and guards.
- Verification: `bun run typecheck && bun run lint && bun run test`; `rg openUrl src` shows only the guarded `open-external.ts` production call; link-click smoke item (http link opens, `file://` text does not).

#### P0-3 - [Security:Low] Guard `decodeTerminalChunk` (`atob` throws, replay loops uncaught)

- Files:
  - `C:\Arbeit\project-vault\src\components\terminal\terminal-io.ts` (lines 38-45: `decodeTerminalChunk` - raw `atob`)
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 431, 443: replay `term.write(decodeTerminalChunk(chunk))`)
  - `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (line 196: same replay sink; lines 204-207 live path)
  - `C:\Arbeit\project-vault\src\features\project-detail\lib\terminal-buffer.ts` (lines 39-52: existing try and catch idiom to mirror)
- Problem: malformed base64 from the backend throws synchronously inside replay and live loops, breaking replay or raising uncaught exceptions in a subscriber.
- Fix shape: make `decodeTerminalChunk` total - `try/catch` around `atob`, log once via `console.error` or `console.warn`, return empty `Uint8Array(0)` (or skip-write at call sites when decoded length is 0). Mirror the `terminal-buffer.ts:39-52` idiom. Call sites optionally skip zero-length writes. Never let one bad chunk kill the replay loop.
- Acceptance:
  - [ ] Malformed chunk logs and is skipped; surrounding replay continues.
  - [ ] Live subscriber path cannot throw out of `decodeTerminalChunk`.
  - [ ] Unit test: `decodeTerminalChunk` with non-base64 input returns empty and does not throw.
- Verification: `bun run typecheck && bun run lint && bun run test` (new test included).

---

### P1 - Majors (correctness plus config debt, do second)

#### P1-1 - Extract duplicated link helpers (`calculateAbsoluteRow` plus `attachTauriLinkHandler`)

- Files:
  - NEW: `C:\Arbeit\project-vault\src\components\terminal\terminal-links.ts` (preferred; single home; alternatively `C:\Arbeit\project-vault\src\lib\terminal-links.ts` - builder picks one and documents it)
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 54-63 `calculateAbsoluteRow`, lines 65-107 `attachTauriLinkHandler`)
  - `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (lines 37-46, lines 48-90 - byte-identical copies)
- Fix shape: verbatim move first (per god-file-split rule: move with zero behavior change, one PR), both consumers import from the new module. Keep the exported signature `{ dispose: () => void }`. Follow-up behavior changes (P1-2, P0-2) land separately. Before creating the module, run `rg calculateAbsoluteRow|attachTauriLinkHandler src` to confirm exactly these two copies (3rd-occurrence rule already satisfied: 2 copies justify a shared helper, no further generalization).
- Acceptance:
  - [ ] Zero copies of either function remain in the two components (`rg` proves it).
  - [ ] New module has one responsibility (link-row math plus click handler); no new framework code.
  - [ ] Typecheck, lint, test green; behavior identical (smoke: link click still works).
- Verification: `bun run typecheck && bun run lint && bun run test`; `rg` deletion proof; `node scripts/check-file-budget.mjs` shows no new violation.

#### P1-2 - Remove private-API coupling (`refresh`, `renderer`, `wasmTerm`, `linkDetector`)

- Files:
  - `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` (lines 45-55: `forceTerminalRedraw` reaches `gTerm.refresh?.()`, `renderer.remeasureFont`, resize, render)
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 68-82: `linkDetector`, `renderer`, `wasmTerm` casts)
  - `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (lines 51-65: same casts)
  - `C:\Arbeit\project-vault\package.json` (pin `ghostty-web` to an exact reviewed version as part of this task)
- Problem: `refresh?.()` is a no-op (missing in ghostty-web) hiding real redraw gaps; `renderer`, `wasmTerm`, `linkDetector` are private internals that can break on any library bump; hand-rolled canvas hit-testing duplicates the library.
- Fix shape (prefer public API, in order): (a) replace `attachTauriLinkHandler` hit-testing with `registerLinkProvider`, `UrlRegexProvider`, `OSC8LinkProvider` from `ghostty-web` where available, routing clicks through the P0-2-allowlisted `openExternal`; (b) reduce `forceTerminalRedraw` to public calls only and delete the `refresh?.()` no-op or document with a why-comment if a real gap requires it; (c) pin `ghostty-web` exact version; record which public API was chosen and why in the PR. If the public provider API cannot cover the canvas case, keep the narrowest possible adapter behind the new `terminal-links.ts` boundary with an explicit version-pin plus fallback comment - no scattered casts.
- Acceptance:
  - [ ] No `refresh?.()` no-op; no `linkDetector` or `wasmTerm` casts outside (at most) one documented adapter.
  - [ ] `ghostty-web` pinned exact in `package.json` (plus lockfile).
  - [ ] Link clicking still works via public provider path (smoke item).
  - [ ] Resize and repaint still work without private `renderer.render` (smoke: resize, tab switch, focus).
- Verification: `bun run typecheck && bun run lint && bun run test`; `rg` for `wasmTerm|linkDetector` shows empty or only the documented adapter; `vite build` green.

#### P1-3 - Vite WASM config plus Tauri prod `file://` plus CSP proof

- Files:
  - `C:\Arbeit\project-vault\vite.config.ts` (currently no `assetsInclude`, `?url`, `optimizeDeps` handling for `*.wasm`)
  - `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` (documents `init()` to `ghostty-vt.wasm` load)
  - Tauri config plus CSP (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/` - builder resolves exact paths with `rg csp|wasm src-tauri`)
  - `C:\Arbeit\project-vault\index.html` (if CSP meta or script-src changes are needed)
- Fix shape: add the minimal Vite WASM wiring the installed `ghostty-web` version requires (`assetsInclude: [**/*.wasm]` and optional `?url` import plus `optimizeDeps.exclude` for the wasm module - verify against the library docs, do not cargo-cult all three); `vite build` must emit the wasm asset with a correct hashed URL under both `vite dev` and Tauri prod `file://`; adjust Tauri CSP (`script-src`, `worker-src`, `wasm-unsafe-eval` as required) minimally and document the delta. Record the chosen mechanism in the PR.
- Acceptance:
  - [ ] `vite build` succeeds and the terminal works from the built bundle, not just dev.
  - [ ] Tauri prod (`file://`) loads `ghostty-vt.wasm` with no CSP violation in console.
  - [ ] No over-broad CSP wildcard introduced; delta is minimal and documented.
- Verification: `vite build` (or `bunx vite build`) green; Tauri dev smoke (prod-profile) checklist: spawn, resize, reload-safe WASM init; `rg wasm vite.config.ts src-tauri` shows the wired config.

#### P1-4 - Replace hand-rolled link detection with the library `LinkDetector`

- Files: same as P1-1 plus whatever `ghostty-web` link API the pin exposes (`LinkDetector`, `registerLinkProvider`, `UrlRegexProvider`, `OSC8LinkProvider`).
- Fix shape: merge into P1-2 where possible (this is the use-the-library half; P1-2 is the stop-touching-privates half). Delete `calculateAbsoluteRow` entirely if the provider API makes row math unnecessary; otherwise keep it private inside `terminal-links.ts` with a comment. Prefer OSC8 plus URL-regex providers over manual canvas `getBoundingClientRect` math.
- Acceptance:
  - [ ] No hand-rolled `getBoundingClientRect` to col and row to `getLinkAt` path unless the library provably lacks the hook (documented with version plus link to docs).
  - [ ] All link opens still flow through allowlisted `openExternal` (P0-2).
- Verification: same gates as P1-2; link-click smoke passes.

---

### P2 - Smells, minor, nits (hygiene, do third; batch into small PRs, one god-file split per PR)

#### P2-1 - Replace all `as unknown as`, `as any`, `as string`, `as Node` with guards

Exact sites (builder must clear every one; `rg` for `as` patterns on these files must come back clean or explicitly justified):

- `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts`: line 46 (`as unknown as RedrawableTerminal`), lines 70-74 (`as unknown as { renderer ... }`), line 166 (`as unknown as number`), line 201 (`as unknown as number`).
- `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx`: lines 69, 74, 79 (private-API casts - preferably deleted by P1-2; otherwise narrowed structural guards), line 123 (`Result<string,any>` to `Result<string, StableError>` or `unknown`), line 300 (`e.target as Node` to `instanceof Node` check), lines 355, 396, 460 (`t(...) as string` to `asString(t(...))`), plus line 480 `setTimeout` handle if mistyped.
- `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx`: lines 52, 57, 62 (same private casts), lines 282, 285, 287 (`t(...) as string` to `asString`).
- `C:\Arbeit\project-vault\src\components\terminal\terminal-io.ts`: line 160 (`mapErr` cast - type via `isRecord` plus `typeof ... === function` narrowing or a minimal structural type, no `as`).
- Rules: `isRecord`, `isPlainObject`, `isStableError`, `asString` from `C:\Arbeit\project-vault\src\lib\guards.ts`; `ReturnType<typeof setTimeout>` for timer handles (never `as unknown as number`); `instanceof Node` and `instanceof Element` for DOM targets; `mapInvokeError` for Tauri errors. Max ternary depth 1 - extract a helper with early returns instead of nesting.
- Acceptance: [ ] listed `as`-sites gone; [ ] typecheck plus lint green; [ ] no new `as` introduced (`rg` proof in PR).

#### P2-2 - DRY plus magic numbers: `readBoxPadding`, repaint and resize delay constants, textarea single-source

- Files:
  - `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` (lines 94-108: two copy-pasted `getComputedStyle` padding blocks; magic delays 50ms near line 199, plus 120, 150, 200ms call-site delays in `TerminalHost.tsx:177,183,207` and `task-stream-dialog.tsx:177,221,250`).
  - `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (lines 267-272) and `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (lines 167-172): inline `term.textarea.style` hiding versus `C:\Arbeit\project-vault\App.css` lines 432-444.
  - `C:\Arbeit\project-vault\src\components\terminal\terminal-io.ts` (lines 144, 147: existing `TERMINAL_SLOW_WRITE_MS` and `TERMINAL_WRITE_QUEUE_WARN_DEPTH` pattern to follow).
- Fix shape: add `readBoxPadding(el: Element)` helper in `terminal-repaint.ts` returning `{left,right,top,bottom}` and use at both call sites; export `TERMINAL_REPAINT_MS = 50`, `TERMINAL_RESIZE_DEBOUNCE_MS = 120` (plus named constants for the 150ms activation and focus and 200ms dialog-push delays, or unify where behavior allows - decision recorded); single-source the hidden-textarea styling (CSS class in `App.css` preferred, TS inline removed); follow the existing `TERMINAL_*` constant pattern.
- Acceptance: [ ] one padding reader; [ ] no bare delay literals on terminal paths; [ ] textarea hiding defined once.
- Verification: typecheck plus lint plus test; `rg` for padding and delay literals on the touched files reviewed in PR.

#### P2-3 - `ghostty-init.ts` 17-line module: fold or justify

- File: `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` (17 lines, below 80 min-viable-module).
- Fix shape: either (a) fold `ensureGhosttyReady` into `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` (or the new `terminal-links.ts` owner - one home, documented), updating the two import sites; or (b) keep separate with a PR justification (2 consumers plus distinct WASM-lifecycle responsibility). Do NOT grow the file artificially to hit 80 lines. **DECIDED (see section 8 OQ-2): keep `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` separate with a header comment referencing the 80-line exception; do NOT fold.**
- Acceptance: [ ] module either folded (imports updated, old file deleted - `rg ghostty-init` proves removal) or kept with written justification referencing the 2-consumer rule **(DECIDED: kept - see section 8 OQ-2).**
- Verification: typecheck plus lint plus test; budget script delta reviewed.

#### P2-4 - Split `TerminalHost.tsx` (535 lines, warn 300) - verbatim-first, one split per PR

- File: `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx`.
- Fix shape (sequential PRs, each verbatim-move-first with zero behavior change): (1) extract clipboard shortcut block (lines about 292-328) into a `useTerminalClipboard`-style hook or `terminal-clipboard.ts`; (2) extract spawn, session and replay effect (lines about 228-505) into a `useTerminalSession`-style hook; (3) extract link handling (done in P1-1) - after the three moves the component is render plus focus effects only. Each PR: move verbatim, green gate, then (separate commit or PR) behavior cleanups. Never combine a move with a behavior change in one PR.
- Acceptance: [ ] `TerminalHost.tsx` back under 300 lines (warn) without a fail-budget excursion; [ ] `node scripts/check-file-budget.mjs` adds zero new violations; [ ] each split PR shows `rg` deletion proof plus green gates.
- Verification: per-PR `bun run typecheck && bun run lint && bun run test`, `bunx oxfmt --check`, budget script.

#### P2-5 - Behavior and UX confirmations and small fixes (batch; each needs an explicit decision)

1. `proposeTerminalDimensions` double-counts padding when `target === parent` (`terminal-repaint.ts:102-108` adds `el` padding on top of `parent` padding - confirm additive versus overlapping box model; fix to single-box math - DECIDED single-box fix, see section 8 OQ-3). File: `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` lines 66-117.
2. Custom-dims versus `fit.fit()` 15px divergence (`terminal-repaint.ts:57-65` comment versus `applyFitDimensions` lines 119-136 fallback) - unify on custom-canonical plus library-fallback (DECIDED section 8 OQ-3); record measured pixels before and after. Same file.
3. Stale xterm refs in comments (`TerminalHost.tsx:299` tab-bar focus note, `TerminalHost.tsx:365-366` real xterm geometry note) - reword to ghostty-web. Trivial.
4. Copy and paste asymmetry (host handles Ctrl+C copy plus Ctrl+V paste; dialog only Ctrl+V at `task-stream-dialog.tsx:150-165`) - bring dialog to parity (copy-on-selection plus paste) - DECIDED: parity, dialog gets copy (see section 8 OQ-4).
5. Dialog `onCleanup` kills PTY (`task-stream-dialog.tsx:237` `void embeddedTerminalKill(sid)`) - confirm intended (dialog is the task owner) versus detach-and-keep-alive; DECIDED detach-and-keep-alive (see section 8 OQ-1).
6. Swallowed clipboard error (dialog line 161 `.catch(() => {})` versus host lines 314-316 `console.error`) - unify on `console.error` (host idiom) (DECIDED section 8 OQ-4).
7. Initial spawn geometry narrow (host lines 329-332 gate `fit.fit()` on `TERMINAL_MIN_WIDTH` and HEIGHT; background tabs keep 80x24 until activation retry at 177-181) - confirm 80x24-then-resize is acceptable or force `proposeTerminalDimensions` pre-spawn; record decision.
8. `term.write` empty-string flush idiom (`TerminalHost.tsx:433,445`, `task-stream-dialog.tsx:198`) - keep but add a one-line comment (ghostty-web flush callback) so it is not cleaned up later.
9. `forceTerminalRedraw` `refresh?.()` no-op plus `schedule/clearTerminalResize` `as unknown as number` casts (lines 166, 201) - resolved by P1-2 plus P2-1; tracked here so they are not forgotten.
10. Hidden-textarea single-source - covered by P2-2; tracked here for the checklist.
- Acceptance: [ ] each sub-item has a recorded decision (keep or change plus why) in its PR; [ ] copy and paste parity resolved as parity (see section 8 OQ-4); [ ] dialog-close answered as detach-and-keep-alive (see section 8 OQ-1).
- Verification: Tauri dev smoke checklist (spawn, resize, copy and paste, link click, dialog open and close, wasm-offline failure).

## 4. Verification (per phase plus final)

Per task (minimum):

- `bun run typecheck && bun run lint && bun run test`
- `bunx oxfmt --check` on touched files (format gate)
- `node scripts/check-file-budget.mjs` - branch must add zero new violations (baseline 9 fail and 94 warn pre-existing; do not fix unrelated files in this plan, only avoid adding)
- `rg` proofs where the task says so (deletion of duplication, `as`-casts, `wasmTerm|linkDetector`, `ghostty-init` imports)

P1-3 additionally:

- `vite build` (or `bunx vite build`) green; terminal works from the built bundle
- Tauri prod `file://` check: no WASM 404, no CSP violation in console

Final smoke (Tauri dev, manual checklist - exec was BLOCKED at review time, so a human or achievable-env agent runs this before merge):

1. spawn - open terminal tab, shell appears at sane (80x24 or better, or measured-fit) geometry
2. resize - window plus split resize pushes new dims (backend `embeddedTerminalResize` fires, no shrinking ratchet)
3. copy and paste - Ctrl+C with selection copies, Ctrl+V pastes, in host AND dialog
4. link click - http(s) link opens in system browser; `file://`, `data:`, `javascript:` text does nothing (warn in console)
5. dialog open and close - task output dialog streams, closes cleanly, PTY fate matches OQ-1 decision
6. wasm-offline failure - blocked WASM load shows the P0-1 error UI, no blank terminal, no unhandled rejection

Full gates before merge:

- `bun run typecheck && bun run lint && bun run test` (note known-flaky `markdown.test.ts` - rerun isolated on timeout)
- `bunx oxfmt --check`
- `node scripts/check-file-budget.mjs` (zero new)
- `vite build`
- `cargo clippy` (zero NEW warnings versus 250 baseline) plus `cargo test --lib --no-run` (unchanged backend, but run to prove it)

## 5. Risks

- R1 - Private-API removal (P1-2 and P1-4) may expose redraw or hit-testing gaps the `refresh?.()` no-op and canvas math currently paper over. Mitigation: pin `ghostty-web`, keep the narrowest documented adapter fallback, verify with resize, focus, and tab-switch smoke.
- R2 - Vite and CSP fix (P1-3) is the least predictable item (bundler plus `file://` plus CSP interaction). Mitigation: verify `vite build` plus prod-profile Tauri early, keep CSP delta minimal and documented.
- R3 - `TerminalHost.tsx` split (P2-4) risks behavior drift if moves are not verbatim. Mitigation: one split per PR, verbatim-first, `rg` plus green gate per PR, no combined move plus fix.
- R4 - Allowlist (P0-2) may break exotic-but-legit terminal links (for example `ftp:`, `vscode://`, custom schemes). Mitigation: allowlist is http, https, mailto, tel (DECIDED section 8 OQ-5; matches the markdown sink plus the shim); extensions require explicit product decision plus test.
- R5 - Dialog-close-kills-PTY (P2-5.5) may destroy tasks users expect to survive. Mitigation: answer OQ-1 before coding P2-5; default to keeping current kill behavior only with explicit confirmation.
- R6 - Flaky `markdown.test.ts` timeout may mask real regressions. Mitigation: rerun isolated (`bunx vitest run <file>`) and record result in each PR.

## 6. Open questions (all DECIDED - see section 8 Decisions)

- OQ-1 - **DECIDED: detach-and-keep-alive** (was: dialog close kills PTY, `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx:237` `void embeddedTerminalKill(sid)` in `onCleanup`) - the dialog is a viewer and must NOT kill the session on close; killing stays behind explicit `onStopTask` only. See section 8, OQ-1. (Unblocks P2-5.5.)
- OQ-2 - **DECIDED: keep `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` separate** (was: fold the 17-line module into `terminal-repaint.ts`?) - distinct WASM-lifecycle responsibility, 2 consumers, stable; add a header comment referencing the 80-line exception. See section 8, OQ-2. (Closes P2-3.)
- OQ-3 - **DECIDED: custom `proposeTerminalDimensions` canonical; single-box padding fix; `fit.fit()`/`proposeDimensions` fallback only** (was: which dims path is canonical, and does the padding math double-count when `target === parent` at `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts:102-108`?) - double-count confirmed, fix to target-only padding. See section 8, OQ-3. (Updates P2-5.1 + P2-5.2 acceptance.)
- OQ-4 - **DECIDED: copy/paste parity - dialog gets copy** (was: dialog paste-only at `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx:150-165` versus host copy+paste at `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx:292-326`?) - add Ctrl+C / Cmd+C selection copy (plus Shift+Insert), unify errors on `console.error`. See section 8, OQ-4. (Resolves P2-5.4 + P2-5.6.)
- OQ-5 - **DECIDED: allow `http`, `https`, `mailto`, `tel`; block the rest day one** (was: strictly http/https/mailto, or are `ftp`, `vscode://` and similar required on day one?) - `ftp`/`vscode` recorded as a future product decision. See section 8, OQ-5. (Sets P0-2 scope; updates R4.)

## 7. Suggested build order (for the orchestrator; NOT to be executed by this spec)

1. P0-1 to P0-2 to P0-3 (each independently testable; P0-2 first if a security release is needed - order within P0 is flexible).
2. P1-1 (verbatim extract, unblocks P1-2 and P1-4) to P1-2 plus P1-4 (together) to P1-3 (Vite and CSP proof).
3. P2-1 to P2-2 to P2-3 to P2-4 (sequential split PRs) to P2-5 decisions batch.
4. Final full gates plus smoke checklist, then land.

---

## 8. Decisions (OQ-1..OQ-5 - all DECIDED 2026-11-08; evidence-based, spec only, no code changed)

This section resolves every open question from section 6 on app-behaviour evidence. No issues landed, no code changed. Each item names full paths, the evidence, and the spec delta the builder follows.

### OQ-1 - DECIDED: detach-and-keep-alive (dialog close must NOT kill the PTY)

- Decision: remove `void embeddedTerminalKill(sid)` from `onCleanup` in `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (line 237). On dialog close, dispose subscriptions and call `term.dispose()` only; the session keeps running. Session killing stays exclusively behind the explicit user action `onStopTask` in `C:\Arbeit\project-vault\src\features\project-detail\model\useProjectTasks.ts`, surfaced in `C:\Arbeit\project-vault\src\features\project-detail\components\TasksTabPanel.tsx` (line 376 `m().onStopTask(session.id)`).

- Evidence: `TaskStreamDialog` / `TaskStreamTerminal` currently has zero callers (`rg TaskStreamDialog` shows only the definition), so the dialog cannot be the task owner. `C:\Arbeit\project-vault\src\features\project-detail\components\TasksTabPanel.tsx` renders tasks as long-running `activeSessions` with explicit stop (`:376`), view via `m().attachToTask` (`:332`), and restart via `restartArgv`; `attachToTask` in `C:\Arbeit\project-vault\src\features\project-detail\model\useProjectTasks.ts` does not take lifecycle ownership while `onStopTask` is explicit. `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx:408-413` only kills when `spawnedByThisEffect` - the dialog has no such spawn, so the symmetric rule is: a viewer never kills. Killing on viewer close would destroy tasks users expect to survive (risk R5).

- Spec delta: P2-5.5 answered (detach-and-keep-alive); final smoke item 5 now means the task survives dialog close and is stoppable only via the Tasks-tab stop action.

- Future guard: if the dialog ever spawns its own PTY in the future, add a `spawnedByThisEffect`-style guard like `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx:408-413` so only the spawner kills.

### OQ-2 - DECIDED: keep `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` separate (do NOT fold)

- Decision: keep the 17-line module as-is; add a short header comment stating the 80-line exception (distinct WASM-lifecycle responsibility: idempotent `initPromise` with reset-on-catch; 2 consumers; stable, no growth planned). Do NOT fold into `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` (246-line cohesive sizing/repaint geometry) or into the new terminal-links module.

- Evidence: `C:\Arbeit\project-vault\src\lib\ghostty-init.ts` owns the WASM load lifecycle (`initPromise` idempotent, reset on catch so a retry reloads); exactly 2 consumers (`C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx:12`, `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx:6`). `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` owns geometry (sizing/repaint, 246 lines). Merging mixes unrelated responsibilities against the one-responsibility-per-file rule; the minimum-viable-module rule expressly allows a justified small module, and growing it artificially to about 80 lines is forbidden by P2-3 itself.

- Spec delta: P2-3 closes via option (b) - kept with written justification referencing the 2-consumer rule plus this decision; `rg ghostty-init src` keeps showing the two import sites. No import churn, no deletion proof needed.

### OQ-3 - DECIDED: custom `proposeTerminalDimensions` canonical; single-box padding; library fit as fallback only

- Decision: the custom `proposeTerminalDimensions` in `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts` is canonical. Fix the padding math to single-box: use the target box only - when `target === parent`, do NOT add `el` padding on top of `parent` padding (`C:\Arbeit\project-vault\src\lib\terminal-repaint.ts:102-108` double-count confirmed against the overlapping box model). Keep `fit.fit()` / `fit.proposeDimensions` (see `applyFitDimensions`, lines 119-136, which prefers custom then `proposeDimensions` then `fit.fit` fallback) strictly as fallback when metrics are unavailable.

- Evidence: `C:\Arbeit\project-vault\src\lib\terminal-repaint.ts:57-65` comment documents the divergence source - `FitAddon` 15px phantom scrollbar plus canvas fixed widths cause the shrink ratchet; `proposeTerminalDimensions` uses the parent when wider/taller to defeat it. Lines 102-108 add `el` padding on top of `parent` padding when `target === parent`, i.e. the same box counted twice.

- Spec delta: P2-5.1 acceptance updated - single-box fix required, then re-measure pixels before and after to prove the ratchet is gone. P2-5.2 acceptance updated - unification means custom-canonical plus library-fallback (not the reverse); record measured pixels. The P2-2 `readBoxPadding` helper (returning `{left,right,top,bottom}`) is the natural home for the single-box read. Resize smoke item 2 verifies no shrinking ratchet.

### OQ-4 - DECIDED: copy/paste parity - dialog gets copy; errors unify on `console.error`

- Decision: bring `C:\Arbeit\project-vault\src\components\task-stream-dialog.tsx` (`:150-165`, currently Ctrl+V paste only) to parity with `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx` (`:292-326`, Ctrl+C copy plus Ctrl+V paste plus `getSelection`/`writeText`). Add copy (Ctrl+C / Cmd+C with selection, Shift+Insert alongside Ctrl+V paste) to the dialog matching the host. Unify clipboard error handling on `console.error` (host idiom, `C:\Arbeit\project-vault\src\components\terminal\TerminalHost.tsx:314-316`); remove the dialog `:161` `.catch(() => {})` swallow.

- Evidence: viewers need copy - task output is read in the dialog and users copy from it; paste-only strands the primary viewer workflow. The host already proves the pattern; if P2-4 extracts a shared clipboard hook or module, both consume it (no-duplicate rule).

- Spec delta: P2-5.4 resolved as parity (not paste-only-by-design); P2-5.6 resolved as `console.error` unification. Final smoke item 3 (in host AND dialog) now asserts copy AND paste in both.

### OQ-5 - DECIDED: allow `http`, `https`, `mailto`, `tel`; block everything else day one

- Decision: `openExternal` in `C:\Arbeit\project-vault\src\lib\open-external.ts` allowlists exactly `http:`, `https:`, `mailto:`, `tel:` (case-insensitive, after trim; reject protocol-relative and leading-control-char tricks). Block `file:`, `data:`, `javascript:`, `vbscript:`, `vscode:`, `ftp:`, bare paths, and whitespace/control-char-prefixed URLs with no-op plus `console.warn` (default warn-only; optional `onError` at call sites per builder). `ftp:` / `vscode:` support is recorded as a future product decision requiring explicit approval plus test - NOT day one.

- Evidence: `C:\Arbeit\project-vault\src\services\markdown.ts:16` and `EXTERNAL_HREF_RE` use `/^(https?:\/\/|mailto:|tel:)/i`; the `C:\Arbeit\project-vault\src\lib\open-external.ts:8` shim allowlists `http/https/mailto`; `C:\Arbeit\project-vault\src\features\project-detail\components\GithubProjectPanel.tsx:238` treats `javascript:` as external in order to block it. `rg` over `src` shows no `vscode://` or `ftp:` usage; `TasksTabPanel` tunnel URLs are `https`. So `http/https/mailto/tel` matches the existing app contract exactly; adding `tel:` over the P0-2 draft (which listed three) aligns the terminal sink with the markdown sink.

- Spec delta: P0-2 fix shape and acceptance now include `tel:` in the allowlist (both the Tauri `openUrl` path and the `window.open` fallback stay behind the same single-home gate - no per-callsite filtering). Risk R4 now names `ftp`/`vscode` as the deferred candidates. Unit test covers allowed (`http`, `https`, `mailto`, `tel`) plus representative blocked (`file`, `data:`, `javascript:`, `vbscript:`, bare path, padded/control-char) schemes.

---

`Spec only - no issues landed, no code changed. Next step is orchestrator APPROVE to planner lands issues per phase, then builder plus tester.`

