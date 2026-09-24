--!strict
-- Table demo plugin: store + signals + native table dialog + versioned view.
-- Copy this folder to <app_data>/plugins/table-demo/ to try it live.
local vault = require("vault")

local plugin = {
	name = "Table Demo",
	description = "Demonstrates store, signals, and native tables.",
	version = "1.0.0",
	commands = {
		{ id = "show_repos", title = "Show repos table", scope = "global" },
		{ id = "ask_delete", title = "Ask delete confirm", scope = "global" },
	},
	pages = {
		{ id = "repos", title = "Demo Repos", icon = "mdi--table", defaultPinned = false, command = "render_page" },
	},
}

local function seed()
	vault.store.define({ key = "repos/pinned", initial = {}, persist = true })
	vault.store.define({ key = "repos/filter", initial = "all" })
	vault.store.set("repos/rows", {
		{ id = "p1", cells = { name = "vault", status = "dirty" } },
		{ id = "p2", cells = { name = "app", status = "clean" } },
	})
end

local function renderPage()
	local rows: any = vault.store.get("repos/rows") or {}
	vault.ui.set_view({
		id = "repos",
		title = "Demo repos",
		view = {
			kind = "table",
			id = "repos",
			columns = {
				{ id = "name", header = "Repo", sortable = true },
				{ id = "status", header = "Status", kind = "badge" },
			},
			rows = rows,
			searchable = true,
			rowCommand = "open_repo",
			-- Opt in to full-height inline scroll (search fixed,
			-- rows scroll, pagination pinned). Omit for page scroll.
			layout = "fill",
		},
	})
	vault.ui.open_page("repos")
end

function plugin.execute(command_id: string, _context: any)
	if command_id == "init" then
		seed()
		-- Reactive: re-render the page whenever the filter key changes.
		local getFilter: any, _setFilter: any = vault.createSignal("all")
		vault.createEffect(function()
			local f = getFilter()
			vault.store.set("repos/filter", f)
		end)
	elseif command_id == "render_page" then
		renderPage()
	elseif command_id == "show_repos" then
		local rows: any = vault.store.get("repos/rows") or {}
		local picked = vault.ui.show_table({
			title = "Pick a repo",
			columns = { { id = "name", header = "Repo", sortable = true } },
			rows = rows,
			searchable = true,
		})
		if picked then
			vault.log.info("picked row: " .. tostring(picked))
		end
	elseif command_id == "ask_delete" then
		if vault.ui.show_confirm({ title = "Delete demo data?", danger = true }) then
			vault.store.remove("repos/rows")
			vault.ui.show_toast({ title = "Deleted", severity = "success" })
		end
	end
end

return plugin
