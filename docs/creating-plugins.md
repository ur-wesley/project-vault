# Creating Project Vault Plugins

This guide explains how to author, test, and publish Lua (Luau) plugins for Project Vault.

For the runtime API reference, see [plugins.md](./plugins.md).

## Prerequisites

- Project Vault installed (plugins live under the app data `plugins/` directory).
- **`vault.luau`** in `plugins/` — the app **rewrites this file on every launch** from the embedded SDK. Use it for IDE type-checking; do not edit it manually.
- A Luau-aware editor (recommended: Luau Language Server with `plugins/vault.luau` in your workspace).

Hot-reload: editing `init.luau` under a loaded plugin triggers a reload without restarting the app.

## Plugin anatomy

Each plugin is a folder with an **`init.luau`** that returns a table:

```lua
--!strict
local vault = require("vault")

local plugin = {
    name = "My Plugin",
    description = "Does something useful.",
    version = "1.0.0",
    commands = {
        { id = "hello", title = "Say hello", scope = "global" },
    },
}

function plugin.execute(command_id: string, context: any)
    if command_id == "hello" then
        vault.log.info("Hello from my plugin")
    end
end

return plugin
```

Optional fields: `locales`, `config`, `options`, `category`, `get_decorations`, and lifecycle via the `init` command (see [plugins.md](./plugins.md)).

Lazy-loading hooks (usually on `init.luau`, not in the registry):

| Field | Purpose |
|-------|---------|
| `lazy` | Defer loading until a command, key, or event triggers the plugin (default `true` for registry installs) |
| `cmd` | Command ids that load the plugin when invoked |
| `event` | App events (`startup`, `project_focus`, …) that load the plugin |
| `keys` | Keybinding ids that load the plugin |
| `dependencies` | Other plugin ids (or `{ id, repo, dir }` tables) that must load first |
| `externals` | Git-pinned Luau libraries in `plugins/vendor/` (string id or `{ id, repo, main }`) |
| `exports` | Public API table for library plugins (`category = "library"`) |

## Where files live on disk

| Path | Purpose |
|------|---------|
| `plugins/lazy-config.luau` | Your machine: which plugins are enabled, `repo` + `dir` paths |
| `plugins/vault.luau` | App-managed API stubs (overwritten each start) |
| `plugins/repos/<repo-slug>/` | Git clone of a plugin repository |
| `plugins/repos/pv-plugins/harpoon/init.luau` | Example monorepo plugin path |
| `plugins/<id>/init.luau` | Legacy flat install (no `repo` in lazy-config) |

## Single-plugin repository

Layout:

```
my-plugin/
  init.luau
```

Install via **Settings → Plugins → Store** (custom Git URL) or:

`vault://install-plugin?repo=https://github.com/you/my-plugin`

The app clones to `plugins/repos/my-plugin/` and adds a lazy-config entry with `repo` set and no `dir` (plugin at repo root).

## Monorepo (multiple plugins)

Use one Git repository and a root manifest **`plugins.registry.luau`**:

```
my-plugins/
  plugins.registry.luau
  harpoon/init.luau
  mise/init.luau
```

Example **`plugins.registry.luau`** (placement only — metadata lives in each plugin’s `init.luau`):

```lua
--!strict
return {
  { id = "harpoon", dir = "harpoon" },
  { id = "mise", dir = "mise" },
}
```

`dir` may be omitted when it equals `id`. Put `name`, `commands`, `options`, `lazy`, `cmd`, `event`, and `dependencies` in the matching `init.luau`.

On install, the app:

1. Clones the repo to `plugins/repos/<slug>/`
2. Parses `plugins.registry.luau`
3. Merges minimal rows into `lazy-config.luau` (`id`, `repo`, `dir`, `lazy`, `enabled`, plus load hooks copied from each repo’s `init.luau` when present)

Official bundle: [pv-plugins](https://github.com/ur-wesley/pv-plugins).

## `plugins.registry.luau` vs `lazy-config.luau` vs `init.luau`

| File | Responsibility |
|------|----------------|
| `plugins.registry.luau` | Which plugins exist in the repo and their folder names (`id`, optional `dir`) |
| `init.luau` | Authoring surface: `name`, `description`, `version`, `category`, `commands`, `options`, `config`, `locales`, optional `lazy` / `cmd` / `event` / `keys` / `dependencies` |
| `lazy-config.luau` | Installed plugins on this machine: `id`, `repo`, `dir`, `enabled`, `lazy`, and optional load hooks after install — not a substitute for `init.luau` metadata |

On registry update, the app refreshes `repo` and `dir` in lazy-config but **preserves** each plugin’s `enabled` flag. The dashboard and command palette read display metadata from `init.luau` when lazy-config rows are minimal.

## Local development

1. Clone or copy your plugin tree into `plugins/repos/<slug>/` (or use a flat `plugins/<id>/` folder with a hand-written lazy-config entry).
2. Add or update an entry in `plugins/lazy-config.luau` with matching `id`, `repo`, and `dir`.
3. Open **Settings → Plugins** and enable the plugin.
4. Watch the log console while editing `init.luau`.

Reference implementations live in [`pv-plugins`](https://github.com/ur-wesley/pv-plugins), available as a git submodule at `pv-plugins/` in this repository (`git submodule update --init`). Plugin sources are not copied into the app at runtime.

## Publishing

1. Add your plugin folder and an entry to `plugins.registry.luau` (monorepo) or ship a single root `init.luau`.
2. Open a PR to [ur-wesley/pv-plugins](https://github.com/ur-wesley/pv-plugins), or host your own repo and share the Git URL / deep link.

## Plugin and external dependencies

### Depending on another plugin

```lua
dependencies = {
  "telescope",
  { id = "telescope", repo = "https://github.com/ur-wesley/pv-plugins", dir = "telescope" },
}

local telescope = vault.plugin.require("telescope")
telescope.pick_index({ title = "Pick one", items = { ... } })
```

Missing repos with a `repo` field are **auto-installed** on enable. Use `category = "library"` and an `exports` table to ship reusable plugins (see `pv-plugins/telescope/`).

### External Git libraries

```lua
externals = {
  { id = "fuse", repo = "https://github.com/you/luau-fuse", main = "src/init.luau" },
}

local fuse = vault.external.require("fuse")
```

Checkouts live under `plugins/vendor/<id>/`. Pins are stored in auto-generated `vendor-lock.luau` (sync/restore in Settings → Plugins).

### Local modules

Place helpers in `lib/` and use `require("./lib/module")` — no registry entry needed.

## Do not edit

- **`plugins/vault.luau`** — regenerated on each app start.
- **`plugins/.cache/`** — bytecode cache; safe to delete.
- **`plugins/vendor-lock.luau`** — auto-generated external dependency pins.

## Lockfile

Use **Sync Lockfile** in Settings to write `lazy-lock.json` (commit pins per plugin). **Restore Lockfile** checks out pinned commits for shared repo clones.
