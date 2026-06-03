--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")



type PresetItem = {
    label: string,
    detail: string,
    css: string
}

type PluginThemeOption = {
    id: string,
    label: string
}

type PluginCommandContext = {
    flavor: string?
}

local plugin = {
    name = "Community Themes Injector",
    description = "Personalize your Vault experience with gorgeous One Dark, Dracula, Nord, Tokyo Night, and Catppuccin theme presets.",
    version = "1.1.0",
    category = "theme",
    options = {
        { id = "mocha", label = "Catppuccin Mocha" },
        { id = "macchiato", label = "Catppuccin Macchiato" },
        { id = "frappe", label = "Catppuccin Frappé" },
        { id = "latte", label = "Catppuccin Latte" },
        { id = "tokyonight", label = "Tokyo Night (Storm)" },
        { id = "onedark", label = "One Dark (Atom)" },
        { id = "dracula", label = "Dracula (Vampire)" },
        { id = "nord", label = "Nord (Arctic Frost)" }
    },
    config = {
        {
            key = "primary_color",
            type = "color",
            label = "Primary Color Override",
            description = "Override the theme's primary accent color. Leave empty to use preset default.",
            default = ""
        }
    },
    locales = {
        en = {
            name = "Community Themes Injector",
            description = "Personalize your Vault experience with gorgeous One Dark, Dracula, Nord, Tokyo Night, and Catppuccin theme presets.",
            ["command.apply_theme"] = "Apply Community Theme Preset",
            dialog_title = "Select a Theme Flavor",
            success_msg = "Applied {flavor} theme preset successfully!",
            cancel_msg = "Theme selection cancelled."
        },
        de = {
            name = "Community-Themes",
            description = "Personalisieren Sie Ihr Vault-Erlebnis mit wunderschönen Designs wie One Dark, Dracula, Nord, Tokyo Night und Catppuccin.",
            ["command.apply_theme"] = "Community-Design-Vorlage anwenden",
            dialog_title = "Wählen Sie ein Design-Preset",
            success_msg = "Design-Preset '{flavor}' erfolgreich angewendet!",
            cancel_msg = "Design-Auswahl abgebrochen."
        }
    }
}

