# Tasks: Project Vault (MVP → v1)

**PRD:** [`prd-project-vault.md`](./prd-project-vault.md)  
**Spec:** [`FeatureSpecSheet.md`](../FeatureSpecSheet.md)  
**Styleguide:** [`ai/styleguide-tailwind.md`](../ai/styleguide-tailwind.md)

## Relevant Files

- `src-tauri/src/lib.rs` — Tauri app entry, invoke handler registration, SQL migrations registration, session recovery on startup.
- `src-tauri/migrations/*.sql` — Embedded SQL migrations for `plugin-sql`.
- `src-tauri/src/db/*` — Pool helper, location/project/session repositories.
- `src-tauri/src/discovery/*` — Detector registry, walk + skip dirs, `scan_library_location` integration; **monorepo** `package.json` `workspaces` glob expansion (`filter_monorepo_and_outermost`, see `tasks/tasks-monorepo-nested-project-detection.md`).
- `src-tauri/src/main.rs` — Binary entry.
- `src-tauri/tauri.conf.json` — capabilities, allowlists, `beforeDevCommand`, bundle.
- `src-tauri/Cargo.toml` — Rust crates, features.
- `src/index.tsx` — Root render; providers (i18n, QueryClient, event bus context if wrapped).
- `src/App.tsx` — Shell composition (temporary until routed).
- `vite.config.ts` — aliases (`~` → `src`), Solid plugin.
- `tsconfig.json` — paths, strictness.
- `src/lib/utils.ts` — `cn` and shared pure helpers.
- `src/components/ui/*` — Solid UI primitives (domain-agnostic).
- `src/features/library/*` — Library screen, cards, filters (to create).
- `src/features/locations/*` — Location manager UI + actions (to create).
- `src/features/command-palette/*` — Command menu wiring (to create).
- `src/services/*` — Tauri invoke wrappers, DTO mapping, `neverthrow` (to create); `github.ts` (Octokit, README, issues; token from settings).
- `src-tauri/src/commands/github_remote.rs` — resolve GitHub `owner/repo` from project path `.git/config` (origin URL).
- `src/features/project-detail/GithubProjectPanel.tsx` — GitHub-styled Readme (markdown → HTML) and open-issues list.
- `src/types/*` — Shared TS types mirroring Rust DTOs (to create).
- `messages/*.json` or `src/locales/*` — i18n dictionaries (to create).
- `FeatureSpecSheet.md` / `tasks/prd-project-vault.md` — update when scope changes.

### Notes

- **`vitest`** is configured (`bun run test`); Rust tests cover resolution helpers in `src-tauri`. Use **manual QA** from [`docs/RELEASE.md`](../docs/RELEASE.md) per release.
- **`solidui-cli`** on Windows may write under a literal `~` folder; always place components in **`src/components/ui`**.
- After **`npx solidui-cli`**, remove stray **`package-lock.json`**, restore **`packageManager`** and **`bun.lock`**, run **`bun install`**.
- Release notes and QA matrix: [`docs/RELEASE.md`](../docs/RELEASE.md).

## Instructions for Completing Tasks

As you complete each task, change `- [ ]` to `- [x]` in this file.

---

## Tasks

- [x] **1.0** Tauri capabilities and Rust module layout
  - [x] **1.1** Audit `tauri.conf.json` for minimal **FS**, **dialog**, **shell**, **sql**, **store** scopes aligned to library roots only.
  - [x] **1.2** Add Rust modules: e.g. `commands`, `db`, `discovery`, `spawn`, `models` (exact names by convention).
  - [x] **1.3** Define **DTO structs** (serde) for `Location`, `Project`, `Session`, `Task` matching the PRD data model.
  - [x] **1.4** Register all `#[tauri::command]` handlers and map errors to **stable error codes** for the frontend.

- [x] **2.0** SQLite schema and migrations (`plugin-sql`)
  - [x] **2.1** Choose initial schema version table and migration strategy (embedded SQL or migration files).
  - [x] **2.2** Create tables: `locations`, `projects`, `sessions`, `settings` (and join/index as needed).
  - [x] **2.3** Implement **CRUD** for locations and projects in Rust (used by scan and UI).
  - [x] **2.4** Implement session insert/update/query for playtime aggregates.

- [x] **3.0** Pluggable discovery engine (Rust)
  - [x] **3.1** Define a **`ProjectDetector` trait**: `id`, `priority`, `markers`, `detect(path) -> Option<ProjectDraft>`.
  - [x] **3.2** Implement registry that runs detectors in priority order and merges/conflict-resolves duplicates.
  - [x] **3.3** Implement detectors: `package.json`, `go.mod`, `Cargo.toml`, Python trio, `.sln`/`.csproj`, and additional language manifests (registry evolves; manifest-first, not generic Make targets).
  - [x] **3.4** Implement **scan root** command: walk allowed roots, respect `.gitignore`-style skips if spec’d, write to DB.
  - [x] **3.5** Handle **long paths**, **symlinks**, and **permission errors** without crashing the scan.

