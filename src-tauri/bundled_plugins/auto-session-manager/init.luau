--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")

type PluginCommandContext = {
	projectId: string?,
}

type ProjectStateContext = {
	projectId: string?,
	detailTab: string?,
	subDetail: string?,
}

local plugin = {
	name = "Auto Session Manager",
	description = "Automatically save and restore your last opened file and line number for each project.",
	version = "1.0.0",
	category = "utility",
	locales = {
		en = {
			name = "Auto Session Manager",
			description = "Automatically save and restore your last opened file and line number for each project.",
			["command.clear_session"] = "Sessions: Clear Saved Session for Current Project",
			
			session_cleared = "Session history cleared for project '{name}'.",
			no_active_project = "No active project is focused to clear session.",
		},
		de = {
			name = "Auto-Sitzungs-Manager",
			description = "Automatisches Speichern und Wiederherstellen der zuletzt geöffneten Datei und Zeilennummer für jedes Projekt.",
			["command.clear_session"] = "Sitzungen: Gespeicherte Sitzung für aktuelles Projekt löschen",
			
			session_cleared = "Sitzungsverlauf für Projekt '{name}' gelöscht.",
			no_active_project = "Es ist kein aktives Projekt ausgewählt, um die Sitzung zu löschen.",
		},
	},
	commands = {
		{
			id = "clear_session",
			title = "Sessions: Clear Saved Session for Current Project",
			scope = "project",
		},
	},
}

-- Local session tracking
local focused_project_id: string? = nil
local restoring = false

-- Translation helper
local function t(locale: string, key: string, args: { [string]: string }?): string
	local dict = plugin.locales[locale] or plugin.locales["en"] or {}
	local str = dict[key] or key
	if args then
		for k, v in pairs(args) do
			str = str:gsub("{" .. k .. "}", tostring(v))
		end
	end
	return str
end

-- Resolve project name helper
local function get_project_name(project_id: string): string
	local raw = vault.projects.list()
	local ok, list = pcall(vault.json.parse, raw)
	if ok and list then
		for _, p in ipairs(list) do
			if p.id == project_id then
				return p.name
			end
		end
	end
	return "Unknown Project"
end

-- Restore session logic
local function restore_session(project_id: string)
	if restoring then
		return
	end
	restoring = true

	local tab = vault.settings.get("session_tab:" .. project_id)
	local file = vault.settings.get("session_file:" .. project_id)

	if tab == "files" and file and file ~= "" then
		local file_path, line_str = file:match("^(.+)::(%d+)$")
		if not file_path then
			file_path = file
		end
		local line = tonumber(line_str) or 1

		vault.log.info("Auto Session: Restoring open file '" .. file_path .. "' at line " .. tostring(line))
		pcall(vault.ui.open_project_file, project_id, file_path, line)
	elseif tab and tab ~= "" then
		vault.log.info("Auto Session: Restoring active tab '" .. tab .. "'")
		pcall(vault.ui.open_project_file, project_id, "", 0)
	end

	restoring = false
end

function plugin.execute(command_id: string, context: any)
	local locale = vault.i18n.get_locale()

	if command_id == "clear_session" then
		local project_id = context and context.projectId
		if not project_id or project_id == "" then
			vault.notification.error(t(locale, "no_active_project"))
			return
		end

		vault.settings.set("session_tab:" .. project_id, "")
		vault.settings.set("session_file:" .. project_id, "")
		
		local name = get_project_name(project_id)
		vault.notification.success(t(locale, "session_cleared", { name = name }))

	elseif command_id == "project_focus" then
		-- Triggered when project changes focus
		local project_id = context and context.projectId
		if project_id and project_id ~= "" then
			focused_project_id = project_id
			restore_session(project_id)
		else
			focused_project_id = nil
		end

	elseif command_id == "project_state_changed" then
		-- Real-time UI interaction state changed
		local ctx = context :: ProjectStateContext
		local project_id = ctx and ctx.projectId

		if not project_id or project_id == "" then
			focused_project_id = nil
			return
		end

		-- If project has changed and it wasn't tracked, handle focus restore first
		if project_id ~= focused_project_id then
			focused_project_id = project_id
			restore_session(project_id)
			return
		end

		-- Otherwise, save the active editing session state
		if not restoring then
			local tab = ctx.detailTab
			local file = ctx.subDetail

			if tab == "files" and file and file ~= "" then
				vault.settings.set("session_tab:" .. project_id, "files")
				vault.settings.set("session_file:" .. project_id, file)
			elseif tab and tab ~= "" then
				vault.settings.set("session_tab:" .. project_id, tab)
				vault.settings.set("session_file:" .. project_id, "")
			end
		end
	end
end

return plugin
