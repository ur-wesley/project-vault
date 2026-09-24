# Plugin Native UI via Lua

Build fully native UI from Luau: page views, data tables, dialogs, toasts,
plus a per-plugin reactive store and Solid-style signals. No HTML, no webviews —
Lua sends declarative specs, the host renders them with the app theme.

Related: [plugin system reference](./plugins.md) (all `vault.*` APIs),
[authoring guide](./creating-plugins.md) (packaging, lifecycle, publishing),
live example in `examples/plugin-table-demo/init.luau`.

---

## 1. Mental model

Three pieces work together:

| Piece                                                     | Role                                                  | Analogy              |
| --------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| **Views** (`vault.ui.set_view`)                           | What the user sees on a plugin page                   | JSX you send as data |
| **Dialogs** (`vault.ui.show_*`)                           | Blocking questions (table pick, confirm, form, input) | `await` in JS        |
| **Store + signals** (`vault.store`, `vault.createSignal`) | Reactive state; views update when it changes          | SolidJS store        |

Two update paths:

- **Imperative** — call `set_view` / `update_view` whenever you want (e.g. inside
  a `createEffect`, after a git scan, on row click).
- **Reactive** — put the push inside a `createEffect` that tracks signals, and
  keep shared data in `vault.store`. Every `store.set`/`remove` emits
  `plugin:store-changed`, so effects and subscribers stay in sync without
  polling.

Dialogs (`show_table`, `show_confirm`, `show_form`, …) **block the plugin
coroutine** until the user answers — write straight-line code, no callbacks.

---

## 2. Quick start

Minimal plugin with a table page (full file in `examples/plugin-table-demo/`):

```lua
--!strict
local vault = require("vault")

local plugin = {
	name = "My UI Demo",
	version = "1.0.0",
	commands = {
		{ id = "show", title = "Show repos", scope = "global" },
	},
	pages = {
		{ id = "repos", title = "Repos", icon = "mdi--table", command = "render" },
	},
}

local function rows()
	return {
		{ id = "p1", cells = { name = "vault", status = "dirty" } },
		{ id = "p2", cells = { name = "website", status = "clean" } },
	}
end

function plugin.execute(command_id: string, _ctx: any)
	if command_id == "render" or command_id == "show" then
		vault.ui.set_view({
			id = "repos",
			title = "Repos",
			view = {
				kind = "table",
				columns = {
					{ id = "name", header = "Repo", sortable = true },
					{ id = "status", header = "Status", kind = "badge" },
				},
				rows = rows(),
				searchable = true,
				rowCommand = "open_repo",
			},
		})
		vault.ui.open_page("repos")
	elseif command_id == "open_repo" then
		local rowId = _ctx and _ctx.itemId
		vault.log.info("clicked row: " .. tostring(rowId))
	end
end

return plugin
```

Declare the page in `pages` (sidebar + deep link), push content with `set_view`,
open it with `open_page`. Row clicks run `rowCommand` with
`{ pageId, itemId }` — same context shape as the legacy `itemCommand`.

---

## 3. Page views (`set_view` / `update_view`)

```lua
vault.ui.set_view({ id = "repos", title = "Repos", view = { kind = "table", ... } })
vault.ui.set_view({
	id = "overview",
	title = "Postgres",
	view = { kind = "stack", ... },
	-- optional header action buttons (max 8); click runs the command
	actions = {
		{ id = "new", label = "New", icon = "mdi--plus", command = "pg_create" },
	},
})
vault.ui.update_view({ id = "repos", patch = { title = "Repos (2 dirty)" } })
vault.ui.open_page("repos")   -- navigate to /plugins/<pluginId>/repos
vault.ui.clear_page("repos")  -- remove stored content
```

Row clicks: each `table` (and `list`) routes through **its own** `rowCommand`
when set (`execute(cmd, { pageId, itemId })`); tables without one fall back to
the page-level command (first `rowCommand` found in the view tree). Give every
clickable table its own `rowCommand`. Action buttons invoke
`execute(action.command or action.id, { pageId })` — the command must exist in
`plugin.execute` (it does not need palette metadata).

### 3.1 View kinds

