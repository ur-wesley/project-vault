--!strict
local vault = require("../vault")

type PluginCommandContext = {
    projectId: string?,
    elementId: string?
}

type GitStatus = {
    branch: string,
    ahead: number,
    behind: number,
    isDirty: boolean,
    hasUpstream: boolean,
    version: string?
}

local plugin = {
    name = "Git Enrichment",
    description = "Enriches your workspace with branch info, git pull actions, settings forms, and file/task status decorations.",
    version = "1.0.0",
    category = "utility",
    locales = {
        en = {
            name = "Git Enrichment",
            description = "Enriches your workspace with branch info, git pull actions, settings forms, and file/task status decorations.",
            ["command.pull"] = "Git: Pull Remote Changes",
            ["command.show_settings"] = "Git Enrichment: Configure Settings",
            pull_success = "Git pull completed successfully!",
            pull_error = "Git pull failed: {err}",
            settings_saved = "Settings saved successfully!"
        },
        de = {
            name = "Git-Erweiterung",
            description = "Erweitert den Arbeitsbereich um Branch-Infos, Git-Pull-Aktionen, Einstellungsformulare sowie Datei- und Task-Status-Markierungen.",
            ["command.pull"] = "Git: Remote-Änderungen abrufen (Pull)",
            ["command.show_settings"] = "Git-Erweiterung: Einstellungen konfigurieren",
            pull_success = "Git Pull erfolgreich abgeschlossen!",
            pull_error = "Git Pull fehlgeschlagen: {err}",
            settings_saved = "Einstellungen erfolgreich gespeichert!"
        }
    },
    config = {
        {
            key = "decorate_files",
            type = "boolean",
            label = "Decorate Files",
            description = "Enable status icons next to modified, added, and untracked files in the file tree.",
            default = true
        }
    },
    commands = {
        { id = "pull", title = "Git: Pull Remote Changes", scope = "global" },
        { id = "show_settings", title = "Git Enrichment: Configure Settings", scope = "global" }
    }
}

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

local function get_git_status(project_id: string): GitStatus?
    local status_json = vault.git.get_status(project_id)
    if not status_json or status_json == "null" or status_json == "" then
        return nil
    end
    local ok, status = pcall(vault.json.parse, status_json)
    if ok and status and status.branch then
        return status
    end
    return nil
end

local function sync_header(project_id: string)
    local status = get_git_status(project_id)
    if not status then
        vault.ui.clear_header_widget("git_branch")
        vault.ui.clear_header_widget("git_status_badge")
        return
    end

    -- 1. Register Branch Button Widget
    local color = "success"
    if status.behind > 0 then
        color = "warning"
    elseif status.isDirty then
        color = "muted"
    end

    local tooltip = "Branch: " .. status.branch
    if status.ahead > 0 or status.behind > 0 then
        tooltip = tooltip .. "\nAhead: " .. tostring(status.ahead) .. ", Behind: " .. tostring(status.behind)
    end
    tooltip = tooltip .. "\nClick to run git pull"

    vault.ui.set_header_widget({
        id = "git_branch",
        type = "button",
        text = status.branch,
        icon = "mdi--git",
        tooltip = tooltip,
        command = "pull",
        color = color
    })

    -- 2. Register Status Badge Widget
    vault.ui.set_header_widget({
        id = "git_status_badge",
        type = "badge",
        text = status.isDirty and "Dirty" or "Clean",
        icon = status.isDirty and "mdi--alert-circle" or "mdi--check-circle",
        color = status.isDirty and "warning" or "success",
        tooltip = status.isDirty and "Working directory has uncommitted changes" or "Working tree is clean.\nClick to open settings.",
        command = "show_settings"
    })
end