- [x] **4.0** Runtime resolution and mise integration
  - [x] **4.1** Implement **“resolve environment”** for a project path: detect mise config; if `mise` on PATH, build prefix e.g. `mise exec -- <cmd>`; else fallback.
  - [x] **4.2** Document supported fallbacks (`.nvmrc`, `engines`, `go` directive) in README or `docs/`.
  - [x] **4.3** Unit-test or integration-test resolution on sample fixture folders (optional when test runner exists).

- [x] **5.0** Process spawn and CLI opener
  - [x] **5.1** Implement **spawn task** command: structured argv, cwd, env injection from resolution layer.
  - [x] **5.2** Implement **open interactive shell** using `plugin-shell` / OS defaults; respect user shell preference from settings.
  - [x] **5.3** Add **confirmation** for first-time run or high-risk scripts (per security baseline).

- [x] **6.0** Frontend foundation (Solid)
  - [x] **6.1** Add folder structure: `features/`, `services/`, `types/`, `messages/` (or `locales/`).
  - [x] **6.2** Wire **`@solid-primitives/i18n`**: default locale, message files, provider at root.
  - [x] **6.3** Wire **`@solid-primitives/event-bus`**: typed channels for `scan:complete`, `project:opened`, `session:started`, `session:ended`.
  - [x] **6.4** Wire **`@solid-primitives/keyboard`**: global shortcut registry with cleanup on route change.
  - [x] **6.5** Configure **TanStack Query** for invoke wrappers in `services/` (typed `queryKey`s).

- [x] **7.0** Tauri ↔ frontend services
  - [x] **7.1** Implement `services/tauri.ts` (or per-domain) with **`neverthrow`** `ResultAsync` from invoke results.
  - [x] **7.2** Map Rust errors to user-facing i18n keys (no raw panics in UI).
  - [x] **7.3** Add **location** service: list/add/remove/update/reorder locations via commands.

- [x] **8.0** Library UI (MVP)
  - [x] **8.1** Build **library page** composing `components/ui` only (cards, badges, inputs per styleguide).
  - [x] **8.2** Implement **search** (client-side index or command-backed) and **filters** (favorites, recent, location, runtime).
  - [x] **8.3** Implement **project card**: primary action, task dropdown, favorite toggle, playtime display.
  - [x] **8.4** Empty/loading/error states with i18n keys.

- [x] **9.0** Command palette (`command` / cmdk)
  - [x] **9.1** Compose **`CommandDialog`** / **`Command`** from `src/components/ui/command.tsx`.
  - [x] **9.2** Register **global shortcut** (e.g. `Ctrl+K` / `Cmd+K`) via `@solid-primitives/keyboard`.
  - [x] **9.3** Feed palette with **projects**, **actions** (rescan, settings, open location), and **recent** items from event bus or query cache.

- [x] **10.0** Location manager UI
  - [x] **10.1** Dialog or dedicated view to add/remove/rename roots using **`plugin-dialog`** folder picker from Rust command.
  - [x] **10.2** Trigger **rescan** after location changes; emit `scan:complete` on event bus.

- [x] **11.0** New project wizard
  - [x] **11.1** Define **template config format** (JSON/Zod on TS side; mirror in Rust for execution).
  - [x] **11.2** Ship **1–2 bundled templates** (e.g. Bun + Node) end-to-end.
  - [x] **11.3** Rust command: materialize files, run post-create hooks with user confirmation.

- [x] **12.0** Dev time tracking (MVP)
  - [x] **12.1** On task launch / shell open: **start session** in Rust; on process exit or explicit stop: **end session**.
  - [x] **12.2** UI: show **total time** on card and **simple history** (list or modal).
  - [x] **12.3** Define behavior on **app crash** (orphan session close on next launch).

- [x] **13.0** Settings and persistence polish
  - [x] **13.1** Settings store: shell path, idle timeout (if any), UI density, default scan interval.
  - [x] **13.2** **Export** library config + optional DB backup (manual command or menu).

- [ ] **14.0** GitHub enrichment (phase 2 — optional milestone)
  - [x] **14.1** `owner/repo` from git `origin` (Rust) + token in app settings; README/issues via **Octokit** in the frontend.
  - [x] **14.2** Settings: PAT for private/limits; rate limit / 403 in i18n; **no token** in logs.
  - [ ] **14.3** Optional badges on card (last commit, open PR count) behind feature flag.

- [x] **15.0** Release hardening
  - [x] **15.1** **Tauri updater** manifest placeholders and code signing notes.
  - [x] **15.2** Manual **QA matrix**: Windows + macOS (Linux if supported): scan, launch, shell, palette, i18n switch.
  - [x] **15.3** Update **Feature Spec** / PRD if MVP boundaries changed during implementation.