local presets: {[string]: PresetItem} = {
    mocha = {
        label = "Catppuccin Mocha",
        detail = "Deep dark high-contrast pastel dark theme.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.13 0.01 260) !important;
                --foreground: oklch(0.95 0.015 260) !important;
                --card: oklch(0.11 0.01 260) !important;
                --card-foreground: oklch(0.95 0.015 260) !important;
                --popover: oklch(0.09 0.01 260) !important;
                --popover-foreground: oklch(0.95 0.015 260) !important;
                --primary: oklch(0.78 0.12 250) !important;
                --primary-foreground: oklch(0.1 0.01 260) !important;
                --secondary: oklch(0.22 0.02 260) !important;
                --secondary-foreground: oklch(0.95 0.015 260) !important;
                --muted: oklch(0.22 0.02 260) !important;
                --muted-foreground: oklch(0.7 0.02 260) !important;
                --accent: oklch(0.8 0.11 280) !important;
                --accent-foreground: oklch(0.1 0.01 260) !important;
                --border: oklch(0.22 0.02 260) !important;
                --input: oklch(0.22 0.02 260) !important;
                --sidebar: oklch(0.11 0.01 260) !important;
                --sidebar-foreground: oklch(0.95 0.015 260) !important;
                --sidebar-border: oklch(0.22 0.02 260) !important;
                --sidebar-primary: oklch(0.78 0.12 250) !important;
                --sidebar-accent: oklch(0.22 0.02 260) !important;
            }
        ]]
    },
    macchiato = {
        label = "Catppuccin Macchiato",
        detail = "Soothing medium-dark pastel theme.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.18 0.015 260) !important;
                --foreground: oklch(0.93 0.015 260) !important;
                --card: oklch(0.15 0.015 260) !important;
                --card-foreground: oklch(0.93 0.015 260) !important;
                --popover: oklch(0.13 0.015 260) !important;
                --popover-foreground: oklch(0.93 0.015 260) !important;
                --primary: oklch(0.82 0.1 210) !important;
                --primary-foreground: oklch(0.13 0.015 260) !important;
                --secondary: oklch(0.26 0.02 260) !important;
                --secondary-foreground: oklch(0.93 0.015 260) !important;
                --muted: oklch(0.26 0.02 260) !important;
                --muted-foreground: oklch(0.68 0.02 260) !important;
                --accent: oklch(0.75 0.14 300) !important;
                --accent-foreground: oklch(0.13 0.015 260) !important;
                --border: oklch(0.26 0.02 260) !important;
                --input: oklch(0.26 0.02 260) !important;
                --sidebar: oklch(0.15 0.015 260) !important;
                --sidebar-foreground: oklch(0.93 0.015 260) !important;
                --sidebar-border: oklch(0.26 0.02 260) !important;
                --sidebar-primary: oklch(0.82 0.1 210) !important;
                --sidebar-accent: oklch(0.26 0.02 260) !important;
            }
        ]]
    },
    frappe = {
        label = "Catppuccin Frappé",
        detail = "Minimalist low-contrast dark theme.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.23 0.02 260) !important;
                --foreground: oklch(0.91 0.015 260) !important;
                --card: oklch(0.2 0.02 260) !important;
                --card-foreground: oklch(0.91 0.015 260) !important;
                --popover: oklch(0.18 0.02 260) !important;
                --popover-foreground: oklch(0.91 0.015 260) !important;
                --primary: oklch(0.82 0.12 140) !important;
                --primary-foreground: oklch(0.18 0.02 260) !important;
                --secondary: oklch(0.3 0.02 260) !important;
                --secondary-foreground: oklch(0.91 0.015 260) !important;
                --muted: oklch(0.3 0.02 260) !important;
                --muted-foreground: oklch(0.66 0.02 260) !important;
                --accent: oklch(0.88 0.05 10) !important;
                --accent-foreground: oklch(0.18 0.02 260) !important;
                --border: oklch(0.3 0.02 260) !important;
                --input: oklch(0.3 0.02 260) !important;
                --sidebar: oklch(0.2 0.02 260) !important;
                --sidebar-foreground: oklch(0.91 0.015 260) !important;
                --sidebar-border: oklch(0.3 0.02 260) !important;
                --sidebar-primary: oklch(0.82 0.12 140) !important;
                --sidebar-accent: oklch(0.3 0.02 260) !important;
            }
        ]]
    },
    latte = {
        label = "Catppuccin Latte",
        detail = "Clean and gorgeous light pastel theme.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.96 0.01 260) !important;
                --foreground: oklch(0.32 0.02 260) !important;
                --card: oklch(0.92 0.01 260) !important;
                --card-foreground: oklch(0.32 0.02 260) !important;
                --popover: oklch(0.88 0.01 260) !important;
                --popover-foreground: oklch(0.32 0.02 260) !important;
                --primary: oklch(0.51 0.18 250) !important;
                --primary-foreground: oklch(0.96 0.01 260) !important;
                --secondary: oklch(0.82 0.02 260) !important;
                --secondary-foreground: oklch(0.32 0.02 260) !important;
                --muted: oklch(0.82 0.02 260) !important;
                --muted-foreground: oklch(0.52 0.02 260) !important;
                --accent: oklch(0.66 0.17 320) !important;
                --accent-foreground: oklch(0.96 0.01 260) !important;
                --border: oklch(0.82 0.02 260) !important;
                --input: oklch(0.82 0.02 260) !important;
                --sidebar: oklch(0.92 0.01 260) !important;
                --sidebar-foreground: oklch(0.32 0.02 260) !important;
                --sidebar-border: oklch(0.82 0.02 260) !important;
                --sidebar-primary: oklch(0.51 0.18 250) !important;
                --sidebar-accent: oklch(0.82 0.02 260) !important;
            }
        ]]
    },
    tokyonight = {
        label = "Tokyo Night",
        detail = "Clean and gorgeous dark theme inspired by the neon lights of Tokyo.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.15 0.02 260) !important;
                --foreground: oklch(0.88 0.02 260) !important;
                --card: oklch(0.12 0.02 260) !important;
                --card-foreground: oklch(0.88 0.02 260) !important;
                --popover: oklch(0.1 0.02 260) !important;
                --popover-foreground: oklch(0.88 0.02 260) !important;
                --primary: oklch(0.72 0.12 250) !important;
                --primary-foreground: oklch(0.15 0.02 260) !important;
                --secondary: oklch(0.24 0.02 260) !important;
                --secondary-foreground: oklch(0.88 0.02 260) !important;
                --muted: oklch(0.24 0.02 260) !important;
                --muted-foreground: oklch(0.62 0.02 260) !important;
                --accent: oklch(0.76 0.13 300) !important;
                --accent-foreground: oklch(0.15 0.02 260) !important;
                --border: oklch(0.24 0.02 260) !important;
                --input: oklch(0.24 0.02 260) !important;
                --sidebar: oklch(0.12 0.02 260) !important;
                --sidebar-foreground: oklch(0.88 0.02 260) !important;
                --sidebar-border: oklch(0.24 0.02 260) !important;
                --sidebar-primary: oklch(0.72 0.12 250) !important;
                --sidebar-accent: oklch(0.24 0.02 260) !important;
            }
        ]]
    },
    onedark = {
        label = "One Dark",
        detail = "Classic modern dark theme inspired by Atom's sleek aesthetics.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.24 0.015 250) !important;
                --foreground: oklch(0.76 0.015 250) !important;
                --card: oklch(0.2 0.015 250) !important;
                --card-foreground: oklch(0.76 0.015 250) !important;
                --popover: oklch(0.18 0.015 250) !important;
                --popover-foreground: oklch(0.76 0.015 250) !important;
                --primary: oklch(0.72 0.12 240) !important;
                --primary-foreground: oklch(0.24 0.015 250) !important;
                --secondary: oklch(0.28 0.015 250) !important;
                --secondary-foreground: oklch(0.76 0.015 250) !important;
                --muted: oklch(0.28 0.015 250) !important;
                --muted-foreground: oklch(0.56 0.015 250) !important;
                --accent: oklch(0.62 0.18 320) !important;
                --accent-foreground: oklch(0.24 0.015 250) !important;
                --border: oklch(0.3 0.015 250) !important;
                --input: oklch(0.3 0.015 250) !important;
                --sidebar: oklch(0.2 0.015 250) !important;
                --sidebar-foreground: oklch(0.76 0.015 250) !important;
                --sidebar-border: oklch(0.3 0.015 250) !important;
                --sidebar-primary: oklch(0.72 0.12 240) !important;
                --sidebar-accent: oklch(0.28 0.015 250) !important;
            }
        ]]
    },
    dracula = {
        label = "Dracula",
        detail = "High-contrast dark theme designed to be easy on the eyes.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.22 0.025 270) !important;
                --foreground: oklch(0.96 0.01 270) !important;
                --card: oklch(0.18 0.02 270) !important;
                --card-foreground: oklch(0.96 0.01 270) !important;
                --popover: oklch(0.16 0.02 270) !important;
                --popover-foreground: oklch(0.96 0.01 270) !important;
                --primary: oklch(0.7 0.14 290) !important;
                --primary-foreground: oklch(0.22 0.025 270) !important;
                --secondary: oklch(0.28 0.025 270) !important;
                --secondary-foreground: oklch(0.96 0.01 270) !important;
                --muted: oklch(0.28 0.025 270) !important;
                --muted-foreground: oklch(0.64 0.02 270) !important;
                --accent: oklch(0.68 0.2 340) !important;
                --accent-foreground: oklch(0.22 0.025 270) !important;
                --border: oklch(0.3 0.025 270) !important;
                --input: oklch(0.3 0.025 270) !important;
                --sidebar: oklch(0.18 0.02 270) !important;
                --sidebar-foreground: oklch(0.96 0.01 270) !important;
                --sidebar-border: oklch(0.3 0.025 270) !important;
                --sidebar-primary: oklch(0.7 0.14 290) !important;
                --sidebar-accent: oklch(0.28 0.025 270) !important;
            }
        ]]
    },
    nord = {
        label = "Nord",
        detail = "Arctic-frost inspired cold pastel dark theme.",
        css = [[
            :root, .dark, [data-kb-theme="dark"] {
                --background: oklch(0.26 0.02 240) !important;
                --foreground: oklch(0.86 0.015 240) !important;
                --card: oklch(0.22 0.02 240) !important;
                --card-foreground: oklch(0.86 0.015 240) !important;
                --popover: oklch(0.2 0.02 240) !important;
                --popover-foreground: oklch(0.86 0.015 240) !important;
                --primary: oklch(0.76 0.08 210) !important;
                --primary-foreground: oklch(0.26 0.02 240) !important;
                --secondary: oklch(0.3 0.02 240) !important;
                --secondary-foreground: oklch(0.86 0.015 240) !important;
                --muted: oklch(0.3 0.02 240) !important;
                --muted-foreground: oklch(0.62 0.02 240) !important;
                --accent: oklch(0.76 0.06 180) !important;
                --accent-foreground: oklch(0.26 0.02 240) !important;
                --border: oklch(0.32 0.02 240) !important;
                --input: oklch(0.32 0.02 240) !important;
                --sidebar: oklch(0.22 0.02 240) !important;
                --sidebar-foreground: oklch(0.86 0.015 240) !important;
                --sidebar-border: oklch(0.32 0.02 240) !important;
                --sidebar-primary: oklch(0.76 0.08 210) !important;
                --sidebar-accent: oklch(0.3 0.02 240) !important;
            }
        ]]
    }
}

