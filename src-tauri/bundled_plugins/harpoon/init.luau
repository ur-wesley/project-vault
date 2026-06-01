--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")



type ProjectItem = {
    id: string,
    name: string
}

type QuickPickItem = {
    id: string,
    label: string,
    detail: string?,
    icon: string?
}

type PluginCommandContext = {
    projectId: string?
}

local plugin = {
    name = "Project Harpoon",
    description = "Supercharge your project navigation! Mark up to 4 projects and jump between them instantly.",
    version = "1.0.0",
    category = "utility",
    locales = {
        en = {
            name = "Project Harpoon",
            description = "Supercharge your project navigation! Mark up to 4 projects and jump between them instantly.",
            ["command.mark_project"] = "Harpoon: Mark Current Project",
            ["command.quick_menu"] = "Harpoon: Show Quick Menu",
            ["command.jump_1"] = "Harpoon: Jump to Project 1",
            ["command.jump_2"] = "Harpoon: Jump to Project 2",
            ["command.jump_3"] = "Harpoon: Jump to Project 3",
            ["command.jump_4"] = "Harpoon: Jump to Project 4",
            ["command.clear_harpoon"] = "Harpoon: Clear All Marked Projects",
            
            no_active_project = "Harpoon: No active project is currently selected to mark.",
            marked_success = "Harpooned project: '{name}' in slot {slot}!",
            already_marked = "Project '{name}' is already harpooned in slot {slot}!",
            unmarked_success = "Removed project: '{name}' from Harpoon slot {slot}!",
            menu_title = "Harpooned Projects",
            empty_menu = "No projects harpooned yet! Mark some projects first.",
            cleared_success = "Cleared all harpooned projects.",
            jump_empty = "No project harpooned in slot {slot} yet.",
            jump_success = "Jumped to slot {slot}: '{name}'"
        },
        de = {
            name = "Projekt-Harpoon",
            description = "Maximieren Sie Ihre Projektnavigation! Markieren Sie bis zu 4 Projekte und springen Sie sofort zwischen ihnen hin und her.",
            ["command.mark_project"] = "Harpoon: Aktuelles Projekt markieren",
            ["command.quick_menu"] = "Harpoon: Schnellmenü anzeigen",
            ["command.jump_1"] = "Harpoon: Zu Projekt 1 springen",
            ["command.jump_2"] = "Harpoon: Zu Projekt 2 springen",
            ["command.jump_3"] = "Harpoon: Zu Projekt 3 springen",
            ["command.jump_4"] = "Harpoon: Zu Projekt 4 springen",
            ["command.clear_harpoon"] = "Harpoon: Alle markierten Projekte löschen",
            
            no_active_project = "Harpoon: Es ist derzeit kein aktives Projekt zum Markieren ausgewählt.",
            marked_success = "Projekt harpooniert: '{name}' in Slot {slot}!",
            already_marked = "Projekt '{name}' ist bereits in Slot {slot} harpooniert!",
            unmarked_success = "Projekt entfernt: '{name}' aus Harpoon-Slot {slot}!",
            menu_title = "Harponierte Projekte",
            empty_menu = "Noch keine Projekte harpooniert! Markieren Sie zuerst einige Projekte.",
            cleared_success = "Alle harpoonierten Projekte gelöscht.",
            jump_empty = "Noch kein Projekt in Slot {slot} harpooniert.",
            jump_success = "Zu Slot {slot} gesprungen: '{name}'"
        }
    },
    config = {
        {
            key = "toggle_mode",
            type = "boolean",
            label = "Toggle Project Mark",
            description = "If enabled, trying to mark an already marked project will unmark (remove) it instead of showing an error.",
            default = false
        },
        {
            key = "show_in_footer",
            type = "boolean",
            label = "Show in Footer",
            description = "If enabled, shows the Project Harpoon slots and anchor in the status bar footer.",
            default = true
        }
    },
    commands = {
        { id = "mark_project", title = "Harpoon: Mark Current Project", scope = "global" },
        { id = "quick_menu", title = "Harpoon: Show Quick Menu", scope = "global" },
        { id = "jump_1", title = "Harpoon: Jump to Project 1", scope = "global" },
        { id = "jump_2", title = "Harpoon: Jump to Project 2", scope = "global" },
        { id = "jump_3", title = "Harpoon: Jump to Project 3", scope = "global" },
        { id = "jump_4", title = "Harpoon: Jump to Project 4", scope = "global" },
        { id = "clear_harpoon", title = "Harpoon: Clear All Marked Projects", scope = "global" }
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

-- Get stored list of projects
local function get_harpooned(): {ProjectItem}
    local raw = vault.settings.get("marked_projects")
    if not raw or raw == "" then
        return {}
    end
    local ok, parsed = pcall(vault.json.parse, raw)
    if ok and parsed then
        return parsed
    end
    return {}
end

-- Save list of projects
local function save_harpooned(list: {ProjectItem})
    local raw = vault.json.stringify(list)
    vault.settings.set("marked_projects", raw)
end

-- Sync the footer chip with the current harpoon state
-- current_slot: the slot number of the currently viewed project, or nil if not harpooned
local function sync_footer(list: {ProjectItem}, current_slot: number?)
    local show_in_footer = vault.settings.get("show_in_footer") ~= "false"
    if not show_in_footer or #list == 0 then
        vault.ui.clear_footer("harpoon_state")
        return
    end
    -- Slot indicators: current slot = [N], other filled = N, empty = ·
    local slots: {string} = {}
    for i = 1, 4 do
        if i == current_slot then
            table.insert(slots, "[" .. tostring(i) .. "]")
        elseif list[i] then
            table.insert(slots, tostring(i))
        else
            table.insert(slots, "·")
        end
    end
    -- Tooltip lists each pinned project, marking the active one
    local names: {string} = {}
    for i, item in ipairs(list) do
        local prefix = (i == current_slot) and "▸ " or "  "
        table.insert(names, prefix .. tostring(i) .. ": " .. item.name)
    end
    vault.ui.set_footer({
        id      = "harpoon_state",
        text    = table.concat(slots, "  "),
        icon    = "mdi--anchor",
        tooltip = table.concat(names, "\n"),
        command = "quick_menu",
        color   = current_slot and "success" or "primary",
    })
end

-- Find project by ID inside list
local function find_project_index(list: {ProjectItem}, id: string): number?
    for idx, item in ipairs(list) do
        if item.id == id then
            return idx
        end
    end
    return nil
end

-- Look up project metadata by ID
local function get_project_metadata(project_id: string): ProjectItem?
    local raw_list = vault.projects.list()
    local list = vault.json.parse(raw_list)
    if list then
        for _, p in ipairs(list) do
            if p.id == project_id then
                return p
            end
        end
    end
    return nil
end

function plugin.execute(command_id: string, context: PluginCommandContext?)
    local locale: string = vault.i18n.get_locale()
    
    if command_id == "mark_project" then
        local project_id = context and context.projectId
        if not project_id or project_id == "" then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end
        
        local project = get_project_metadata(project_id)
        if not project then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end
        
        local list = get_harpooned()
        local existing_slot = find_project_index(list, project_id)
        
        if existing_slot then
            local toggle_mode = vault.settings.get("toggle_mode") == "true"
            if toggle_mode then
                table.remove(list, existing_slot)
                save_harpooned(list)
                sync_footer(list, nil)
                vault.notification.success(t(locale, "unmarked_success", { name = project.name, slot = tostring(existing_slot) }))
            else
                vault.notification.info(t(locale, "already_marked", { name = project.name, slot = tostring(existing_slot) }))
            end
            return
        end
        
        -- Harpoon lists are typically capped at 4 slots
        if #list >= 4 then
            list[4] = { id = project.id, name = project.name }
            save_harpooned(list)
            sync_footer(list, find_project_index(list, project_id))
            vault.notification.success(t(locale, "marked_success", { name = project.name, slot = "4" }))
        else
            table.insert(list, { id = project.id, name = project.name })
            save_harpooned(list)
            sync_footer(list, find_project_index(list, project_id))
            vault.notification.success(t(locale, "marked_success", { name = project.name, slot = tostring(#list) }))
        end
        
    elseif command_id == "quick_menu" then
        local list = get_harpooned()
        if #list == 0 then
            vault.ui.show_quick_pick({
                title = t(locale, "menu_title"),
                items = {
                    { id = "empty", label = t(locale, "empty_menu") }
                }
            })
            return
        end
        
        local items: {QuickPickItem} = {}
        for i, item in ipairs(list) do
            table.insert(items, {
                id = tostring(i),
                label = tostring(i) .. ". " .. item.name,
                detail = item.id,
                icon = "mdi--anchor"
            })
        end
        
        local selected = vault.ui.show_quick_pick({
            title = t(locale, "menu_title"),
            items = items
        })
        
        if selected then
            local idx = tonumber(selected)
            if idx and list[idx] then
                local item = list[idx]
                vault.ui.open_project_file(item.id, "", 0)
                vault.notification.info(t(locale, "jump_success", { slot = tostring(idx), name = item.name }))
            end
        end
        
    elseif command_id:find("^jump_") then
        local slot_str = command_id:match("^jump_(%d+)$")
        local slot = slot_str and tonumber(slot_str)
        if slot then
            local list = get_harpooned()
            if list[slot] then
                local item = list[slot]
                vault.ui.open_project_file(item.id, "", 0)
                vault.notification.info(t(locale, "jump_success", { slot = tostring(slot), name = item.name }))
            else
                vault.notification.error(t(locale, "jump_empty", { slot = tostring(slot) }))
            end
        end
        
    elseif command_id == "clear_harpoon" then
        save_harpooned({})
        sync_footer({}, nil)
        vault.notification.success(t(locale, "cleared_success"))

    elseif command_id == "init" then
        -- Restore footer state on app startup (no project focused yet)
        sync_footer(get_harpooned(), nil)

    elseif command_id == "project_focus" then
        -- Called by the app whenever the active project changes
        local project_id = context and context.projectId
        local list = get_harpooned()
        local slot: number? = nil
        if project_id and project_id ~= "" then
            slot = find_project_index(list, project_id)
        end
        sync_footer(list, slot)
    end
end

return plugin
