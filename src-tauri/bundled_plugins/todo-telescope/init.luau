--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")

type TodoItem = {
	projectId: string,
	projectName: string,
	path: string,
	line: number,
	text: string,
	type: string, -- TODO, FIXME, BUG, HACK
}

type QuickPickItem = {
	id: string,
	label: string,
	detail: string?,
	icon: string?,
}

type PluginCommandContext = {
	projectId: string?,
}

local plugin = {
	name = "Todo Telescope",
	description = "Find and navigate to TODOs, FIXMEs, BUGs, and HACKs across all workspace projects.",
	version = "1.0.0",
	category = "utility",
	locales = {
		en = {
			name = "Todo Telescope",
			description = "Find and navigate to TODOs, FIXMEs, BUGs, and HACKs across all workspace projects.",
			["command.scan_todos"] = "Telescope: Search Workspaces for TODOs",
			
			-- Dialogue and notification keys
			scanning_start = "Scanning library projects...",
			no_projects = "No active projects found in library. Add some repositories first.",
			no_todos = "No TODOs or bookmarks found in your projects.",
			dialog_title = "Todo Telescope ({count} items found)",
			cancel_msg = "Scan cancelled.",
		},
		de = {
			name = "Todo-Teleskop",
			description = "Suchen und navigieren Sie zu TODOs, FIXMEs, BUGs und HACKs in allen Workspace-Projekten.",
			["command.scan_todos"] = "Teleskop: Workspace nach TODOs durchsuchen",
			
			-- Dialogue and notification keys
			scanning_start = "Scanne Bibliotheks-Projekte...",
			no_projects = "Keine aktiven Projekte in der Bibliothek gefunden. Fügen Sie zuerst Repositories hinzu.",
			no_todos = "Keine TODOs oder Lesezeichen in Ihren Projekten gefunden.",
			dialog_title = "Todo-Teleskop ({count} Einträge gefunden)",
			cancel_msg = "Suche abgebrochen.",
		},
	},
	commands = {
		{
			id = "scan_todos",
			title = "Telescope: Search Workspaces for TODOs",
			scope = "global",
		},
	},
}

-- Basename helper
local function get_basename(path: string): string
	local name = path:match("([^/\\]+)$")
	return name or path
end

-- Ignored folders to keep the search highly performant
local ignored_dirs: { [string]: boolean } = {
	["node_modules"] = true,
	[".git"] = true,
	["target"] = true,
	["dist"] = true,
	[".next"] = true,
	["build"] = true,
	["bin"] = true,
	["obj"] = true,
	[".svelte-kit"] = true,
	[".nuxt"] = true,
	[".turbo"] = true,
	["vendor"] = true,
}

local function is_ignored(name: string): boolean
	return ignored_dirs[name] == true
end

-- Recursive directory walker
local function scan_folder(project_id: string, project_name: string, dir_path: string, results: { TodoItem })
	local ok, entries = pcall(vault.fs.list_dir, dir_path)
	if not ok or not entries then
		return
	end

	for _, entry_path in ipairs(entries) do
		local name = get_basename(entry_path)
		if vault.fs.is_dir(entry_path) then
			if not is_ignored(name) then
				scan_folder(project_id, project_name, entry_path, results)
			end
		elseif vault.fs.is_file(entry_path) then
			local ok2, content = pcall(vault.fs.read_file, entry_path)
			if ok2 and content then
				local line_no = 1
				for line in content:gmatch("([^\r\n]*)") do
					local matched_type = nil
					if line:find("TODO:") then
						matched_type = "TODO"
					elseif line:find("FIXME:") then
						matched_type = "FIXME"
					elseif line:find("BUG:") then
						matched_type = "BUG"
					elseif line:find("HACK:") then
						matched_type = "HACK"
					end

					if matched_type then
						table.insert(results, {
							projectId = project_id,
							projectName = project_name,
							path = entry_path,
							line = line_no,
							text = line:gsub("^%s+", ""),
							type = matched_type,
						})
					end
					line_no = line_no + 1
				end
			end
		end
	end
end

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

function plugin.execute(command_id: string, context: PluginCommandContext?)
	local locale = vault.i18n.get_locale()

	if command_id == "scan_todos" then
		vault.log.info(t(locale, "scanning_start"))

		-- 1. Fetch all active projects
		local raw_projects = vault.projects.list()
		local projects = vault.json.parse(raw_projects)

		if not projects or #projects == 0 then
			vault.notification.error(t(locale, "no_projects"))
			return
		end

		-- 2. Traverse and collect bookmarks
		local results: { TodoItem } = {}
		for _, p in ipairs(projects) do
			scan_folder(p.id, p.path, results)
		end

		if #results == 0 then
			vault.notification.info(t(locale, "no_todos"))
			return
		end

		-- 3. Prepare searchable list
		local items: { QuickPickItem } = {}
		for i, res in ipairs(results) do
			local icon = "mdi--bookmark-outline"
			if res.type == "BUG" then
				icon = "mdi--bug-outline"
			elseif res.type == "FIXME" then
				icon = "mdi--alert-circle-outline"
			elseif res.type == "HACK" then
				icon = "mdi--fire"
			end

			table.insert(items, {
				id = tostring(i),
				label = string.format("[%s] %s:%d", res.type, get_basename(res.path), res.line),
				detail = string.format("%s » %s", res.projectName, res.text),
				icon = icon,
			})
		end

		-- 4. Display quick pick
		local selected = vault.ui.show_quick_pick({
			title = t(locale, "dialog_title", { count = tostring(#results) }),
			items = items,
		})

		if selected then
			local idx = tonumber(selected)
			if idx and results[idx] then
				local res = results[idx]
				vault.ui.open_project_file(res.projectId, res.path, res.line)
			end
		else
			vault.log.info(t(locale, "cancel_msg"))
		end
	end
end

return plugin
