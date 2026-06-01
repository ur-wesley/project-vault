--!strict
-- require("../vault") resolves vault.luau statically for full type inference.
local vault = require("../vault")

type FileItem = {
	projectId: string,
	projectName: string,
	path: string,
	relativePath: string,
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
	name = "Fuzzy Finder (fzf)",
	description = "Fuzzy find files across all projects in the library.",
	version = "1.0.1",
	category = "utility",
	locales = {
		en = {
			name = "Fuzzy Finder (fzf)",
			description = "Fuzzy find files across all projects in the library.",
			["command.find_files"] = "Fuzzy Finder (fzf): Find Files",
			dialog_title = "Fuzzy Finder (fzf)",
			dialog_placeholder = "Type to search files (e.g. src/main.rs)...",
			no_projects_title = "Fuzzy Finder",
			no_projects_label = "No projects in library.",
			no_projects_detail = "Add library locations first.",
			no_files_title = "Fuzzy Finder",
			no_files_label = "No files found.",
			no_files_detail = "Ensure you have projects with files inside.",
			scanning_msg = "Scanning project: {name}",
			found_files_msg = "Found {count} files across projects. Opening search...",
			cancel_msg = "Search cancelled.",
			results_title = "Fuzzy Finder (showing top {count} matches for '{query}')",
			results_empty_title = "Fuzzy Finder (showing top {count} files)",
		},
		de = {
			name = "Fuzzy Finder (fzf)",
			description = "Fuzzy-Suche nach Dateien in allen Projekten.",
			["command.find_files"] = "Fuzzy Finder (fzf): Dateien finden",
			dialog_title = "Fuzzy Finder (fzf)",
			dialog_placeholder = "Dateien suchen (z. B. src/main.rs)...",
			no_projects_title = "Fuzzy Finder",
			no_projects_label = "Keine Projekte in der Bibliothek.",
			no_projects_detail = "Füge zuerst Bibliotheksordner hinzu.",
			no_files_title = "Fuzzy Finder",
			no_files_label = "Keine Dateien gefunden.",
			no_files_detail = "Stelle sicher, dass du Projekte mit Dateien hast.",
			scanning_msg = "Scanne Projekt: {name}",
			found_files_msg = "{count} Dateien in Projekten gefunden. Suche wird geöffnet...",
			cancel_msg = "Suche abgebrochen.",
			results_title = "Fuzzy Finder (zeige die besten {count} Treffer für '{query}')",
			results_empty_title = "Fuzzy Finder (zeige die ersten {count} Dateien)",
		},
	},
	commands = {
		{
			id = "find_files",
			title = "Fuzzy Finder (fzf)",
			scope = "global",
		},
	},
}

-- Basename helper
local function get_basename(path: string): string
	local name = path:match("([^/\\]+)$")
	return name or path
end

-- Extension helper
local function get_extension(path: string): string
	return path:match("%.([^%.]+)$") or ""
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
	[".svelte-kit"] = true,
	[".nuxt"] = true,
	[".turbo"] = true,
	["vendor"] = true,
}

local function is_ignored(name: string): boolean
	return ignored_dirs[name] == true
end

