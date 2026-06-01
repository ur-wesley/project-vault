# Progress: Lua Plugin System Implementation

## Phase 1: Engine Foundation
- [x] Integrate `mlua` crate (`luau`, `serialize`, `async`)
- [x] Build `lua::engine` VM factory
- [x] Implement `vault.log` API
- [x] Implement `vault.fs` API (read, write, exists, list, etc.)
- [x] Implement `vault.json` and `vault.toml` parsers
- [x] Basic VM isolation and execution tests

## Phase 2: Detectors & Templates
- [x] Implement `LuaProjectDetector`
- [x] Update `DetectorRegistry` to support dynamic Lua detectors
- [x] Update `scan_library_location` and `refresh_project` to use `AppHandle`-aware registry
- [x] Implement `template_type: "lua"` in `project_wizard.rs`
- [x] Provide script context (`project_name`, `project_root`) to templates

## Phase 3: Commands & UI Primitives
- [x] Define `PluginCommandMetadata` and `PluginManager` loader
- [x] Implement `vault.ui` async bridge in Rust (`show_input_box`, `show_quick_pick`)
- [x] Create `resolve_plugin_ui` Tauri command
- [x] Create `PluginUiBridge.tsx` SolidJS component
- [x] Mount `PluginUiBridge` in `App.tsx`
- [x] Implement `execute_plugin_command` in Rust
- [x] Implement `list_plugins` and `toggle_plugin` for management
- [x] Integrate plugin commands into `CommandPalette.tsx`

## Phase 4: Settings, Theming & Dev Mode
- [ ] Implement `vault.settings` API
- [ ] Implement `vault.theme` API and CSS variable injection
- [ ] Build "Plugins" tab in Settings UI
- [ ] Implement hot-reloading (file watcher) for plugins
- [ ] Create Plugin Debugger / Log Overlay

## Phase 5: Documentation & Examples
- [ ] Write `docs/plugins.md`
- [ ] Create LSP stubs for `vault.*` API
- [ ] Create reference plugins (Search, Advanced Detector)
