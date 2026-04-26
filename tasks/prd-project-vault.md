# Product Requirements Document: Project Vault

**Source:** Derived from [`FeatureSpecSheet.md`](../FeatureSpecSheet.md) (authoritative product/architecture spec).  
**Audience:** Junior developers and contributors.  
**Stack:** Tauri 2 (Rust) + SolidJS + SQLite (`plugin-sql`), local-first desktop app.

---

## 1. Introduction / Overview

**Project Vault** is a desktop application that acts like a **personal Steam library for local codebases**. Developers add one or more **library roots** (folders); the app **discovers projects**, shows them in a polished **library UI**, and lets users **launch tasks**, **open shells**, **create projects from templates**, and **track active dev time** per project.

**Problem it solves:** Jumping between File Explorer, multiple terminals, and ad hoc scripts to find and run the right project is slow and fragmented. Project Vault centralizes **browsing**, **running**, and **lightweight time awareness** in one offline-capable app.

**Goal:** Ship an MVP that feels like a **library-first** experience (search, favorites, recents) with **correct runtime and task detection**, then grow modularly (more languages, GitHub enrichment, advanced reporting).

---

## 2. Goals

1. **G1 — Library-first UX:** Users can browse all discovered projects from configured roots with search, filters, favorites, and recents without manual path entry for each project.
2. **G2 — Accurate discovery:** Projects are detected via a **pluggable detector** model (not one giant hardcoded scanner), with MVP coverage for JS/TS, Go, Python, .NET, and common automation markers (`justfile`, `Makefile`) as defined in the feature spec.
3. **G3 — Reliable launch:** Users can run a **default or selected task** and open an **interactive CLI** in the project directory, with **mise-first** runtime orchestration when available and documented fallbacks.
4. **G4 — Time awareness:** Users see **per-project active dev time** (sessions, totals) with clear start/stop semantics and room for idle handling and export later.
5. **G5 — Modular architecture:** New detectors, integrations, and UI features can be added with **minimal changes to core** (Rust commands + typed DTOs, `features/*`, event bus).
6. **G6 — Safe and local:** **Offline-first**; no required cloud. **Secrets** (e.g. GitHub tokens) only in **OS secure storage** from Rust, not the webview.

---

## 3. User Stories

1. **US1:** As a developer, I want to **add multiple library folders** and enable/disable them so I can mirror how I organize disks or clients.
2. **US2:** As a developer, I want to **see all projects** in a visual grid/list with **search and filters** (favorites, recent, location, runtime) so I can find a repo quickly.
3. **US3:** As a developer, I want to **launch the right task** (e.g. `dev`, `test`) from a card so I don’t have to remember package manager or script names.
4. **US4:** As a developer, I want to **open a terminal** already `cd`’d to the project with the right tool versions (via **mise** when configured).
5. **US5:** As a developer, I want to **create a new project from a template** so bootstrapping is repeatable.
6. **US6:** As a developer, I want to **see how long I’ve worked** on each project (and recent sessions) so I can track focus over time.
7. **US7:** As a developer, I want a **command palette** (keyboard-driven) to jump to projects and actions quickly.
8. **US8:** As a developer in a non-English locale, I want **i18n-ready UI** so strings can be translated consistently.

_(GitHub linking and API enrichment are **post-MVP** unless explicitly pulled forward; see Non-Goals.)_

---

## 4. Functional Requirements

1. **FR1 — Locations:** The system must allow users to **add, remove, rename, reorder, enable/disable**, and designate a **default** library root; paths must be validated and scoped for FS access per Tauri capabilities.
2. **FR2 — Discovery scan:** The system must **scan** enabled roots and produce a **project index** with name, path, `locationId`, detected **type**, **runtime hints**, **tasks**, and metadata needed for cards.
3. **FR3 — Pluggable detectors:** The system must implement a **detector registry** interface so new stacks register **marker files**, **priority**, and **parse/extract** logic without modifying a single monolithic scanner.
4. **FR4 — MVP detectors:** The system must ship detectors for at least: `package.json` (JS/TS/Bun/Deno hints), **`go.mod`**, **`Cargo.toml`**, Python (`pyproject.toml` / `requirements.txt` / `Pipfile`), `.sln`/`.csproj`, `justfile`, `Makefile` (and optionally `CMakeLists.txt` as spec allows).
5. **FR5 — Runtime resolution:** The system must resolve runtimes with **mise preferred** when project declares tools (`.mise.toml` / `.tool-versions`) and mise is available; otherwise fall back to PATH and ecosystem files (`.nvmrc`, `engines`, `go` directive, etc.).
6. **FR6 — Library UI:** The system must display projects in a **primary library view** with search (name, path, tags/stack), filters (favorites, recent, runtime, location), and project **cards** showing fields from the spec (name, type, runtime, favorite, primary action, tasks, playtime, last opened).
7. **FR7 — Favorites & recents:** The system must persist **favorite** and **last opened** (and update recents on open/launch).
8. **FR8 — Task launch:** The system must let users run a **selected task** or **default run** using safe, structured invocation from the Rust side (no string-concat injection).
9. **FR9 — CLI spawn:** The system must open an **interactive shell** in the project directory via Tauri **shell/process** plugins with user-configurable shell where the platform allows.
10. **FR10 — New project wizard:** The system must support **config-driven templates** that define files, runtime, starter tasks, and optional post-create actions.
11. **FR11 — Dev time tracking:** The system must record **sessions** (start/end, project, command, optional idle flag) and show **per-project totals** and basic history in MVP.
12. **FR12 — Command palette:** The system must provide a **global command palette** using Solid UI **`command`** (cmdk) for navigation and actions, with shortcuts managed via **`@solid-primitives/keyboard`**.
13. **FR13 — Cross-feature events:** Features must communicate via **`@solid-primitives/event-bus`** for events such as scan complete, project opened, session started/stopped (typed payloads).
14. **FR14 — i18n:** User-visible strings in feature code must go through **`@solid-primitives/i18n`** (locale dictionaries, switching).
15. **FR15 — Persistence:** The system must persist locations, settings, project index, and sessions using **`plugin-sql`** (preferred) and **`plugin-store`** for non-secret prefs; schema must be **versioned/migrated**.
16. **FR16 — Rescan:** The system must support **manual rescan** and a defined strategy for **periodic or watcher-based** refresh (exact timing can be phased).
17. **FR17 — Security baseline:** The system must enforce **path allowlists**, confirm destructive or high-risk operations, and **never** store GitHub tokens in webview storage.