-- Helper to apply the active theme and any custom settings (e.g. primary color override)
local function apply_current_theme()
    local flavor = vault.settings.get("active_flavor")
    local primary_color = vault.settings.get("primary_color")
    
    local css = ""
    if flavor and flavor ~= "" then
        local preset = presets[flavor]
        if preset then
            css = preset.css
        end
    end
    
    if primary_color and primary_color ~= "" then
        local override = string.format("\n:root, .dark, [data-kb-theme=\"dark\"] {\n    --primary: %s !important;\n    --sidebar-primary: %s !important;\n}", primary_color, primary_color)
        css = css .. override
    end
    
    vault.theme.inject_css(css)
end

-- Translation helper
local function t(locale: string, key: string, args: {[string]: string}?): string
    local dict = plugin.locales[locale] or plugin.locales["en"] or {}
    local str = dict[key] or key
    if args then
        for k, v in pairs(args) do
            str = str:gsub("{" .. k .. "}", tostring(v))
        end
    end
    return str
end

function plugin.execute(command_id: string, context: PluginCommandContext?)
    if command_id == "init" then
        apply_current_theme()
        local flavor = vault.settings.get("active_flavor") or "default"
        vault.log.info("Initialized theme preset: " .. flavor)
    elseif command_id == "apply_theme" then
        local selected = nil
        if context and context.flavor then
            selected = context.flavor
        else
            local locale = vault.i18n.get_locale()
            -- Show themes list
            local items = {}
            for _, opt in ipairs(plugin.options) do
                local preset = presets[opt.id]
                table.insert(items, {
                    id = opt.id,
                    label = opt.label,
                    detail = preset and preset.detail or "",
                    icon = "mdi--palette-outline"
                })
            end
            selected = vault.ui.show_quick_pick({
                title = t(locale, "dialog_title"),
                items = items
            })
        end

        if not selected then
            local locale = vault.i18n.get_locale()
            vault.notification.info(t(locale, "cancel_msg"))
            return
        end

        if selected == "default" then
            vault.settings.set("active_flavor", "")
            apply_current_theme()
            vault.notification.success("Reset theme preset back to default.")
        else
            local preset = presets[selected]
            if preset then
                vault.settings.set("active_flavor", selected)
                apply_current_theme()
                local locale = vault.i18n.get_locale()
                vault.notification.success(t(locale, "success_msg", { flavor = preset.label }))
            end
        end
    end
end

return plugin
