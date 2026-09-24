import type { PluginTableColumn, PluginTableRow } from "../types";

// ─── Pure table helpers (sorting / filtering / pagination) ──────────────────
// Used by PluginTableView and covered by vitest. TanStack handles the heavy
// lifting in the component; these helpers power tests, previews, and the
// Lua `bind:` fast path without a DOM.

export function getCellText(row: PluginTableRow, col: PluginTableColumn): string {
  const accessor = col.accessor ?? col.id;
  if (col.kind === "actions") {
    // Searchable/sortable surface for button cells: the joined labels.
    return getCellActions(row, col)
      .map((a) => a.label)
      .join(" ");
  }
  const v = row.cells[accessor];
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return JSON.stringify(v);
}

/** Per-row button rendered in a `kind: "actions"` column cell. */
export type PluginCellAction = {
  id: string;
  label: string;
  icon?: string;
  command?: string;
};

const MAX_CELL_ACTIONS = 4;

/** Leniently parse an actions-cell payload; invalid entries are dropped. */
export function getCellActions(row: PluginTableRow, col: PluginTableColumn): PluginCellAction[] {
  if (col.kind !== "actions") return [];
  const v = row.cells[col.accessor ?? col.id];
  if (!Array.isArray(v)) return [];
  const out: PluginCellAction[] = [];
  for (const a of v) {
    if (out.length >= MAX_CELL_ACTIONS) break;
    if (typeof a !== "object" || a === null) continue;
    const rec = a as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.length === 0) continue;
    if (typeof rec.label !== "string" || rec.label.length === 0) continue;
    out.push({
      id: rec.id,
      label: rec.label,
      ...(typeof rec.icon === "string" && rec.icon.length > 0 ? { icon: rec.icon } : {}),
      ...(typeof rec.command === "string" && rec.command.length > 0
        ? { command: rec.command }
        : {}),
    });
  }
  return out;
}

export function filterRows(
  rows: PluginTableRow[],
  columns: PluginTableColumn[],
  query: string,
): PluginTableRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => columns.some((c) => getCellText(r, c).toLowerCase().includes(q)));
}

export type SortDir = "asc" | "desc";

export function sortRows(
  rows: PluginTableRow[],
  columns: PluginTableColumn[],
  columnId: string,
  dir: SortDir,
): PluginTableRow[] {
  const col = columns.find((c) => c.id === columnId);
  if (!col || col.sortable === false) return rows;
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getCellText(a, col);
    const bv = getCellText(b, col);
    // Numeric-aware comparison, fallback to locale string compare.
    const an = Number(av);
    const bn = Number(bv);
    if (av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) {
      return (an - bn) * mul;
    }
    return av.localeCompare(bv) * mul;
  });
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { pageRows: T[]; pageCount: number; page: number } {
  const size = Math.max(1, Math.min(500, pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.max(0, Math.min(page, pageCount - 1));
  return {
    pageRows: rows.slice(p * size, p * size + size),
    pageCount,
    page: p,
  };
}
