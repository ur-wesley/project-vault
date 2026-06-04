--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")

type PluginCommandContext = {
    projectId: string?
}

type GitCommit = {
    hash: string,
    author: string,
    email: string,
    subject: string,
    date: string,
    relativeDate: string,
}

type GitStatus = {
    branch: string,
    ahead: number,
    behind: number,
    isDirty: boolean,
    hasUpstream: boolean,
    version: string?,
}

local plugin = {
    name = "Git Integration",
    description = "View repository commits and track status directly inside your launcher.",
    version = "1.0.0",
    category = "utility",
    locales = {
        en = {
            name = "Git Integration",
            description = "View repository commits and track status directly inside your launcher.",
            ["command.view_commits"] = "Git: View Last Commits",
            ["command.switch_branch"] = "Git: Switch Branch",
            
            no_active_project = "Git: No active project is currently selected.",
            no_git_repo = "This project is not a Git repository.",
            error_loading = "Failed to load Git logs.",
            dirty = "dirty",
            clean = "clean",
            status_tooltip = "Branch: {branch} ({state})",
            dialog_title = "Git Commits — {name}",
            
            error_loading_branches = "Failed to load Git branches.",
            current_branch = "Current Branch",
            no_branches_found = "No Git branches found.",
            switch_branch_title = "Select Branch to Checkout",
            already_on_branch = "Already on branch '{branch}'.",
            switch_success = "Successfully switched to branch '{branch}'!",
            switch_error = "Failed to switch to '{branch}': {error}",
        },
        de = {
            name = "Git-Integration",
            description = "Repository-Commits anzeigen und Status direkt im Launcher verfolgen.",
            ["command.view_commits"] = "Git: Letzte Commits anzeigen",
            ["command.switch_branch"] = "Git: Branch wechseln",
            
            no_active_project = "Git: Es ist derzeit kein aktives Projekt ausgewählt.",
            no_git_repo = "Dieses Projekt ist kein Git-Repository.",
            error_loading = "Fehler beim Laden der Git-Logs.",
            dirty = "geändert",
            clean = "sauber",
            status_tooltip = "Branch: {branch} ({state})",
            dialog_title = "Git-Commits — {name}",
            
            error_loading_branches = "Fehler beim Laden der Git-Branches.",
            current_branch = "Aktueller Branch",
            no_branches_found = "Keine Git-Branches gefunden.",
            switch_branch_title = "Branch zum Auschecken auswählen",
            already_on_branch = "Bereits auf Branch '{branch}'.",
            switch_success = "Erfolgreich zum Branch '{branch}' gewechselt!",
            switch_error = "Fehler beim Wechseln zu '{branch}': {error}",
        }
    },
    config = {
        {
            key = "show_branch",
            type = "boolean",
            label = "Show Branch",
            description = "If enabled, displays the current Git branch name in the status bar footer.",
            default = true
        },
        {
            key = "show_tag",
            type = "boolean",
            label = "Show Latest Tag",
            description = "If enabled, displays the latest tag (release version) in the status bar footer.",
            default = false
        }
    },
    commands = {
        { id = "view_commits", title = "Git: View Last Commits", scope = "project" },
        { id = "switch_branch", title = "Git: Switch Branch", scope = "project" }
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

-- Refresh footer git status chip for focused project
local function update_git_footer(projectId: string?, locale: string)
    if not projectId or projectId == "" then
        pcall(vault.ui.clear_footer, "git-branch")
        return
    end

    local active_project = vault.projects.get_active()
    if projectId ~= active_project then
        return
    end

    local ok, raw_status = pcall(vault.git.status, projectId)
    if not ok then
        pcall(vault.ui.clear_footer, "git-branch")
        return
    end
    if not raw_status then
        pcall(vault.ui.clear_footer, "git-branch")
        return
    end

    local status: GitStatus = vault.json.parse(raw_status)
    if not status or not status.branch then
        pcall(vault.ui.clear_footer, "git-branch")
        return
    end

    local ok_branch, val_branch = pcall(vault.settings.get, "show_branch")
    local ok_tag, val_tag = pcall(vault.settings.get, "show_tag")

    local show_branch = true
    if ok_branch and val_branch ~= nil then
        show_branch = val_branch ~= "false"
    end

    local show_tag = false
    if ok_tag and val_tag ~= nil then
        show_tag = val_tag == "true"
    end

    if not show_branch and not show_tag then
        pcall(vault.ui.clear_footer, "git-branch")
        return
    end

    local state_text = status.isDirty and t(locale, "dirty") or t(locale, "clean")
    local tooltip = t(locale, "status_tooltip", { branch = status.branch, state = state_text })
    
    local footer_text = "git: "
    if show_branch then
        footer_text = footer_text .. status.branch
        if status.isDirty then
            footer_text = footer_text .. "*"
        end
    end

    local version_str = if type(status.version) == "string" then status.version else nil
    if show_tag and version_str and version_str ~= "" then
        if show_branch then
            footer_text = footer_text .. " (" .. version_str .. ")"
        else
            footer_text = footer_text .. version_str
            if status.isDirty then
                footer_text = footer_text .. "*"
            end
        end
    end

    if status.ahead > 0 or status.behind > 0 then
        footer_text = footer_text .. " [↑" .. tostring(status.ahead) .. " ↓" .. tostring(status.behind) .. "]"
    end

    local color = "success"
    if status.isDirty then
        color = "warning"
    end

    pcall(vault.ui.set_footer, {
        id = "git-branch",
        text = footer_text,
        icon = "mdi--git",
        tooltip = tooltip,
        command = "switch_branch",
        color = color,
        position = "right"
    })
end

-- Render and display/refresh commits dialog modal
local function refresh_commits(projectId: string?, locale: string, showWarnings: boolean)
    if not projectId or projectId == "" then
        return
    end

    local ok, raw_log = pcall(vault.git.log, projectId, 15)
    if not ok or not raw_log then
        if showWarnings then
            vault.notification.error(t(locale, "error_loading"))
        end
        return
    end

    local commits: {GitCommit} = vault.json.parse(raw_log)
    if not commits or #commits == 0 then
        if showWarnings then
            vault.notification.info(t(locale, "no_git_repo"))
        end
        return
    end

    -- Retrieve project name
    local raw_projects = vault.projects.list()
    local projects = vault.json.parse(raw_projects)
    local project_name = "Repository"
    for _, p in ipairs(projects) do
        if p.id == projectId then
            project_name = p.name
            break
        end
    end

    -- Build gorgeous Markdown
    local md = {}
    table.insert(md, "# Last Commits")
    table.insert(md, "Recent activity history for **" .. project_name .. "**:")
    table.insert(md, "")
    table.insert(md, "| Hash | Author | Date | Subject |")
    table.insert(md, "| :--- | :--- | :--- | :--- |")

    for _, commit in ipairs(commits) do
        local short_hash = commit.hash:sub(1, 8)
        local author_name = commit.author
        local relative_time = commit.relativeDate
        local subject = commit.subject

        table.insert(md, string.format(
            "| `[%s]` | **%s** | *%s* | %s |",
            short_hash, author_name, relative_time, subject
        ))
    end

    local markdown_content = table.concat(md, "\n")
    vault.ui.show_markdown_dialog(
        t(locale, "dialog_title", { name = project_name }),
        markdown_content
    )
end

function plugin.execute(command_id: string, context: PluginCommandContext?)
    local locale: string = vault.i18n.get_locale()
    local is_viewing_commits = vault.settings.get("is_viewing_commits") == "true"

    if command_id == "init" or command_id == "project_focus" or command_id == "project_state_changed" then
        local projectId = context and context.projectId
        if not projectId or projectId == "" then
            projectId = vault.projects.get_active()
        end
        update_git_footer(projectId, locale)
        if is_viewing_commits then
            refresh_commits(projectId, locale, false)
        end
        return
    elseif command_id == "markdown_dialog_closed" then
        vault.settings.set("is_viewing_commits", "false")
        return
    end

    if command_id == "switch_branch" then
        local projectId = context and context.projectId
        if not projectId or projectId == "" then
            projectId = vault.projects.get_active()
        end
        if not projectId or projectId == "" then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end

        -- Find project path
        local raw_projects = vault.projects.list()
        local projects = vault.json.parse(raw_projects)
        local project = nil
        for _, p in ipairs(projects) do
            if p.id == projectId then
                project = p
                break
            end
        end

        if not project then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end

        local res = vault.shell.execute("git", { "branch", "--format=%(refname:short)" }, project.path)
        if not res.success then
            vault.notification.error(t(locale, "error_loading_branches"))
            return
        end

        -- Get current branch
        local status_ok, raw_status = pcall(vault.git.status, projectId)
        local current_branch = nil
        if status_ok and raw_status then
            local status = vault.json.parse(raw_status)
            if status then
                current_branch = status.branch
            end
        end

        local items = {}
        for line in res.stdout:gmatch("[^\r\n]+") do
            local branch_name = line:match("^%s*(.-)%s*$")
            if branch_name and branch_name ~= "" then
                local is_current = branch_name == current_branch
                local icon = is_current and "mdi--check" or "mdi--source-branch"
                local detail = is_current and t(locale, "current_branch") or nil
                table.insert(items, {
                    id = branch_name,
                    label = branch_name,
                    icon = icon,
                    detail = detail,
                })
            end
        end

        if #items == 0 then
            vault.notification.info(t(locale, "no_branches_found"))
            return
        end

        local selected = vault.ui.show_quick_pick({
            title = t(locale, "switch_branch_title"),
            items = items
        })

        if selected then
            if selected == current_branch then
                vault.notification.info(t(locale, "already_on_branch", { branch = selected }))
                return
            end

            local checkout_res = vault.shell.execute("git", { "checkout", selected }, project.path)
            if checkout_res.success then
                vault.notification.success(t(locale, "switch_success", { branch = selected }))
                update_git_footer(projectId, locale)
                if is_viewing_commits then
                    refresh_commits(projectId, locale, false)
                end
            else
                local err_msg = checkout_res.stderr:match("^%s*(.-)%s*$")
                if err_msg == "" then
                    err_msg = checkout_res.stdout:match("^%s*(.-)%s*$")
                end
                vault.notification.error(t(locale, "switch_error", { branch = selected, error = err_msg }))
            end
        end
        return
    end

    if command_id == "view_commits" then
        local projectId = context and context.projectId
        if not projectId or projectId == "" then
            projectId = vault.projects.get_active()
        end
        if not projectId or projectId == "" then
            vault.notification.error(t(locale, "no_active_project"))
            return
        end

        vault.settings.set("is_viewing_commits", "true")
        refresh_commits(projectId, locale, true)
    end
end

return plugin