-- Recursive folder scanning
local function scan_folder(project_id: string, project_name: string, base_path: string, current_dir: string, results: { FileItem })
	local ok, entries = pcall(vault.fs.list_dir, current_dir)
	if not ok or not entries then
		return
	end

	for _, entry_path in ipairs(entries) do
		local name = get_basename(entry_path)
		if vault.fs.is_dir(entry_path) then
			if not is_ignored(name) then
				scan_folder(project_id, project_name, base_path, entry_path, results)
			end
		elseif vault.fs.is_file(entry_path) then
			-- Calculate relative path
			local rel_path = entry_path
			if entry_path:sub(1, #base_path) == base_path then
				rel_path = entry_path:sub(#base_path + 1)
				-- Strip leading slash/backslash
				if rel_path:sub(1, 1) == "/" or rel_path:sub(1, 1) == "\\" then
					rel_path = rel_path:sub(2)
				end
			end
			rel_path = rel_path:gsub("\\", "/")

			table.insert(results, {
				projectId = project_id,
				projectName = project_name,
				path = entry_path,
				relativePath = rel_path,
			})
		end
	end
end

-- Highly optimized fuzzy-matching and scoring algorithm
local function fuzzy_match(str: string, query: string): number?
	local str_len = #str
	local query_len = #query
	if query_len == 0 then
		return 0
	end
	if query_len > str_len then
		return nil
	end

	local s_idx = 1
	local q_idx = 1
	local score = 0
	local consecutive = 0

	while s_idx <= str_len and q_idx <= query_len do
		local s_char = str:sub(s_idx, s_idx):lower()
		local q_char = query:sub(q_idx, q_idx):lower()

		if s_char == q_char then
			local char_score = 1
			-- Bonus for consecutive character matches
			if consecutive > 0 then
				char_score = char_score + consecutive * 2
			end
			-- Bonus for starting matches or folder boundary matches
			if s_idx == 1 or str:sub(s_idx - 1, s_idx - 1) == "/" then
				char_score = char_score + 5
			end

			score = score + char_score
			consecutive = consecutive + 1
			q_idx = q_idx + 1
		else
			consecutive = 0
		end
		s_idx = s_idx + 1
	end

	-- Verify all query characters were matched in order
	if q_idx > query_len then
		-- Path length penalty to rank closer/shorter matches higher
		score = score - (str_len * 0.1)
		return score
	else
		return nil
	end
end

-- Extension-to-icon mapping for premium aesthetics
local extension_icons: { [string]: string } = {
	rs = "mdi--language-rust",
	js = "mdi--language-javascript",
	jsx = "mdi--language-javascript",
	ts = "mdi--language-typescript",
	tsx = "mdi--language-typescript",
	json = "mdi--json",
	luau = "mdi--language-lua",
	lua = "mdi--language-lua",
	md = "mdi--markdown",
	html = "mdi--language-html5",
	css = "mdi--language-css3",
	toml = "mdi--cog-outline",
	yaml = "mdi--file-document-outline",
	yml = "mdi--file-document-outline",
	py = "mdi--language-python",
	go = "mdi--language-go",
	sh = "mdi--console",
	bat = "mdi--console",
	ps1 = "mdi--powershell",
}

local function get_icon(path: string): string
	local ext = get_extension(path):lower()
	return extension_icons[ext] or "mdi--file-outline"
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
	if command_id == "find_files" then
		local locale = vault.i18n.get_locale()

		-- 1. Fetch projects
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

		-- 2. Ask user for a search input query first
		local query = vault.ui.show_input_box({
			title = t(locale, "dialog_title"),
			placeholder = t(locale, "dialog_placeholder"),
		})

		-- Exit if cancelled (clicked escape or cancel button)
		if not query then
			vault.log.info(t(locale, "cancel_msg"))
			return
		end

		-- 3. Scan folders
		local results: { FileItem } = {}
		for _, project in ipairs(projects) do
			vault.log.info(t(locale, "scanning_msg", { name = project.name }))
			scan_folder(project.id, project.name, project.path, project.path, results)
		end

		if #results == 0 then
			vault.ui.show_quick_pick({
				title = t(locale, "no_files_title"),
				items = {
					{
						id = "no_files",
						label = t(locale, "no_files_label"),
						detail = t(locale, "no_files_detail"),
					},
				},
			})
			return
		end

		-- 4. Fuzzy match, rank, and score items
		local matched_results: { FileItem } = {}
		local title = ""

		if query == "" then
			-- No query entered (just hit enter) -> Show first 300 files
			local limit = math.min(#results, 300)
			for i = 1, limit do
				table.insert(matched_results, results[i])
			end
			title = t(locale, "results_empty_title", { count = tostring(#matched_results) })
		else
			-- Fuzzy match & score all files
			type ScoredItem = { item: FileItem, score: number }
			local scored_items: { ScoredItem } = {}
			
			for _, res in ipairs(results) do
				local score = fuzzy_match(res.relativePath, query)
				if score then
					table.insert(scored_items, {
						item = res,
						score = score,
					})
				end
			end

			-- Sort by score descending
			table.sort(scored_items, function(a, b)
				return a.score > b.score
			end)

			-- Take the top 300 matched files
			local limit = math.min(#scored_items, 300)
			for i = 1, limit do
				table.insert(matched_results, scored_items[i].item)
			end
			title = t(locale, "results_title", { query = query, count = tostring(#matched_results) })
		end

		-- If zero matches found for the query
		if #matched_results == 0 then
			vault.ui.show_quick_pick({
				title = title,
				items = {
					{
						id = "no_matches",
						label = "No matches found",
						detail = "Try a different search term.",
					},
				},
			})
			return
		end

		-- 5. Prepare QuickPick options
		local items: { QuickPickItem } = {}
		for i, res in ipairs(matched_results) do
			table.insert(items, {
				id = tostring(i),
				label = get_basename(res.path),
				detail = "[" .. res.projectName .. "] " .. res.relativePath,
				icon = get_icon(res.path),
			})
		end

		local selected = vault.ui.show_quick_pick({
			title = title,
			items = items,
		})

		if selected then
			local idx = tonumber(selected)
			if idx and matched_results[idx] then
				local res = matched_results[idx]
				vault.ui.open_project_file(res.projectId, res.path, 1)
			end
		end
	end
end

return plugin
