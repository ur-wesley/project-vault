# Project Vault — Feature Spec Sheet

Project Vault is a **Tauri + SolidJS** desktop launcher for software projects that behaves like a personal Steam library for codebases. It organizes projects across multiple library roots, auto-detects runtimes and task files, spawns project-specific CLI sessions, and tracks dev time like playtime.

## Product goal

The goal is to give developers a single place to browse, start, and manage local projects without opening folders, terminals, and separate task runners manually. The app should feel like a polished library UI first, and a developer control center second.

## Architecture principles

- **Modular and expandable**: features, discovery, runtimes, and integrations are composed from **small, replaceable modules** with stable interfaces (Rust commands + typed DTOs, frontend `features/*` + `services/*`). New behavior should be addable without rewriting the core library or shell.
- **Pluggable discovery**: project detection is **not a single hardcoded scanner**—it is an **extensible detector registry** (e.g. register handlers by marker files or directories). Core ships common detectors; additional stacks (**Go** via `go.mod`, **Rust** via `Cargo.toml`, **Python** via `pyproject.toml` / `requirements.txt`, **Java** via `pom.xml` / Gradle, **Elixir**, **PHP**, etc.) are added as modules or user-supplied plugins over time.
- **Opinionated toolchain**: standardize on **[mise](https://mise.jdx.dev/)** (formerly rtx) as the **preferred** way to resolve and activate language/runtime versions when spawning shells and tasks—single config surface (`.mise.toml` / `.tool-versions`), fewer ad hoc per-language rules. The app may still read `.nvmrc`, `go.mod` `go` directive, etc., but **mise is the default orchestration story** when present; document fallbacks when mise is not installed.
- **Command palette (cmdk)**: global **command menu** using Solid UI’s **`command`** primitive (built on **`cmdk-solid`**) for search, navigation, and actions—consistent with Steam-style “hit a shortcut and go.”
- **Internationalization**: use **`@solid-primitives/i18n`** for locale dictionaries, switching, and reactive translations; avoid hardcoded user-facing strings in feature code where a key belongs in messages.
- **Cross-feature events and shortcuts**: use **`@solid-primitives/event-bus`** (or equivalent) for a **typed in-app event bus** (e.g. project opened, scan completed, session started) so features stay decoupled. Use **`@solid-primitives/keyboard`** for **global and scoped keyboard shortcuts** (command palette, sidebar toggle, navigation)—centralize registration and cleanup.

## Primary user stories

- I can add multiple library paths and switch between them like Steam library folders.
- I can see all discovered projects in a visual library with search, filters, favorites, and recent activity.
- I can launch a project with the correct runtime or task command automatically.
- I can open a CLI already pointed at the project directory.
- I can create a new project from a template such as Bun, C# ASP.NET, or a Justfile-driven app.
- I can see how much time I have spent actively working in each project.

## Core modules

### 1. Library system

The library is the main screen and the central organizing model. It shows all projects discovered from configured roots, grouped by location, type, favorite state, and recent use. Steam’s library update emphasizes a strong home/library experience with organization and quick access, which maps well to this product.

### 2. Location manager

Users can configure multiple project roots, each treated as a library location. Examples include `D:\Code`, `E:\Labs`, a client-work drive, or a network share. Each location can be enabled, renamed, reordered, and scanned independently.

### 3. Project discovery

The app scans each library root for recognizable project markers and builds project cards automatically. Detection is **extensible**: each **detector** advertises markers (files or directories), priority, and how to derive **type**, **tasks**, and **runtime hints**.

Built-in targets should include at least:

- JavaScript/TypeScript: `package.json`, Bun/Deno hints.
- **Go**: `go.mod` (module path, Go version directive).
- Rust: `Cargo.toml`.
- Python: `pyproject.toml`, `requirements.txt`, `Pipfile`.
- .NET: `.sln`, `.csproj`.
- C/C++ and automation: `Makefile`, `justfile`, `CMakeLists.txt` (as needed).

Additional languages and custom rules are added by **new detector modules** or a future **plugin contract**, not by monolithic `if/else` in one scanner.

### 4. Runtime detection

For JavaScript projects, the app should auto-detect the best runtime and launch method. A good default is: Bun if Bun-specific metadata exists, Node if `package.json` scripts are present, and Node version selection via `.nvmrc` or an engines field when available.

**mise** should be the **opinionated default** for resolving tool versions: when the user has mise installed and a project declares tools (`.mise.toml`, `.tool-versions`), spawned shells and non-interactive runs should prefer **`mise exec`** (or equivalent) so Node, Go, Python, Ruby, etc. align with one toolchain. If mise is absent, fall back to PATH and per-ecosystem files (`.nvmrc`, `go.mod` `go` line, etc.).

### 5. Task launcher

Each project card should expose the most relevant tasks found in its config. For example, npm scripts can be executed through `npm run <stage>`, while `just` recipes and `.NET` commands can be launched as project-specific actions.

### 6. CLI spawner

The app should be able to spawn a terminal session rooted in the selected project. In Tauri this should use the platform’s process/shell capabilities so the project path and command environment are correct.

### 7. New project wizard

The app should include a “New Project” flow with templates. Templates can prefill folder structure, runtime choices, starter scripts, and common commands for Bun, ASP.NET, Node, or Justfile-based projects.

### 8. Dev time tracking

The app should track active dev time per project in a Steam-like way. It can measure time while a project session, CLI, or task runner is active, then show totals by day, week, month, and all time. Developer time-tracking tools commonly focus on per-project totals and reporting, which supports this feature as a practical addition rather than a gimmick.

## Functional requirements

| Area              | Requirement                                              | Notes                                                                     |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Library roots     | Add, remove, rename, and switch locations.               | Similar to Steam library folder behavior.                                 |
| Discovery         | Scan selected roots for projects automatically.          | **Pluggable detectors**; core markers + expandable (Go, Rust, Python, …). |
| Search            | Search by project name, stack, commands, tags, and path. | Must be instant and local.                                                |
| Filters           | Filter by favorites, recent, runtime, and location.      | Library-first navigation.                                                 |
| Launch            | Start the selected task or default run command.          | Use detected scripts or template defaults.                                |
| CLI spawn         | Open an interactive shell in the project directory.      | Support user-defined shell preference.                                    |
| New project       | Create projects from templates.                          | Template should define runtime and starter commands.                      |
| Time tracking     | Track active project session duration.                   | Show per-project totals and recent sessions.                              |
| Runtime detection | Detect JS runtime and version hints.                     | Prefer **mise** when available; else `.nvmrc`, engines, `go.mod`, etc.    |

## Project card fields

Each project should expose the following data in the library:

- Name.
- Location/root path.
- Project path.
- Detected type.
- Detected runtime.
- Status, such as ready, paused, or testing.
- Favorite state.
- Primary action.
- Available tasks.
- Tags and stack labels.
- Total dev time.
- Last opened time.

## Template system

Templates should be configuration-driven rather than hardcoded. Each template should define a starter structure, a runtime command, task presets, file markers, and optional post-create actions.

Recommended starter templates:

- Simple Bun project.
- Node package.json app.
- C# ASP.NET app.
- Justfile automation project.
- Makefile-driven tool.
- Rust or Tauri app template.

## Time tracking rules

Time tracking should only count when the user is actively engaged with a project. The best default behavior is to start timing when a project card is launched, a CLI session is opened, or a task is run, and stop timing when the project session closes or becomes inactive.

Tracking should support:

- Session start and end timestamps.
- Total accumulated time.
- Daily and weekly summaries.
- Optional idle timeout.
- Manual edit or correction.
- Exportable history.

## Technical architecture

### Frontend

- SolidJS for the UI layer and state management.
- Fine-grained reactive signals for project lists, locations, filters, selected project, and live session timers. SolidJS signals are built for this kind of responsive local state.
- **UI conventions** are defined in [`ai/styleguide-tailwind.md`](./ai/styleguide-tailwind.md): Solid + Tailwind, `components/ui` (solid-ui / Kobalte primitives), TanStack Query for async state, `neverthrow` + typed errors at service boundaries, MDI via `i-mdi-*`, accessibility, and import boundaries (`components/ui` stays domain-agnostic; feature logic lives under `features/*`). New screens and refactors should follow that document.
- **Command palette**: Solid UI **`command`** component ([registry name `command`](https://www.solid-ui.com)), backed by **`cmdk-solid`**, for global quick actions, project jump, and palette-driven workflows.
- **i18n**: **`@solid-primitives/i18n`** for all user-visible copy and locale switching.
- **Event bus**: **`@solid-primitives/event-bus`** for decoupled feature-to-feature notifications (keep payloads typed and small).
- **Keyboard**: **`@solid-primitives/keyboard`** for shortcut registration, conflict avoidance, and teardown on route or scope changes.

### Desktop shell

- Tauri for the native app container and process interaction.
- Use Tauri process/shell capabilities to spawn commands and terminal-like workflows.

### Tauri plugins (planned / in-repo alignment)

The stack targets **Tauri 2** with first-party plugins mapped to product areas. Capabilities and allowlists in `tauri.conf.json` / Rust must stay minimal (paths, URLs, shell scope).

| Plugin / integration               | Role for Project Vault                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@tauri-apps/plugin-fs`**        | Scoped reads for discovery (library roots), optional writes for templates / generated files; must respect user-configured roots, not arbitrary disk. |
| **`@tauri-apps/plugin-dialog`**    | Pick library folders, save/export paths, confirm destructive actions.                                                                                |
| **`@tauri-apps/plugin-shell`**     | Open external terminals or delegated shell commands with explicit allowlist.                                                                         |
| **`@tauri-apps/plugin-process`**   | Managed child processes where needed (non-interactive helpers); pair with shell for interactive CLIs.                                                |
| **`@tauri-apps/plugin-sql`**       | Local SQLite (or similar) for project index, sessions, playtime aggregates, and cached metadata.                                                     |
| **`@tauri-apps/plugin-store`**     | App settings, window state, feature flags; **not** for long-lived secrets unless combined with OS secure storage patterns.                           |
| **`@tauri-apps/plugin-opener`**    | Open repo URLs, docs, “reveal in Explorer/Finder”.                                                                                                   |
| **`@tauri-apps/plugin-os`**        | Platform-specific defaults (shell path, path separators, OS labels in UI).                                                                           |
| **`@tauri-apps/plugin-autostart`** | Optional “launch at login” for users who want the tracker always available.                                                                          |
| **`tauri-plugin-clipboard-api`**   | Copy project paths, branch names, or share snippets; avoid placing tokens on the clipboard.                                                          |

### GitHub integration

- **API client**: use **[Octokit](https://github.com/octokit/octokit.js)** (`octokit` on the frontend or, preferably, thin **Rust commands** that call the GitHub REST API so tokens and rate-limit handling stay out of untrusted webview context). The spec assumes REST v3 for repos, commits, branches, PRs, and optional releases; GraphQL can be a later optimization.
- **Product use cases** (incremental): link a local project folder to a `owner/repo` (or detect `origin` from `.git/config`); show **default branch**, **ahead/behind** or last-known **commit SHA** on cards; **open in browser**; optional **issue/PR counts** or “activity” badges; optional **release** hint for version; **template repos** for “New project from GitHub template”.
- **Local-first**: all core launcher features work **without** GitHub; GitHub is an enrichment layer and must degrade gracefully when offline or unauthenticated.

### Authentication (GitHub)

- **No shared “app account”**: each user brings their own identity. Support **GitHub OAuth App** (desktop flow: loopback or manual code entry) and/or **personal access tokens (classic or fine-grained)** with documented minimum **scopes** (e.g. `repo` only if private repo metadata is needed; `public_repo` or read-only where possible).
- **Token storage**: persist credentials via **OS-backed secure storage** (e.g. **keychain / Credential Manager**) from the **Rust side**, not `localStorage`. `plugin-store` may hold non-secret prefs only. Never log tokens; redact in error reports.
- **UX**: clear “Sign in to GitHub” / “Disconnect”; show effective scopes; handle **401/403** and **rate limit** (remaining requests, retry-after) in UI.
- **Security**: all GitHub requests that carry auth should originate from **trusted Rust commands** or a dedicated minimal helper; the webview should receive only **sanitized** DTOs. Validate redirect URLs for OAuth. Document threat model: stolen token = GitHub account risk; encourage fine-grained PATs with least privilege.

### Data layer

- Local config file for locations, templates, settings, and runtime preferences.
- Local index database or JSON store for projects, sessions, and dev-time history (**`plugin-sql`** is the preferred primary store for structured data at scale).
- File watcher or periodic rescan for discovery refresh.

### Process model

- Tauri backend handles process spawning, runtime resolution, and path management.
- SolidJS frontend renders library cards, search, filters, and session state.
- Events update the UI when a project launches, closes, or accumulates time.

## Non-functional requirements

- Fast startup.
- Offline-first operation.
- Cross-platform support.
- Local-only by default, with no cloud dependency.
- Minimal friction for launching shells and tasks.
- Safe handling of command execution and path resolution.
- Responsive library browsing even with many projects.
- **Security**: path and command allowlists; no arbitrary execution from untrusted project configs without user confirmation; GitHub tokens only in secure storage; sanitize anything rendered from API or repo metadata.
- **Updates**: plan for **Tauri updater** / signed builds once distribution starts.

## Cross-cutting concerns (easy to overlook)

- **UNC paths, long paths, and symlinks** on Windows when indexing and spawning shells.
- **WSL vs native** shells: user preference and which path format each tool expects.
- **Monorepos and workspaces**: one folder may represent many packages; discovery rules may need “primary package” or multi-card semantics.
- **Time-tracking edge cases**: crash mid-session, sleep/hibernate, duplicate launches, clock skew; define whether idle detection uses OS input APIs or heuristic only.
- **SQLite migrations**: version the schema from day one if `plugin-sql` is the source of truth.
- **Backup / export**: library config + DB export so users are not locked in.
- **Telemetry**: default off; if ever added, explicit opt-in and documented data shape.

## Data model

### Location

- id
- name
- path
- enabled
- default

### Project

- id
- name
- locationId
- path
- type
- runtime
- status
- tags
- tasks
- favorite
- lastOpened
- totalPlaytime
- activeSessionId

### Session

- id
- projectId
- startedAt
- endedAt
- duration
- command
- idleTimeoutApplied

### Template

- id
- name
- kind
- runtime
- filesToCreate
- scripts
- postCreateActions

## MVP scope

The first usable version should include:

- One polished library screen and a **project detail** view (file tree, tasks, terminal opener, session history).
- Multiple library locations and **outermost-only** discovery (monorepo root wins over nested package folders).
- Project discovery driven by **manifest-style markers** (e.g. `package.json`, `go.mod`, `Cargo.toml`, and expanded language detectors); ad-hoc build files alone are not treated as project roots.
- JS/runtime detection with **mise-first** fallback chain.
- **Command palette** (`command` / cmdk) wired to navigation, rescan, settings, and **new project** wizard.
- CLI spawning and interactive shell (OS-appropriate, Windows Terminal when available).
- **New project** wizard with bundled templates (e.g. Bun + TypeScript, Node + TypeScript) and optional post-create install.
- Basic **work time** tracking (sessions, aggregates, orphan recovery on launch).
- Favorites, filters, and search.
- Settings: shell path, UI density, optional **periodic rescan** interval; idle timeout stored for future session auto-end behavior.
- Export library snapshot JSON.

Phase 2 (not MVP): **GitHub** enrichment behind explicit token storage and UI (see Future enhancements).

## Future enhancements

- Background automatic scan on startup.
- Per-project environment variables.
- Git status badges.
- Recent branch or commit display.
- Cover art and icons for projects.
- Workspace grouping.
- Plugin system for custom detectors.
- Cloud sync for library config, if ever needed.
- Exportable playtime reports.
- **GitHub**: multiple accounts; org/team context; stale cache and refresh policy; optional **Dependabot** / security advisory surfacing for linked repos.
- **Git**: submodule and **Git LFS** awareness in “project health” or size hints.

## Product positioning

Project Vault should be described as a **local project launcher and tracker** that combines the convenience of a game library with the practical needs of development workflows. Its strongest differentiators are multi-root project management, auto-detected commands, runtime awareness, and time tracking in one desktop app.
