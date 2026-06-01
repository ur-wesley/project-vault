--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")



type PinnedTool = {
    name: string,
    version: string,
    active: boolean
}

type SuggestedTool = {
    name: string,
    version: string,
    reason: string
}

type PluginCommandContext = {
    projectId: string?
}

local plugin = {
    name = "Mise Tool Manager",
    description = "Seamlessly manage your project's runtimes and tools (Node, Go, Python, etc.) via Mise.",
    version = "1.0.0",
    category = "utility",
    locales = {
        en = {
            name = "Mise Tool Manager",
            description = "Seamlessly manage your project's runtimes and tools (Node, Go, Python, etc.) via Mise.",
            ["command.manage_tools"] = "Mise: Manage Project Tools",
            
            no_active_project = "Mise: No active project is currently selected.",
            menu_title = "Mise: Pinned & Suggested Tools",
            suggested_header = "--- Suggestions ---",
            pinned_header = "--- Pinned Tools ---",
            run_install = "🚀 Run 'mise install'",
            run_install_detail = "Asynchronously installs all pinned tools in the background.",
            pin_title = "Pin Suggested Tool",
            pin_confirm = "Do you want to pin '{name}' at version '{version}' to this project's mise.toml?",
            pinned_ok = "Successfully pinned '{name}' to mise.toml!",
            pin_cancelled = "Pinning cancelled.",
            no_tools_or_suggestions = "No tools pinned and no new suggestions found.",
            empty_item = "No tools active."
        },
        de = {
            name = "Mise Tool-Manager",
            description = "Verwalten Sie die Laufzeiten und Tools Ihres Projekts (Node, Go, Python usw.) nahtlos über Mise.",
            ["command.manage_tools"] = "Mise: Projekt-Tools verwalten",
            
            no_active_project = "Mise: Es ist derzeit kein aktives Projekt ausgewählt.",
            menu_title = "Mise: Angepinnte & Empfohlene Tools",
            suggested_header = "--- Empfehlungen ---",
            pinned_header = "--- Angepinnte Tools ---",
            run_install = "🚀 'mise install' ausführen",
            run_install_detail = "Installiert alle angepinnten Tools asynchron im Hintergrund.",
            pin_title = "Empfohlenes Tool anpinnen",
            pin_confirm = "Möchten Sie '{name}' in Version '{version}' an die mise.toml dieses Projekts anpinnen?",
            pinned_ok = "'{name}' erfolgreich an mise.toml angepinnt!",
            pin_cancelled = "Anpinnen abgebrochen.",
            no_tools_or_suggestions = "Keine Tools angepinnt und keine neuen Empfehlungen gefunden.",
            empty_item = "Keine Tools aktiv."
        }
    },
    commands = {
        { id = "manage_tools", title = "Mise: Manage Project Tools", scope = "project" }
    }
}

-- Helpers
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
    local locale: string = vault.i18n.get_locale()
    
    if command_id == "manage_tools" then
        local project_id = context and context.projectId
        if not project_id or project_id == "" then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end
        
        -- Fetch current tools and suggestions
        local ok1, raw_tools = pcall(vault.mise.get_tools, project_id)
        local ok2, raw_suggs = pcall(vault.mise.get_suggestions, project_id)
        
        local tools: {PinnedTool} = ok1 and vault.json.parse(raw_tools) or {}
        local suggestions: {SuggestedTool} = ok2 and vault.json.parse(raw_suggs) or {}
        
        if #tools == 0 and #suggestions == 0 then
            vault.ui.show_quick_pick({
                title = t(locale, "menu_title"),
                items = {
                    { id = "empty", label = t(locale, "no_tools_or_suggestions") }
                }
            })
            return
        end
        
        local items = {}
        
        -- Add Install trigger option at the top if there are pinned tools
        if #tools > 0 then
            table.insert(items, {
                id = "run_install",
                label = t(locale, "run_install"),
                detail = t(locale, "run_install_detail"),
                icon = "mdi--wrench-outline"
            })
        end
        
        -- Add suggestions
        if #suggestions > 0 then
            table.insert(items, { id = "section_sug", label = t(locale, "suggested_header"), detail = "", icon = "mdi--dots-horizontal" })
            for i, sug in ipairs(suggestions) do
                table.insert(items, {
                    id = "sug_" .. tostring(i),
                    label = "➕ Pin " .. sug.name .. " (" .. sug.version .. ")",
                    detail = sug.reason,
                    icon = "mdi--plus-circle-outline"
                })
            end
        end
        
        -- Add current tools
        if #tools > 0 then
            table.insert(items, { id = "section_pinned", label = t(locale, "pinned_header"), detail = "", icon = "mdi--dots-horizontal" })
            for _, tool in ipairs(tools) do
                table.insert(items, {
                    id = "pinned_" .. tool.name,
                    label = "✔️ " .. tool.name .. " (" .. tool.version .. ")",
                    detail = "Active tool version",
                    icon = "mdi--check-bold"
                })
            end
        end
        
        local selected = vault.ui.show_quick_pick({
            title = t(locale, "menu_title"),
            items = items
        })
        
        if selected then
            if selected == "run_install" then
                vault.mise.install_tools(project_id)
            elseif selected:find("^sug_") then
                local idx = tonumber(selected:match("^sug_(%d+)$"))
                if idx and suggestions[idx] then
                    local sug = suggestions[idx]
                    
                    -- Ask user to confirm pinning
                    local confirmed = vault.ui.show_quick_pick({
                        title = t(locale, "pin_title"),
                        items = {
                            { id = "yes", label = "Pin " .. sug.name .. " (" .. sug.version .. ")", detail = "Save to mise.toml", icon = "mdi--check" },
                            { id = "no", label = t(locale, "pin_cancelled"), detail = "Do not pin", icon = "mdi--close" }
                        }
                    })
                    
                    if confirmed == "yes" then
                        -- Pin the tool
                        local pin_list = { sug }
                        local pin_raw = vault.json.stringify(pin_list)
                        local ok_pin, err = pcall(vault.mise.pin_tools, project_id, pin_raw)
                        if ok_pin then
                            vault.notification.success(t(locale, "pinned_ok", { name = sug.name }))
                            -- Ask if they want to run install now
                            local confirmed_install = vault.ui.show_quick_pick({
                                title = "Run install now?",
                                items = {
                                    { id = "yes", label = "Yes, install tools now", detail = "Runs 'mise install' in background", icon = "mdi--play" },
                                    { id = "no", label = "No, install later", detail = "", icon = "mdi--close" }
                                }
                            })
                            if confirmed_install == "yes" then
                                vault.mise.install_tools(project_id)
                            end
                        else
                            vault.notification.error("Failed to pin tool: " .. tostring(err))
                        end
                    end
                end
            end
        end
    end
end

return plugin
