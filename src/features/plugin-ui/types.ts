import { z } from "zod";
import { isPlainObject, isRecord } from "~/lib/guards";

// ─── Shared plugin native-UI view-spec types ────────────────────────────────
// Mirrors src-tauri/src/lua/ui/{types,dialogs,pages}.rs. Zod schemas are the
// runtime validators; TS types below are inferred from them (single source).

export const ViewKindSchema = z.enum([
  "list",
  "table",
  "form",
  "stack",
  "stats",
  "tabs",
  "markdown",
  "scroll",
]);
export type ViewKind = z.infer<typeof ViewKindSchema>;

export const TableColumnSchema = z.object({
  id: z.string().min(1),
  header: z.string(),
  accessor: z.string().optional(),
  kind: z.enum(["text", "badge", "icon", "link", "progress", "code", "date", "actions"]).optional(),
  sortable: z.boolean().optional(),
  width: z.number().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});
export type PluginTableColumn = z.infer<typeof TableColumnSchema>;

export const TableRowSchema = z.object({
  id: z.string().min(1),
  cells: z.record(z.string(), z.unknown()),
});
export type PluginTableRow = z.infer<typeof TableRowSchema>;

export const TableLayoutSchema = z.enum(["page", "fill"]);
export type PluginTableLayout = z.infer<typeof TableLayoutSchema>;

export const TableViewSchema = z.object({
  kind: z.literal("table"),
  id: z.string().optional(),
  columns: z.array(TableColumnSchema).min(1).max(20),
  rows: z.array(TableRowSchema).max(5000),
  searchable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  pageSize: z.number().min(1).max(500).optional(),
  rowCommand: z.string().optional(),
  layout: TableLayoutSchema.optional(),
  maxHeight: z.number().min(64).max(2000).optional(),
});
export type PluginTableView = z.infer<typeof TableViewSchema>;

export const StatsToneSchema = z.enum([
  "default",
  "success",
  "warning",
  "error",
  "primary",
  "muted",
  "info",
]);
export type PluginStatsTone = z.infer<typeof StatsToneSchema>;

export const StatsItemSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  icon: z.string().optional(),
  tone: StatsToneSchema.optional(),
});
export type PluginStatsItem = z.infer<typeof StatsItemSchema>;

export const StatsViewSchema = z.object({
  kind: z.literal("stats"),
  items: z.array(StatsItemSchema).max(32),
});
export type PluginStatsView = z.infer<typeof StatsViewSchema>;

export const MarkdownViewSchema = z.object({
  kind: z.literal("markdown"),
  content: z.string().optional(),
});
export type PluginMarkdownView = z.infer<typeof MarkdownViewSchema>;

export const ListItemSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  detail: z.string().optional(),
  icon: z.string().optional(),
});
export type PluginListItem = z.infer<typeof ListItemSchema>;

export const ListViewSchema = z.object({
  kind: z.literal("list"),
  items: z.array(ListItemSchema).max(5000),
  itemCommand: z.string().optional(),
  rowCommand: z.string().optional(),
});
export type PluginListView = z.infer<typeof ListViewSchema>;

export const ScrollViewSchema = z.object({
  kind: z.literal("scroll"),
  id: z.string().optional(),
  children: z.array(z.record(z.string(), z.unknown())).max(32),
  maxHeight: z.number().min(64).max(2000).optional(),
});
export type PluginScrollView = z.infer<typeof ScrollViewSchema>;

export type AnyViewSpec =
  | PluginTableView
  | PluginStatsView
  | PluginMarkdownView
  | PluginListView
  | PluginScrollView
  | { kind: "stack"; children: AnyViewSpec[] }
  | { kind: "tabs"; tabs: { id: string; label: string; view: AnyViewSpec }[] }
  | { kind: "form"; [k: string]: unknown }
  | { kind: string; [k: string]: unknown };

const StackViewSchema: z.ZodType<{ kind: "stack"; children: unknown[] }> = z.object({
  kind: z.literal("stack"),
  children: z.array(z.record(z.string(), z.unknown())).max(32),
});

export const AnyViewSpecSchema = z.object({ kind: z.string().min(1) }).passthrough();

