import { createMemo, For, Show, type Component } from "solid-js";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  createTable,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  type ColumnDef,
} from "@tanstack/solid-table";
import type { PluginTableColumn, PluginTableRow, PluginTableView as TableSpec } from "../types";
import { getCellActions, getCellText, type PluginCellAction } from "./tableHelpers";
import { usePluginViewT } from "./pluginViewI18n";

// Static feature set (v9 requires explicit registration; prerequisites before
// their row-model slots). Single built-in fns keep the bundle tree-shaken.
const tableComponentFeatures = tableFeatures({
  columnVisibilityFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

/** Per-row buttons for `kind: "actions"` columns. Clicks must not bubble to
 *  the row (which would fire the table's rowCommand instead of the button's). */
const RowActionButtons: Component<{
  row: PluginTableRow;
  col: PluginTableColumn;
  onAction: (command: string) => void;
}> = (props) => {
  const actions = createMemo(() => getCellActions(props.row, props.col));
  const fire = (a: PluginCellAction) => (e: MouseEvent) => {
    e.stopPropagation();
    props.onAction(a.command ?? a.id);
  };
  return (
    <span class="inline-flex items-center gap-1">
      <For each={actions()}>
        {(a) => (
          <button
            type="button"
            title={a.label}
            aria-label={a.label}
            class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border/60 px-1.5 text-[11px] hover:bg-accent/60"
            onClick={fire(a)}
          >
            <Show when={a.icon}>
              <span class={`iconify size-3.5 opacity-70 ${a.icon}`} />
            </Show>
            <span>{a.label}</span>
          </button>
        )}
      </For>
    </span>
  );
};

export const PluginTableView: Component<{
  spec: TableSpec;
  onRowClick?: (rowId: string, cmd?: string) => void;
}> = (props) => {
  const t = usePluginViewT();
  const columns = createMemo<ColumnDef<typeof tableComponentFeatures, PluginTableRow>[]>(() =>
    props.spec.columns.map((c) => {
      if (c.kind === "actions") {
        const col = c;
        return {
          id: col.id,
          header: col.header,
          accessorFn: (row: PluginTableRow) => getCellText(row, col),
          enableSorting: false,
          cell: (ctx: { row: { original: PluginTableRow } }) => (
            <RowActionButtons
              row={ctx.row.original}
              col={col}
              onAction={(cmd) => props.onRowClick?.(ctx.row.original.id, cmd)}
            />
          ),
        };
      }
      return {
        id: c.id,
        header: c.header,
        accessorFn: (row: PluginTableRow) => getCellText(row, c),
        enableSorting: c.sortable !== false && props.spec.sortable !== false,
      };
    }),
  );

  const table = createTable({
    features: tableComponentFeatures,
    get columns() {
      return columns();
    },
    get data() {
      return props.spec.rows;
    },
    initialState: {
      pagination: { pageIndex: 0, pageSize: props.spec.pageSize ?? 20 },
    },
  });

  const fill = createMemo(() => props.spec.layout === "fill");
  const cappedHeight = createMemo(() => {
    const h = props.spec.maxHeight;
    return typeof h === "number" && Number.isFinite(h) ? Math.min(Math.max(h, 64), 2000) : null;
  });

  return (
    <div
      data-view-root="table"
      class="flex min-h-0 flex-col gap-2"
      classList={{ "h-full min-h-0 flex-1": fill() }}
    >
      <Show when={props.spec.searchable !== false}>
        <input
          class="h-9 w-full shrink-0 rounded-md border border-border/60 bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
          placeholder={t("pluginView.searchPlaceholder") as string}
          value={(table.atoms.globalFilter.get() as string) ?? ""}
          onInput={(e) => table.setGlobalFilter(e.currentTarget.value)}
        />
      </Show>
      <div
        class="min-h-0 overflow-auto rounded-md border border-border/50"
        classList={{ "min-h-0 flex-1": fill() }}
        style={cappedHeight() != null && !fill() ? { "max-height": `${cappedHeight()}px` } : {}}
      >
        <table class="w-full text-left text-xs">
          <thead class="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <For each={table.getHeaderGroups()}>
              {(hg) => (
                <tr>
                  <For each={hg.headers}>
                    {(h) => (
                      <th
                        class="cursor-pointer select-none px-3 py-2 font-semibold"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={h} />
                        <Show when={h.column.getIsSorted() === "asc"}>
                          <span class="iconify mdi--arrow-up ml-1 inline-block size-3 align-middle" />
                        </Show>
                        <Show when={h.column.getIsSorted() === "desc"}>
                          <span class="iconify mdi--arrow-down ml-1 inline-block size-3 align-middle" />
                        </Show>
                      </th>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <For each={table.getRowModel().rows}>
              {(r) => (
                <tr
                  class="border-t border-border/40 hover:bg-accent/40"
                  onClick={() => props.onRowClick?.(r.original.id, props.spec.rowCommand)}
                >
                  <For each={r.getVisibleCells()}>
                    {(cell) => (
                      <td class="max-w-75 truncate px-3 py-2">
                        <table.FlexRender cell={cell} />
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={table.getRowModel().rows.length === 0}>
          <p class="px-3 py-8 text-center text-xs text-muted-foreground">
            {t("pluginView.noResults") as string}
          </p>
        </Show>
      </div>
      <div
        class="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground"
        classList={{ "sticky bottom-0 bg-background py-1": fill() }}
      >
        <button
          class="rounded border border-border/60 px-2 py-1"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          {t("pluginView.prev") as string}
        </button>
        <span>
          {
            t("pluginView.pageOf", {
              current: table.atoms.pagination.get().pageIndex + 1,
              total: table.getPageCount(),
            }) as string
          }
        </span>
        <button
          class="rounded border border-border/60 px-2 py-1"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          {t("pluginView.next") as string}
        </button>
      </div>
    </div>
  );
};