---

## 5. Non-Goals (Out of Scope for MVP)

1. **NG1 — Required GitHub:** No requirement to sign in to GitHub to use the library, launch, or track time.
2. **NG2 — Full IDE:** Not replacing VS Code/JetBrains; no debugger, LSP, or full git merge UI in MVP.
3. **NG3 — Cloud sync:** No mandatory sync of library config or playtime to a server in MVP.
4. **NG4 — Arbitrary plugin marketplace:** User-supplied detector plugins may be **future**; MVP is **in-repo** detectors + registry pattern.
5. **NG5 — Perfect idle detection:** Advanced OS idle heuristics may be phased; MVP defines clear **session start/stop** and optional simple idle timeout.
6. **NG6 — Full monorepo UX:** Workspace/multi-package visualization may be **deferred**; MVP may treat one folder as one card with documented limitations.

---

## 6. Design Considerations

- **Visual language:** Steam-like dark library; follow [`ai/styleguide-tailwind.md`](../ai/styleguide-tailwind.md) (Tailwind tokens, `components/ui`, Kobalte/solid-ui, MDI `i-mdi-*`, accessibility).
- **Navigation:** Sidebar + library grid/list; **command palette** for power users.
- **States:** Loading, empty library, scan errors, and “no runtime found” must be explicit and translatable.
- **Components:** Reuse Solid UI primitives (`sidebar`, `tabs`, `card`, `command`, `dialog`, etc.); **no business logic** inside `components/ui`.

---

## 7. Technical Considerations

- **Frontend:** SolidJS; TanStack Query for async/command patterns; **`neverthrow`** at service boundaries per styleguide.
- **Backend:** Tauri commands for FS, DB, process spawn, secure token storage (future GitHub).
- **Plugins:** Map features to `plugin-fs`, `plugin-dialog`, `plugin-shell`, `plugin-process`, `plugin-sql`, `plugin-store`, `plugin-opener`, `plugin-os` as in the feature spec.
- **GitHub (phase 2+):** Prefer Rust + REST; Octokit only if strictly bounded; fine-grained PATs; rate limit UI.
- **Cross-platform:** Test **UNC/long paths**, symlinks, and **WSL vs native** shell preference on Windows.
- **Distribution:** Plan for **Tauri updater** and signed builds when releasing publicly.

---

## 8. Success Metrics

| Metric                 | Target (MVP)                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Discovery accuracy** | ≥ 95% of “obvious” projects under test roots correctly classified for supported markers          |
| **Launch success**     | Default task or shell opens without manual path fix on clean machines with declared tooling      |
| **Performance**        | Library usable with **500+** indexed projects without UI lockups (virtualized or paged list)     |
| **Reliability**        | No data loss on normal quit; sessions recover or close cleanly after crash (documented behavior) |
| **Adoption signal**    | Internal dogfood: primary workflow for daily project switching for core contributors             |

_(Quantitative product metrics can be added post-launch with opt-in telemetry only.)_

---

## 9. Open Questions

1. **MVP GitHub:** Is **any** GitHub read-only metadata (e.g. open repo in browser only) required for MVP, or strictly phase 2?
2. **Monorepo:** For MVP, is **one-card-per-root-folder** acceptable for `pnpm`/`nx` workspaces, or is a minimal **workspace child** list required?
3. **Template authoring:** Are templates **bundled only** in MVP, or must users add **custom template paths**?
4. **Session semantics:** Is **single active session per project** enforced globally, or can multiple tasks overlap with separate timers?
5. **mise bundling:** Should the app **detect-only** mise on PATH, or **optionally install/bootstrap** mise (likely out of scope)?

---

## Document history

| Version | Date       | Notes                               |
| ------- | ---------- | ----------------------------------- |
| 1.0     | 2026-04-25 | Initial PRD from Feature Spec Sheet |
