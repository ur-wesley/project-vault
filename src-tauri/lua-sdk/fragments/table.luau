--!strict
-- Fragment: native tables + confirm/toast + versioned views.
-- Rust: src-tauri/src/lua/ui/types.rs + dialogs.rs + pages.rs
--
-- Example:
--   local row = vault.ui.show_table({
--     title = "Pick a repo",
--     columns = { { id = "name", header = "Repo", sortable = true } },
--     rows = { { id = "p1", cells = { name = "vault" } } },
--     searchable = true,
--   })
--   if vault.ui.show_confirm({ title = "Delete?", danger = true }) then ... end

export type TableColumnFragment = {
    id: string,
    header: string,
    accessor: string?,
    kind: ("text" | "badge" | "icon" | "link" | "progress" | "code" | "date" | "actions")?,
    sortable: boolean?,
    width: number?,
    align: ("left" | "center" | "right")?,
}

export type TableDialogOptionsFragment = {
    title: string,
    columns: { TableColumnFragment },
    rows: { { id: string, cells: { [string]: any } } },
    searchable: boolean?,
    paginationPageSize: number?,
}