function plugin.get_decorations(project_id: string, tab_id: string, element_ids: { string })
    local decs = {}
    
    if tab_id == "files" then
        local decorate = vault.settings.get("decorate_files") ~= "false"
        if not decorate then
            return decs
        end

        local res = vault.git.run(project_id, { "status", "--porcelain" })
        if not res.success then
            return decs
        end

        local status_map = {}
        for line in res.stdout:gmatch("[^\r\n]+") do
            if #line >= 4 then
                local code = line:sub(1, 2)
                local file_path = line:sub(4)
                -- Strip quotes if any
                if file_path:sub(1, 1) == '"' and file_path:sub(-1) == '"' then
                    file_path = file_path:sub(2, -2)
                end

                local icon, color, label, tooltip
                if code == " M" or code == "M " then
                    icon = "mdi--pencil"
                    color = "#eab308" -- HSL-tailored warning yellow
                    label = "M"
                    tooltip = "Modified file"
                elseif code == "??" then
                    icon = "mdi--plus"
                    color = "#22c55e" -- HSL-tailored success green
                    label = "U"
                    tooltip = "Untracked file"
                elseif code == " A" or code == "A " then
                    icon = "mdi--plus"
                    color = "#22c55e"
                    label = "A"
                    tooltip = "Added to index"
                end

                if label then
                    status_map[file_path] = {
                        before = {
                            {
                                icon = icon,
                                color = color,
                                tooltip = tooltip
                            }
                        },
                        after = {
                            {
                                label = label,
                                color = color == "#eab308" and "bg-yellow-500/10 text-yellow-600 border-yellow-500/25" or "bg-green-500/10 text-green-600 border-green-500/25",
                                tooltip = tooltip
                            }
                        }
                    }
                end
            end
        end

        for _, el_id in ipairs(element_ids) do
            if status_map[el_id] then
                decs[el_id] = status_map[el_id]
            end
        end

    elseif tab_id == "tasks" then
        -- Add a tiny git icon/badge before tasks with git actions
        for _, el_id in ipairs(element_ids) do
            local lower_id = el_id:lower()
            if lower_id:find("git") or lower_id:find("pull") or lower_id:find("push") or lower_id:find("sync") then
                decs[el_id] = {
                    before = {
                        {
                            icon = "mdi--git",
                            color = "#f05032",
                            tooltip = "Executes a Git-related command"
                        }
                    }
                }
            end
        end
    end

    return decs
end

function plugin.execute(command_id: string, context: PluginCommandContext?)
    local locale = vault.i18n.get_locale()
    local project_id = context and context.projectId or vault.projects.get_active()

    if command_id == "pull" then
        if not project_id or project_id == "" then
            return
        end
        vault.notification.info("Running git pull...")
        local res = vault.git.run(project_id, { "pull" })
        if res.success then
            vault.notification.success(t(locale, "pull_success"))
            sync_header(project_id)
            -- Publish project:changed via event helper to trigger file tree reload and decorations updates
            local payload = vault.json.stringify({ projectId = project_id, changeType = "git" })
            vault.event.publish("project:changed", payload)
        else
            vault.notification.error(t(locale, "pull_error", { err = res.stderr or "Unknown error" }))
        end

    elseif command_id == "show_settings" then
        local current_dec = vault.settings.get("decorate_files") ~= "false"
        local res = vault.ui.show_form({
            title = "Git Enrichment Settings",
            fields = {
                {
                    id = "decorate_files",
                    label = "Decorate Files in File Tree",
                    fieldType = "boolean",
                    defaultValue = current_dec,
                    required = false
                },
                {
                    id = "verification_check",
                    label = "Verification check (regex pattern match test)",
                    fieldType = "text",
                    placeholder = "Type something starting with 'Git'...",
                    pattern = "^Git.*",
                    validationMessage = "Validation Error: Must start with 'Git'"
                }
            }
        })
        if res then
            vault.settings.set("decorate_files", tostring(res.decorate_files))
            vault.notification.success(t(locale, "settings_saved"))
            if project_id and project_id ~= "" then
                sync_header(project_id)
                -- Notify frontend to refresh decorations
                local payload = vault.json.stringify({ projectId = project_id, changeType = "git" })
                vault.event.publish("project:changed", payload)
            end
        end

    elseif command_id == "init" then
        if project_id and project_id ~= "" then
            sync_header(project_id)
        end

    elseif command_id == "project_focus" then
        if project_id and project_id ~= "" then
            sync_header(project_id)
        else
            vault.ui.clear_header_widget("git_branch")
            vault.ui.clear_header_widget("git_status_badge")
        end
    end
end

return plugin
