# Product Requirements Document: Lua Plugin System

## 1. Introduction / Overview
Project Vault will implement a Neovim-style Lua (`mlua`) plugin system. This system allows the community and power users to extend the core Rust application natively—without recompiling. It covers project detection, dynamic templates, advanced task hooks, custom command execution, and fully asynchronous frontend UI interaction.

## 2. Goals & Execution Model
**Model:** We will use **Ephemeral Instances (Serverless Model)**. A fresh, isolated `mlua` virtual machine is spawned for every plugin action (scan, template run, or command execution).
*   **Safety:** Guarantees absolute safety. If a custom detector goes into an infinite loop, it will not crash the parent Rust application or other plugins.
*   **Isolation:** No state persists between executions unless explicitly written to disk or the database, preventing side-effect bugs.

## 3. Functional Scope
1.  **Lua Engine Base:** A locked-down `mlua` VM with restricted standard libraries and injected `vault.*` safe API wrappers (FS, Logging, Processes).
2.  **Custom Detectors:** Lua scripts implementing the `ProjectDetector` interface to parse proprietary workspaces and yield a `ProjectDraft`.
3.  **Dynamic Templates:** Lua scripts for the "New Project Wizard" allowing for conditional scaffolding and interactive user prompts.
4.  **Task Hooks:** Local `.vault/tasks.lua` files capable of overriding or wrapping standard task executions with custom logic.
5.  **Command Palette & Hotkey Integration:** Plugins can register `global` or `project` scoped commands. Registered commands with hotkeys are automatically discovered and displayed in the application's Hotkey Settings for user remapping.
6.  **Centralized Plugin Management:** A dedicated "Plugins" tab in the Settings UI allowing users to view all installed extensions, toggle them (Enable/Disable), and access plugin-specific configuration.
7.  **Settings & Configuration API:** All application settings manageable via Lua (`vault.settings.*`), allowing plugins to override, validate, or sync configurations.
7.  **Dynamic Theming Support:** Lua-driven UI theming (`vault.theme.*`). Plugins can define CSS variable overrides, toggle dark/light modes, or implement custom color schemes dynamically.
8.  **UI Primitives (IPC):** Plugins can halt execution to ask the user for input via `vault.ui.show_input_box()` or `vault.ui.show_quick_pick()`.
9.  **Plugin Developer Mode:** Dedicated environment for testing extensions. Includes hot-reloading for Lua scripts, a dedicated debug console for `vault.log` output, and an interactive REPL for testing API calls in real-time.
10. **Developer Documentation:** Offline-first guide and type-definitions (`.d.lua`) for IDE autocomplete support.

## 4. Technical Architecture
*   **Rust (Backend):** Hosts the `mlua` engine. Exposes sandboxed functions for filesystem access, supervised process spawning, SQLite querying, and settings persistence. Implements a file watcher for the plugin directory to support hot-reloading.
*   **Tauri IPC:** Serves as the asynchronous bridge between the Rust Lua threads and the SolidJS frontend.
*   **SolidJS (Frontend):** Dynamically fetches plugin command metadata, renders interactive UI components (dialogs/inputs), applies CSS variable overrides, and provides a "Plugin Debugger" overlay for log inspection.

## 5. Phased Implementation Plan

### Phase 1: Engine Foundation
- Integrate `mlua` crate with `luau`, `serialize`, and `async` features.
- Build the `lua::engine` factory for bootstrapped, sandboxed VMs.
- Implement baseline `vault.fs` and `vault.log` modules.

### Phase 2: Detectors & Templates
- Implement `LuaProjectDetector` to load user-defined scripts during scans.
- Support `template_type: "lua"` in the project wizard.
- Provide Lua-side parsers for JSON, TOML, and YAML.

### Phase 3: Commands & UI Primitives
- Build the `PluginManager` to load global `init.lua` files and register command metadata.
- Implement async `vault.ui.*` bridge in Rust.
- Create `<PluginInputDialog>` and `<PluginQuickPickDialog>` in SolidJS.

### Phase 4: Documentation & Tooling
- Write `docs/plugins.md` and provide `.luarc.json` stubs for LLS.
- Create reference plugins (e.g., "Advanced Code Search" and "Monorepo Detector").

## 6. Safety & Security
- **Sandboxing:** Disable `os.execute`, `require` (outside allowed paths), and direct socket access.
- **Resource Limits:** Implement execution timeouts to prevent plugins from hanging the system.
- **Async Integrity:** Ensure UI-blocking calls in Lua do not starve the main Tauri event loop.
