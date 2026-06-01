--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
-- At runtime, Lua returns the pre-loaded vault table from package.loaded (no disk I/O).
local vault = require("../vault")

type SearchResult = {
	projectId: string,
	path: string,
	line: number,
	text: string,
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
	name = "Search All Projects",
	description = "Searches through all files of all projects in the library for a given term.",
	version = "1.0.0",
	category = "utility",
	locales = {
		en = {
			name = "Search All Projects",
			description = "Searches through all files of all projects in the library for a given term.",
			["command.search_all"] = "Search All Projects",
			-- runtime dialogue strings
			dialog_title = "Search All Projects",
			dialog_placeholder = "Enter search term...",
			cancel_msg = "Search cancelled or empty query.",
			searching_msg = "Searching all projects for: {query}",
			scanning_msg = "Scanning project: {name} ({path})",
			no_projects_title = "Search Results",
			no_projects_label = "No projects in library.",
			no_projects_detail = "Add library locations first.",
			no_matches_title = "Search Results: '{query}'",
			no_matches_label = "No matches found.",
			no_matches_detail = "No files match the term '{query}'.",
			results_title = "Search Results for '{query}' ({count} matches)",
		},
		de = {
			name = "Alle Projekte durchsuchen",
			description = "Durchsucht alle Dateien aller Projekte in der Bibliothek nach einem bestimmten Begriff.",
			["command.search_all"] = "Alle Projekte durchsuchen",
			-- runtime dialogue strings
			dialog_title = "Alle Projekte durchsuchen",
			dialog_placeholder = "Suchbegriff eingeben...",
			cancel_msg = "Suche abgebrochen oder leere Anfrage.",
			searching_msg = "Suche in allen Projekten nach: {query}",
			scanning_msg = "Scanne Projekt: {name} ({path})",
			no_projects_title = "Suchergebnisse",
			no_projects_label = "Keine Projekte in der Bibliothek.",
			no_projects_detail = "Füge zuerst Bibliotheksordner hinzu.",
			no_matches_title = "Suchergebnisse: '{query}'",
			no_matches_label = "Keine Treffer gefunden.",
			no_matches_detail = "Keine Dateien entsprechen dem Begriff '{query}'.",
			results_title = "Suchergebnisse für '{query}' ({count} Treffer)",
		},
	},
	commands = {
		{
			id = "search_all",
			title = "Search All Projects",
			scope = "global",
		},
	},
}

-- Basename helper
local function get_basename(path: string): string
	local name = path:match("([^/\\]+)$")
	return name or path
end

-- Ignored folders to keep search fast and resource-efficient
local ignored_dirs: { [string]: boolean } = {
	["node_modules"] = true,
	[".git"] = true,
	["target"] = true,
	["dist"] = true,
	[".next"] = true,
	["build"] = true,
	["bin"] = true,
	["obj"] = true,
}

local function is_ignored(name: string): boolean
	return ignored_dirs[name] == true
end

-- Recursive search walker
local function search_folder(project_id: string, dir_path: string, query: string, results: { SearchResult })
	local ok, entries = pcall(vault.fs.list_dir, dir_path)
	if not ok or not entries then
		return
	end

	for _, entry_path in ipairs(entries) do
		local name = get_basename(entry_path)
		if vault.fs.is_dir(entry_path) then
			if not is_ignored(name) then
				search_folder(project_id, entry_path, query, results)
			end
		elseif vault.fs.is_file(entry_path) then
			local ok2, content = pcall(vault.fs.read_file, entry_path)
			if ok2 and content then
				local lower_content = content:lower()
				local lower_query = query:lower()
				if lower_content:find(lower_query, 1, true) then
					local line_no = 1
					for line in content:gmatch("([^\r\n]*)") do
						if line:lower():find(lower_query, 1, true) then
							table.insert(results, {
								projectId = project_id,
								path = entry_path,
								line = line_no,
								text = line:gsub("^%s+", ""),
							})
						end
						line_no = line_no + 1
					end
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
	if command_id == "search_all" then
		local locale = vault.i18n.get_locale()

		-- 1. Ask user for query
		local query = vault.ui.show_input_box({
			title = t(locale, "dialog_title"),
			placeholder = t(locale, "dialog_placeholder"),
		})

		if not query or query == "" then
			vault.log.info(t(locale, "cancel_msg"))
			return
		end

		vault.log.info(t(locale, "searching_msg", { query = query }))

		-- 2. Fetch projects
		local raw_projects = vault.projects.list()
		local projects = vault.json.parse(raw_projects)

		if not projects or #projects == 0 then
			vault.ui.show_quick_pick({
				title = t(locale, "no_projects_title"),
				items = {
					{
						id = "no_projects",
						label = t(locale, "no_projects_label"),
						detail = t(locale, "no_projects_detail"),
					},
				},
			})
			return
		end

		-- 3. Search folders
		local results: { SearchResult } = {}
		for _, project in ipairs(projects) do
			vault.log.info(t(locale, "scanning_msg", { name = project.name, path = project.path }))
			search_folder(project.id, project.path, query, results)
		end

		-- 4. Display results
		if #results == 0 then
			vault.ui.show_quick_pick({
				title = t(locale, "no_matches_title", { query = query }),
				items = {
					{
						id = "no_matches",
						label = t(locale, "no_matches_label"),
						detail = t(locale, "no_matches_detail", { query = query }),
					},
				},
			})
			return
		end

		local items: { QuickPickItem } = {}
		for i, res in ipairs(results) do
			table.insert(items, {
				id = tostring(i),
				label = get_basename(res.path) .. ":" .. tostring(res.line),
				detail = res.text,
				icon = "mdi--file-find-outline",
			})
		end

		local selected = vault.ui.show_quick_pick({
			title = t(locale, "results_title", { query = query, count = tostring(#results) }),
			items = items,
		})

		if selected then
			local idx = tonumber(selected)
			if idx and results[idx] then
				local res = results[idx]
				vault.ui.open_project_file(res.projectId, res.path, res.line)
			end
		end
	end
end

return plugin
