# Lua Plugin System Documentation

The `project-vault` application features a dynamic runtime Lua plugin system, allowing you to easily build custom commands, automate workspace-wide searches, query database states, inject themes/styles, and interact with the UI through input boxes and quick pick overlays.

---

## 1. Plugin Structure

Each plugin resides in its own directory inside the `<app_data_dir>/plugins/` folder (e.g., `plugins/search-all-projects/`).
A plugin is defined by a single **`init.lua`** file that must return a Lua table containing metadata, defined commands, and an execution entry hook.

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

### 2.8 UI Primitives (`vault.ui`)
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

---

## 3. Features & Development Tools

### 3.1 Hot-Reloading (File Watcher)
During development, whenever you edit any `.lua` file inside your plugin's folder under the `<app_data_dir>/plugins/` path, the backend file watcher automatically detects the change, triggers a plugin reload, and refreshes the frontend's command palette list immediately. No app restarts needed.

### 3.2 Real-time Plugins Settings UI
Inside settings, navigate to the **Plugins** tab to:
* View all installed and bundled plugins.
* Turn plugins on/off instantly via toggles.
* Access the **Real-time Log Console** to filter and view diagnostic outputs/errors from your plugin scripts.
