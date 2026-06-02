--!strict
-- vault.luau — Vault Engine API type definitions
-- This module is pre-loaded by the Rust engine and available as `vault` global.
-- Plugins obtain it via: local vault = (require :: any)("vault") :: Vault
-- Type definitions here are consumed by the Luau type checker and IDE language servers.

-- ─── Sub-module types ────────────────────────────────────────────────────────

export type VaultLog = {
    --- Logs an informational message to the Plugins Log Console.
    info: (message: string) -> (),
    --- Logs an error message to the Plugins Log Console.
    error: (message: string) -> (),
}

export type VaultNotification = {
    --- Shows a success toast notification.
    success: (message: string) -> (),
    --- Shows an informational toast notification.
    info: (message: string) -> (),
    --- Shows a warning toast notification.
    warn: (message: string) -> (),
    --- Shows an error toast notification.
    error: (message: string) -> (),

    --- Options for a rich, persistent notification entry in the app's Notification Center.
    --- Use this for events that should stay visible until the user dismisses them.
    show: (options: VaultNotificationShowOptions) -> (),
}

--- A clickable action attached to a rich notification.
--- `command` is a local command id — the engine automatically scopes it to the plugin
--- namespace when dispatching through `execute_plugin_command`.
export type VaultNotificationAction = {
    id: string,
    label: string,
    primary: boolean?,
    command: string?,
}

export type VaultNotificationShowOptions = {
    --- Severity: "info" | "success" | "warn" | "error" (default: "info").
    severity: ("info" | "success" | "warn" | "error")?,
    --- Required headline shown in the notification center.
    title: string,
    --- Optional secondary body text.
    message: string?,
    --- Optional source label, e.g. "Plugins" or the plugin name. Defaults to the plugin id.
    source: string?,
    --- Optional clickable actions.
    actions: { VaultNotificationAction }?,
}

export type VaultFS = {
    --- Reads the full contents of a text file at the given absolute path.
    read_file: (path: string) -> string,
    --- Writes content to a text file at the given absolute path.
    write_file: (path: string, content: string) -> (),
    --- Returns true if the path exists on the local filesystem.
    exists: (path: string) -> boolean,
    --- Returns true if the path is a directory.
    is_dir: (path: string) -> boolean,
    --- Returns true if the path is a regular file.
    is_file: (path: string) -> boolean,
    --- Returns a list of absolute child paths inside a directory.
    list_dir: (path: string) -> { string },
}

export type VaultJSON = {
    --- Parses a JSON string into a Lua value.
    parse: (json_str: string) -> any,
    --- Serializes a Lua value into a JSON string.
    stringify: (value: any) -> string,
}

export type VaultTOML = {
    --- Parses a TOML string into a Lua table.
    parse: (toml_str: string) -> any,
    --- Serializes a Lua table into a TOML string.
    stringify: (value: any) -> string,
}

export type VaultProjects = {
    --- Returns a JSON-serialized list of all active projects in the vault.
    list: () -> string,
}

export type VaultSettings = {
    --- Gets a persisted string value scoped to the current plugin namespace.
    get: (key: string) -> string?,
    --- Saves a persisted string value scoped to the current plugin namespace.
    set: (key: string, value: string) -> (),
}

export type VaultTheme = {
    --- Returns the current application theme mode: "dark" or "light".
    get_mode: () -> string,
    --- Injects a raw CSS string into the application webview.
    inject_css: (css: string) -> (),
}

export type VaultI18n = {
    --- Returns the active UI locale string, e.g. "en" or "de".
    get_locale: () -> string,
}

export type QuickPickItem = {
    --- Unique identifier returned when the item is selected.
    id: string,
    --- Primary display label.
    label: string,
    --- Optional secondary description shown below the label.
    detail: string?,
    --- Optional Iconify icon name, e.g. "mdi--star-outline".
    icon: string?,
}

export type InputBoxOptions = {
    title: string,
    placeholder: string?,
}

export type QuickPickOptions = {
    title: string,
    items: { QuickPickItem },
}

--- Color variant for a plugin footer segment.
export type FooterColor = "default" | "success" | "warning" | "error" | "primary" | "muted"

--- Options for displaying a persistent segment in the app status-bar footer.
export type FooterSegmentOptions = {
    --- Unique id for this segment (scoped to the plugin).
    id: string,
    --- Display text shown in the footer chip.
    text: string,
    --- Optional Iconify icon name, e.g. "mdi--timer-outline".
    icon: string?,
    --- Optional tooltip shown on hover.
    tooltip: string?,
    --- Optional plugin command id to invoke when the segment is clicked.
    command: string?,
    --- Visual color variant (default: "default").
    color: FooterColor?,
}

export type VaultUI = {
    --- Prompts the user with a text input box. Returns the entered string or nil if cancelled.
    show_input_box: (options: InputBoxOptions) -> string?,
    --- Renders a searchable Quick Pick list. Returns the selected item id or nil if cancelled.
    show_quick_pick: (options: QuickPickOptions) -> string?,
    --- Navigates the UI to a project, opening a specific file and line.
    open_project_file: (projectId: string, filePath: string, line: number?) -> (),
    --- Creates or updates a persistent segment in the app footer/status bar.
    --- Call again with the same id to update text, icon, color, etc.
    set_footer: (options: FooterSegmentOptions) -> (),
    --- Removes a footer segment by its id.
    clear_footer: (id: string) -> (),
}


export type VaultMise = {
    --- Returns a JSON-serialized list of MiseTool for the given project.
    get_tools: (projectId: string) -> string,
    --- Returns a JSON-serialized list of MiseSuggestion for the given project.
    get_suggestions: (projectId: string) -> string,
    --- Pins suggested tools to the project's mise.toml.
    pin_tools: (projectId: string, toolsJson: string) -> (),
    --- Asynchronously runs `mise install` in the project directory.
    install_tools: (projectId: string) -> (),
}

-- ─── Root Vault type ─────────────────────────────────────────────────────────

export type Vault = {
    log: VaultLog,
    notification: VaultNotification,
    fs: VaultFS,
    json: VaultJSON,
    toml: VaultTOML,
    projects: VaultProjects,
    settings: VaultSettings,
    theme: VaultTheme,
    i18n: VaultI18n,
    ui: VaultUI,
    mise: VaultMise,
}

-- This module is never required at runtime (vault is injected as a global).
-- The return value here exists solely for `typeof()` usage in type annotations.
return (nil :: any) :: Vault