`view.kind` is one of:

| `kind`       | Renders                                  | Key fields                                                                                         |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `"list"`     | Classic row list (== legacy `set_page`)  | `items: { {id, label, detail?, icon?} }`, `itemCommand` / `rowCommand`                             |
| `"table"`    | Sortable / filterable / paginated table  | `columns`, `rows`, `searchable?`, `sortable?`, `pageSize?`, `rowCommand?`, `layout?`, `maxHeight?` |
| `"form"`     | Inline form (same fields as `show_form`) | `fields`, `submitCommand?`                                                                         |
| `"markdown"` | Rendered markdown block                  | `content`                                                                                          |
| `"stats"`    | Stat cards row                           | `items: { {id, label, value, icon?, tone?} }`                                                      |
| `"stack"`    | Vertical composition of the above        | `children: { ViewSpec }` (max 32)                                                                  |
| `"tabs"`     | Tabbed views                             | `tabs: { {id, label, view} }`                                                                      |
| `"scroll"`   | Scrollable container for any children    | `children: { ViewSpec }` (max 32), `maxHeight?` (px, 64–2000)                                      |

Table layout: default `"page"` keeps whole-page scroll (back-compat). Opt into
`layout = "fill"` to make the table use the available page height instead —
search stays fixed on top, rows scroll inline, pagination pins to the bottom.
`maxHeight` caps the inline scroll region (px) when the table sits inside a
`stack`/`tabs`/`scroll` without fill. Pagination (`pageSize`) is orthogonal and
combines with both modes.

`set_page({ id, title?, itemCommand?, items })` still works and is normalized to
`{ kind = "list" }` internally — old plugins need no changes.

### 3.2 Tables in pages

```lua
vault.ui.set_view({
	id = "repos",
	title = "3 repos need attention",
	view = {
		kind = "table",
		columns = {
			{ id = "name", header = "Repo", sortable = true },
			{ id = "status", header = "Status", kind = "badge" },
			{ id = "branch", header = "Branch", align = "left" },
		},
		rows = {
			{ id = "proj-1", cells = { name = "vault", status = "dirty", branch = "main" } },
			{ id = "proj-2", cells = { name = "site", status = "clean", branch = "dev" } },
		},
		searchable = true,   -- search box above the table
		sortable = true,      -- click headers to sort (per-column `sortable` wins)
		pageSize = 20,        -- pagination page size (default 20)
		rowCommand = "open_repo", -- clicked row -> execute("open_repo", { pageId, itemId })
	},
})
```

Column fields:

| Field      | Required | Meaning                                                                                        |
| ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| `id`       | yes      | Unique within the table; cells map by `accessor` or `id`                                       |
| `header`   | yes      | Column header label                                                                            |
| `accessor` | no       | Cell key (defaults to `id`)                                                                    |
| `kind`     | no       | `text` (default) \| `badge` \| `icon` \| `link` \| `progress` \| `code` \| `date` \| `actions` |
| `sortable` | no       | Per-column sort toggle (default true when table `sortable`)                                    |
| `width`    | no       | Suggested width in px                                                                          |
| `align`    | no       | `left` \| `center` \| `right`                                                                  |

Cells are a free map: `cells = { name = "vault", count = 3, ok = true }`.
Numbers sort numerically, everything else sorts as strings. Missing cells render
empty — no need to fill every column.

### 3.2b Per-row action buttons (`kind = "actions"`)

A column with `kind = "actions"` renders its cell as inline buttons instead of
text. The cell value is an array of up to 4 button specs:

```lua
columns = {
	{ id = "name", header = "Server", sortable = true },
	{ id = "ops", header = "", kind = "actions", sortable = false },
},
rows = {
	{
		id = "cluster:dev",
		cells = {
			name = "dev",
			ops = {
				{ id = "start", label = "Start", icon = "mdi--play", command = "pg_row_start" },
			},
		},
	},
},
```

