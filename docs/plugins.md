# Lua Plugin System Documentation

The `project-vault` application features a dynamic runtime Luau plugin system. Plugins are installed from Git repositories (not bundled inside the app binary). Official plugins: [pv-plugins](https://github.com/ur-wesley/pv-plugins). For local development, official plugin sources are checked out as a git submodule at `pv-plugins/` (`git submodule update --init`).

**Authoring guide:** [creating-plugins.md](./creating-plugins.md)

---

## 1. Plugin Structure

Plugins are loaded from paths declared in `<app_data_dir>/plugins/lazy-config.luau`:

- **Monorepo:** `plugins/repos/<repo-slug>/<dir>/init.luau` (install from a repo with `plugins.registry.luau` at the root)
- **Single-plugin repo:** `plugins/repos/<repo-slug>/init.luau`
- **Legacy flat:** `plugins/<id>/init.luau` when no `repo` is set in lazy-config

Each plugin is defined by **`init.luau`** returning a table with metadata, commands, and an `execute` hook.

Monorepo repos ship a root **`plugins.registry.luau`** with placement entries only (`id` and optional `dir`). Commands, options, config, and lazy-load hooks belong in each plugin’s `init.luau`. After Git install, **`lazy-config.luau`** stores paths and enablement (`id`, `repo`, `dir`, `enabled`, `lazy`, …), not full plugin metadata.

`vault.luau` in the plugins folder is **refreshed on every app start** for IDE types; do not edit it manually.

### Example `init.lua`
```lua
local plugin = {
    name = "My Custom Plugin",
    description = "Allows you to perform custom workspace operations.",
    version = "1.0.0",
    locales = {
        en = {
            name = "My Custom Plugin",
            description = "Allows you to perform custom workspace operations.",
            ["command.run_custom_action"] = "Run Custom Vault Action"
        },
        de = {
            name = "Mein benutzerdefiniertes Plugin",
            description = "Ermöglicht das Ausführen benutzerdefinierter Aktionen.",
            ["command.run_custom_action"] = "Benutzerdefinierte Aktion ausführen"
        }
    },
    commands = {
        {
            id = "run_custom_action",
            title = "Run Custom Vault Action",
            scope = "global" -- Can be 'global' or 'project'
        }
    }
}

-- Entry hook executed when a command is triggered
function plugin.execute(command_id, context)
    if command_id == "run_custom_action" then
        vault.log.info("Custom action triggered for project: " .. tostring(context.projectId))
        
        local val = vault.ui.show_input_box({
            title = "Enter a Value",
            placeholder = "Type anything..."
        })
        
        if val then
            vault.log.info("User input value: " .. val)
        end
    end
end

return plugin
```

---

## 2. Global `vault.*` APIs

The application exposes the global `vault` table to Lua. All async Rust calls are handled transparently, allowing clean, single-threaded coroutine flow control in your scripts.

### 2.1 Logging (`vault.log`)
Streams logs directly into the real-time Plugins Log Console in the Settings UI:
* **`vault.log.info(message: string)`**: Logs an informational message.
* **`vault.log.error(message: string)`**: Logs an error message.

### 2.2 File System (`vault.fs`)
Allows interaction with the local filesystem:
* **`vault.fs.read_file(path: string) -> string`**: Reads a text file's contents.
* **`vault.fs.write_file(path: string, content: string)`**: Writes content to a text file.
* **`vault.fs.exists(path: string) -> boolean`**: Checks if a path exists.
* **`vault.fs.is_dir(path: string) -> boolean`**: Checks if a path is a directory.
* **`vault.fs.is_file(path: string) -> boolean`**: Checks if a path is a regular file.
* **`vault.fs.list_dir(path: string) -> table`**: Returns a list of absolute paths of files and directories within a folder.

### 2.3 JSON & TOML Serializers (`vault.json`, `vault.toml`)
Since mlua handles structured serialization, simple JSON/TOML parsers are available:
* **`vault.json.parse(json_str: string) -> table`**: Parses a JSON string into a Lua table.
* **`vault.json.stringify(table: table) -> string`**: Serializes a Lua table into a JSON string.
* **`vault.toml.parse(toml_str: string) -> table`**: Parses a TOML string into a Lua table.
* **`vault.toml.stringify(table: table) -> string`**: Serializes a Lua table into a TOML string.

### 2.4 Projects Database (`vault.projects`)
Retrieve the status of all active projects in the vault:
* **`vault.projects.list() -> string`**: Returns a serialized JSON list of all active projects. Cleanly parse this table using:
  ```lua
  local projects = vault.json.parse(vault.projects.list())
  for _, project in ipairs(projects) do
      vault.log.info("Project: " .. project.name .. " located at " .. project.path)
  end
  ```

### 2.5 Scoped Settings Storage (`vault.settings`)
Store and retrieve persistent configuration values. Storage keys are automatically isolated under the plugin's namespace (`plugin:<plugin_id>:<key>`):
* **`vault.settings.get(key: string) -> string | nil`**: Retrieves a saved string option.
* **`vault.settings.set(key: string, value: string)`**: Saves a string configuration value.

### 2.6 Theming & Stylesheet Injection (`vault.theme`)
Build custom style overrides:
* **`vault.theme.get_mode() -> string`**: Returns the current application theme mode (`"dark"` or `"light"`).
* **`vault.theme.inject_css(css: string)`**: Dynamically injects a CSS stylesheet into the application webview.

### 2.7 Internationalization (`vault.i18n`)
Retrieve active application language options for localized dialogue rendering:
* **`vault.i18n.get_locale() -> string`**: Asynchronously retrieves the active UI locale setting (e.g., `"en"`, `"de"`).

### 2.8 Plugin dependencies (`vault.plugin`, `vault.external`)

* **`vault.plugin.require(pluginId: string) -> table`**: Returns another plugin's `exports` table. The dependency must be listed in your `dependencies` array.
* **`vault.external.require(externalId: string) -> table`**: Loads a Git-pinned library from `plugins/vendor/`. Must be listed in `externals`.
* **`require("@plugin/<id>")`**, **`require("@external/<id>")`**, **`require("./lib/foo")`**: Lower-level module paths resolved by the runtime searcher.

### 2.9 UI Primitives (`vault.ui`)
Request interaction with the user:
* **`vault.ui.show_input_box(options: table) -> string | nil`**: Prompts the user with an input box.
  * *Options table structure*: `{ title = string, placeholder = string }`
  * *Returns*: The user input string, or `nil` if cancelled/dismissed.
* **`vault.ui.show_quick_pick(options: table) -> string | nil`**: Renders a premium searchable list dropdown (Quick Pick).
  * *Options table structure*:
    ```lua
    {
        title = "Choose an option",
        items = {
            { id = "item1", label = "Option A", detail = "First choice", icon = "mdi--star-outline" },
            { id = "item2", label = "Option B", detail = "Second choice", icon = "mdi--close" },
        }
    }
    ```
  * *Returns*: The `id` of the selected item, or `nil` if cancelled/dismissed.
* **`vault.ui.open_project_file(projectId: string, filePath: string, line?: number)`**: Navigates the application view to the specified project, opens the files explorer tab, and reactively opens and scrolls the specified file to the line number.
  * *Parameters*:
    * `projectId`: The database ID of the target project.
    * `filePath`: The absolute local file path to open.
    * `line`: (Optional) The 1-indexed line number to automatically scroll the editor preview to.

### 2.10 Git (`vault.git`)

There is **no engine-side cache** for repository status. Every call runs live `git` commands against the project directory.

* **`vault.git.get_status(projectId: string) -> string`**: JSON string matching the built-in `get_git_status` Tauri command (`branch`, `ahead`, `behind`, `isDirty`, `hasUpstream`, `version`).
* **`vault.git.status(projectId: string) -> string?`**: Same fields as JSON; returns `nil` when the project is not a git repository.
* **`vault.git.run(projectId: string, args: table) -> { success, stdout, stderr }`**: Runs arbitrary git argv in the project root. Does **not** automatically notify the UI; after mutating commands, publish `project:changed` (see below) or rely on built-in commands that already notify.
* **`vault.git.log(projectId: string, maxCount?: number) -> string`**: Recent commits as JSON.

**`version` field:** Computed at call time with `git describe --tags --abbrev=0`. Omitted when the repository has no reachable tags.

**Built-in commands and `project:changed` `changeType` values:**

| Command / source | `changeType` |
|------------------|--------------|
| `git_pull`, `git_push`, `git_fetch`, `git_init` | `git` |
| `git_clean_execute` | `git-clean` |
| `git_tag_and_push`, `git_bump_version_and_tag` | `version-bump` |
| Git directory watcher (project detail open) | `git` |

Each row also emits **`git:status-changed`** with the same payload. The web UI invalidates its TanStack Query git caches on these events; plugins receive **`git_status_changed`** via `plugin.execute` (see [creating-plugins.md](./creating-plugins.md)).

### 2.11 Events (`vault.event`)

* **`vault.event.publish(eventName: string, payloadJson: string)`**: Emits a Tauri event to the frontend. Plugins commonly use this after local git work:

  ```lua
  vault.event.publish("project:changed", vault.json.stringify({
      projectId = project_id,
      changeType = "git",
  }))
  ```

  That invalidates UI caches and triggers the `git_status_changed` plugin hook for enabled plugins.

---

## 3. Features & Development Tools

### 3.1 Hot-Reloading (File Watcher)
During development, whenever you edit `init.luau` under a plugin path, the file watcher reloads plugins and refreshes the command palette. No app restart needed.

### 3.2 Real-time Plugins Settings UI
Inside settings, navigate to the **Plugins** tab to:
* View installed plugins (install the official bundle from the Store or a custom Git URL).
* Open the [plugin development guide](./creating-plugins.md).
* Turn plugins on/off instantly via toggles.
* Access the **Real-time Log Console** to filter and view diagnostic outputs/errors from your plugin scripts.

### 3.3 Plugin lifecycle hooks (`plugin.execute`)

These `command_id` values are invoked by the app, not listed in `commands`:

| `command_id` | When |
|--------------|------|
| `init` | Plugin enabled at startup |
| `project_focus` | Active project changed |
| `project_state_changed` | Active project’s detail tab or sub-view changed |
| `git_status_changed` | Repository state changed (`context.projectId` set) |

Handle `git_status_changed` to refresh header widgets, footer chips, or other git UI. Add `"git_status_changed"` to the plugin `event` array so lazy plugins load when this hook fires.