/** Validate a view spec kind + limits; returns the raw value or throws. */
export function parseViewSpec(raw: unknown): Record<string, unknown> & { kind: string } {
  const base = AnyViewSpecSchema.parse(raw) as Record<string, unknown> & { kind: string };
  const kind = ViewKindSchema.parse(base.kind);
  if (kind === "table") {
    TableViewSchema.parse(raw);
  } else if (kind === "stack") {
    StackViewSchema.parse(raw);
  } else if (kind === "scroll") {
    ScrollViewSchema.parse(raw);
  } else if (kind === "stats") {
    StatsViewSchema.parse(raw);
  } else if (kind === "list") {
    ListViewSchema.parse(raw);
  } else if (kind === "markdown") {
    MarkdownViewSchema.parse(raw);
  }
  return base;
}

export type PluginPageViewState = {
  title?: string;
  view?: Record<string, unknown> & { kind: string };
};

/**
 * Merge an `update_view` patch into stored page state. Patch keys override;
 * a `view` object is shallow-merged into the stored view, other top-level
 * keys (rows, columns, children, items, content, title, commands) merge into
 * the stored view when no explicit `view` key is present.
 */
export function applyViewPatch(
  current: PluginPageViewState,
  patch: Record<string, unknown>,
): PluginPageViewState {
  const next: PluginPageViewState = { ...current };
  if (typeof patch.title === "string") next.title = patch.title;
  const storedView = current.view;
  const patchView = patch.view;
  if (patchView !== undefined) {
    if (isPlainObject(storedView) && isPlainObject(patchView)) {
      next.view = { ...storedView, ...patchView } as PluginPageViewState["view"];
    } else if (isPlainObject(patchView)) {
      next.view = patchView as PluginPageViewState["view"];
    }
    return next;
  }
  if (isPlainObject(storedView)) {
    const rest: Record<string, unknown> = { ...patch };
    delete rest.title;
    if (Object.keys(rest).length > 0) {
      next.view = { ...storedView, ...rest } as PluginPageViewState["view"];
    }
  }
  return next;
}

/** Find the row-click command for a view tree (rowCommand / itemCommand). */
export function findRowCommand(view: unknown): string | undefined {
  if (!isRecord(view)) return undefined;
  if (typeof view.rowCommand === "string" && view.rowCommand !== "") {
    return view.rowCommand;
  }
  if (typeof view.itemCommand === "string" && view.itemCommand !== "") {
    return view.itemCommand;
  }
  if (Array.isArray(view.children)) {
    for (const child of view.children) {
      const found = findRowCommand(child);
      if (found) return found;
    }
  }
  if (Array.isArray(view.tabs)) {
    for (const tab of view.tabs) {
      const found = findRowCommand(isRecord(tab) ? tab.view : undefined);
      if (found) return found;
    }
  }
  return undefined;
}

export const ConfirmOptionsSchema = z.object({
  title: z.string().min(1),
  message: z.string().optional(),
  okLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  danger: z.boolean().optional(),
});
export type PluginConfirmOptions = z.infer<typeof ConfirmOptionsSchema>;

export const ToastOptionsSchema = z.object({
  title: z.string().min(1),
  message: z.string().optional(),
  severity: z.enum(["info", "success", "warn", "error"]).optional(),
});
export type PluginToastOptions = z.infer<typeof ToastOptionsSchema>;

export const StoreChangedEventSchema = z.object({
  pluginId: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
  version: z.number(),
  removed: z.boolean().optional(),
});
export type PluginStoreChangedEvent = z.infer<typeof StoreChangedEventSchema>;

export function scopedStoreKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

export const PageActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  command: z.string().optional(),
});
export type PluginPageAction = z.infer<typeof PageActionSchema>;

/** Leniently parse per-page header actions; invalid entries are dropped. */
export function parsePageActions(raw: unknown): PluginPageAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginPageAction[] = [];
  for (const a of raw.slice(0, 8)) {
    const r = PageActionSchema.safeParse(a);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Parse + validate a table view spec; returns typed value or throws. */
export function parseTableView(raw: unknown): PluginTableView {
  return TableViewSchema.parse(raw);
}