Button fields: `id` + `label` (required), `icon` (Iconify class, optional),
`command` (optional, defaults to `id`). Clicking a button invokes
`execute(button.command or button.id, { pageId, itemId = <row id> })` — the
same context shape as a row click, so row-scoped commands read the row from
`context.itemId`. Button clicks never trigger the table's `rowCommand`.
The command must exist in `plugin.execute` (palette metadata optional).
Invalid button specs are dropped silently. For search, the cell counts as its
joined button labels ("Start Stop"); set `sortable = false` on the column.

Limits: max **20 columns**, max **5000 rows**. For bigger datasets, aggregate or
paginate in Lua first (server-driven callbacks are a planned extension).

Table `layout` / `maxHeight` and the `scroll` container:

```lua
-- Full-height table page: search fixed, rows scroll inline, pagination pinned
vault.ui.set_view({
	id = "repos",
	title = "Repos",
	view = {
		kind = "table",
		columns = { ... }, rows = { ... },
		searchable = true, pageSize = 50,
		layout = "fill",
	},
})

-- Stats stay fixed, table takes the remaining page height
vault.ui.set_view({
	id = "overview",
	title = "Git Hygiene",
	view = {
		kind = "stack",
		children = {
			{ kind = "stats", items = { ... } },
			{ kind = "table", columns = { ... }, rows = { ... }, layout = "fill" },
		},
	},
})

-- Generic scrollable container (any children, optional cap)
vault.ui.set_view({
	id = "log",
	title = "Log",
	view = {
		kind = "scroll",
		maxHeight = 480,
		children = {
			{ kind = "markdown", content = "# Long notes\n..." },
			{ kind = "table", columns = { ... }, rows = { ... }, maxHeight = 320 },
		},
	},
})
```

### 3.3 Composed pages (`stack`)

```lua
vault.ui.set_view({
	id = "overview",
	title = "Git Hygiene",
	view = {
		kind = "stack",
		children = {
			{ kind = "stats", items = {
				{ id = "dirty", label = "Dirty", value = "3", tone = "warning" },
				{ id = "clean", label = "Clean", value = "12" },
			} },
			{ kind = "markdown", content = "## Needs attention\nReviewed just now." },
			{ kind = "table", columns = { ... }, rows = { ... }, searchable = true },
		},
	},
})
```

### 3.4 Partial updates

Resend only what changed — avoids flicker on rapid refreshes (e.g. inside an
effect or a file watcher hook):

```lua
vault.ui.update_view({ id = "repos", patch = { title = "Repos (1 dirty)" } })
```

---

## 4. Dialogs (blocking)

All `show_*` calls suspend the plugin coroutine and resume with the answer.
`nil` means the user cancelled (Esc / backdrop / Cancel button) — always handle it.

### 4.1 Table picker (`show_table`)

```lua
local picked: string? = vault.ui.show_table({
	title = "Pick a repo",
	columns = {
		{ id = "name", header = "Repo", sortable = true },
		{ id = "status", header = "Status", kind = "badge" },
	},
	rows = {
		{ id = "p1", cells = { name = "vault", status = "dirty" } },
	},
	searchable = true,
	paginationPageSize = 10,
})
if picked == nil then return end -- cancelled
vault.log.info("picked: " .. picked)
```

Returns the clicked **row `id`**. Clicking a row submits immediately; Cancel/Esc
returns `nil`. Same column shape and limits as page tables.

### 4.2 Confirm (`show_confirm`)

```lua
local ok: boolean = vault.ui.show_confirm({
	title = "Delete demo data?",
	message = "This cannot be undone.",
	okLabel = "Delete",       -- default "Confirm"
	cancelLabel = "Keep",     -- default "Cancel"
	danger = true,            -- red confirm button
})
if ok then
	vault.store.remove("repos/rows")
end
```

### 4.3 Toast (`show_toast`, fire-and-forget)

```lua
vault.ui.show_toast({ title = "Scan complete", message = "3 dirty repos", severity = "success" })
-- severity: "info" | "success" | "warn" | "error" (default "info")
```

Does not block. For persistent entries with actions use
`vault.notification.show` instead (Notification Center).

### 4.4 Input, quick pick, form (existing)

```lua
-- Single text input -> string? (nil on cancel)
local name = vault.ui.show_input_box({ title = "Repo name", placeholder = "my-app" })

-- Searchable list -> selected item id? (nil on cancel)
local id = vault.ui.show_quick_pick({
	title = "Pick a project",
	fuzzy = true,    -- fuzzy matching (default: substring)
	preview = true,  -- file preview pane for items with filePath
	items = {
		{ id = "p1", label = "vault", detail = "C:/Arbeit/project-vault", icon = "mdi--folder" },
	},
})

-- Multi-field form -> { field_id = value }? (nil on cancel)
local res = vault.ui.show_form({
	title = "New project",
	fields = {
		{ id = "name", label = "Name", fieldType = "text", required = true },
		{ id = "kind", label = "Kind", fieldType = "select",
		  options = { { id = "app", label = "App" }, { id = "lib", label = "Library" } } },
		{ id = "private", label = "Private", fieldType = "boolean", defaultValue = true },
		{ id = "notes", label = "Notes", fieldType = "textarea", placeholder = "Optional…" },
		{ id = "port", label = "Port", fieldType = "number", min = 1, max = 65535 },
	},
})
```

Field types: `text` | `number` | `boolean` | `select` | `textarea`.
Validation: `required`, `pattern` (+ `validationMessage`), `min`/`max`/`step`
for numbers. Invalid submits stay open with inline errors.

---

## 5. Per-plugin store (`vault.store`)

Isolated key-value state per plugin. Keys are namespaced
`plugin:<your-id>:store:<key>` by the engine — other plugins cannot read yours
(share via `vault.plugin.require` exports instead).

```lua
-- Define once (idempotent; first call wins on value + persist flag)
vault.store.define({ key = "repos/filter", initial = "all" })            -- memory-only
vault.store.define({ key = "repos/pinned", initial = {}, persist = true }) -- survives restart

vault.store.set("repos/filter", "dirty")  -- -> { value = "dirty", version = 2 }
local filter = vault.store.get("repos/filter") -- "dirty" (nil when missing)
vault.store.list()                        -- { "repos/filter", "repos/pinned" }
vault.store.set_persist("repos/filter", true) -- opt a key into persistence later
vault.store.remove("repos/filter")        -- -> true; emits removal event
vault.store.clear()                       -- remove all keys of this plugin
```

### 5.1 Persistence

- **Default: memory-only.** Fresh on every app start — like a Solid store.
  Best for caches, filters, table rows, drafts.
- **Opt-in:** `persist = true` (in `define` or via `set_persist`) writes through
  to SQLite, debounced. Loaded automatically on first `get` after restart.
  Best for pins, onboarding flags, user preferences.
- Rule of thumb: persist **user intent**, not **derived data** (re-scan instead).

### 5.2 Reactivity

Every `set`/`remove` bumps a per-key `version` and emits
`plugin:store-changed { pluginId, key, value, version }`. The frontend keeps a
Solid-signal mirror, so bound views re-render without manual `set_view`.

### 5.3 Limits (enforced, return errors instead of hanging)

| Limit                | Value                               |
| -------------------- | ----------------------------------- |
| Keys per plugin      | 500                                 |
| Value size           | 256 KB JSON                         |
| Key length           | 256 chars; must not start with `__` |
| Table rows / columns | 5000 / 20                           |
| Stack children       | 32                                  |

---

## 6. Signals (Solid-style reactivity in Lua)

For derived state and auto-refresh, mirroring SolidJS:

```lua
-- Getter + setter. Signals are scoped to YOUR plugin automatically.
local count, setCount = vault.createSignal(0)
print(count()) -- 0
setCount(3)
setCount(count() + 1)

-- Memo: recomputed when dependencies change
local doubled = vault.createMemo(function()
	return count() * 2
end)

-- Effect: re-runs when tracked signals change (typical body pushes UI)
vault.createEffect(function()
	vault.ui.update_view({ id = "repos", patch = { title = "Count: " .. count() } })
end)

-- Batch: one flush for many updates (one effect run, no flicker)
vault.batch(function()
	setCount(10)
	setCount(20)
end)
```

### 6.1 Store + signals pattern (recommended)

Keep raw data in the store (shared, persisted, bound to views), derive with
signals/memos, push with effects:

```lua
function plugin.execute(command_id: string, _ctx: any)
	if command_id == "init" then
		vault.store.define({ key = "repos/rows", initial = {} })
		local filter, setFilter = vault.createSignal("all")
		vault.createEffect(function()
			local rows: any = vault.store.get("repos/rows") or {}
			local f: string = filter()
			-- ... filter rows by f ...
			vault.ui.update_view({ id = "repos", patch = { rows = rows } })
		end)
	end
end
```

### 6.2 Rules

- **No blocking awaits inside hot effects.** Effects run on the Lua worker
  thread; calling `show_*` dialogs or slow `vault.git` scans in an effect that
  fires often will stall all plugins. Debounce rapid sets with `vault.batch`.
- **Effects are disposed with your plugin** (disable/uninstall/reload). There is
  no manual cleanup in the common case.
- For simple cases skip effects entirely: push `set_view` once after your data
  is ready.

---

## 7. Chrome: footer, header, markdown, navigation

```lua
-- Status-bar segment (persistent; call again with same id to update)
vault.ui.set_footer({
	id = "dirty-count", text = "3 dirty", icon = "mdi--alert-circle",
	tooltip = "Repos needing attention", command = "show", -- click runs command
	color = "warning", -- default|success|warning|error|primary|muted
	position = "left", -- left|right
})
vault.ui.clear_footer("dirty-count")

-- Project header widget (visible while a project is focused)
vault.ui.set_header_widget({
	id = "git-state", type = "badge", -- button|badge|text
	text = "dirty", icon = "mdi--git", command = "show", color = "warning",
})
vault.ui.clear_header_widget("git-state")

-- Markdown reader dialog (fire-and-forget; close fires `markdown_dialog_closed`)
vault.ui.show_markdown_dialog("Changelog", "# 1.2.0\n- fast tables")

-- Theming (advanced): raw CSS injection, e.g. accent tweaks for your views
vault.ui.open_project_file(projectId, "/abs/path/to/file.lua", 42) -- jump to file:line
```

Refresh widgets on git changes: handle the `git_status_changed` hook
(`context.projectId`) and re-read `vault.git.status` — see
[plugins.md](./plugins.md#23-features--development-tools).

---

## 8. Events reference (for custom frontend work)

| Tauri event            | Emitted by               | Payload                                              |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `plugin:show-table`    | `show_table`             | `(id, options)` → resolve via `resolve_plugin_ui`    |
| `plugin:show-confirm`  | `show_confirm`           | `(id, options)` → resolve `true`/`false`             |
| `plugin:show-toast`    | `show_toast`             | `{ pluginId, title, message?, severity }`            |
| `plugin:set-view`      | `set_view`/`update_view` | `{ pluginId, id, title?, view? / patch?, partial? }` |
| `plugin:set-page`      | legacy `set_page`        | `{ pluginId, id, title?, itemCommand?, items }`      |
| `plugin:store-changed` | `store.set`/`remove`     | `{ pluginId, key, value, version, removed? }`        |

---

## 9. Troubleshooting

| Symptom                                 | Cause                                                  | Fix                                                                                                           |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `show_table` errors immediately         | 0 columns, duplicate column `id`, >20 cols, >5000 rows | Check shapes; aggregate in Lua first                                                                          |
| Dialog never resolves / plugin hangs    | Frontend bridge not mounted or event name mismatch     | `PluginUiExtensions` must be mounted in `App.tsx`; check console                                              |
| `store.get` returns `nil` after restart | Key was memory-only                                    | `define({ persist = true })` or `set_persist(key, true)`                                                      |
| Effect runs in a loop                   | Effect writes a signal it reads                        | Read in the effect, write outside — or guard with a version check                                             |
| Row click does nothing                  | `rowCommand` missing or misspelled                     | Set `rowCommand` and implement it in `plugin.execute`; section rows (`section_*`) are not clickable by design |
| `store key must not start with __`      | Reserved prefix                                        | Rename the key                                                                                                |
| Stale table after git change            | No refresh hook                                        | Handle `git_status_changed`, re-scan, `update_view`                                                           |
