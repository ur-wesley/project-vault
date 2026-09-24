import { For, Match, Show, Switch, createMemo, createSignal, type Component } from "solid-js";
import { isPlainObject, isRecord } from "~/lib/guards";
import type { PluginTableView as TableSpec } from "../types";
import type { PluginListItem, PluginStatsItem } from "../types";
import { usePluginViewT } from "./pluginViewI18n";
import { PluginTableView } from "./PluginTableView";
import { PluginStatsView } from "./PluginStatsView";
import { PluginMarkdownView } from "./PluginMarkdownView";
import { PluginListView } from "./PluginListView";

export type AnyViewSpec = Record<string, unknown> & { kind: string };

export type PluginTabSpec = { id: string; label: string; view: AnyViewSpec };

const asTableSpec = (spec: AnyViewSpec): TableSpec => spec as unknown as TableSpec;

const asItems = (value: unknown): PluginListItem[] =>
  Array.isArray(value) ? (value as PluginListItem[]) : [];

const asStatsItems = (value: unknown): PluginStatsItem[] =>
  Array.isArray(value) ? (value as PluginStatsItem[]) : [];

const asChildren = (value: unknown): AnyViewSpec[] =>
  Array.isArray(value) ? (value as AnyViewSpec[]) : [];

const isTabSpec = (t: unknown): t is PluginTabSpec => {
  if (!isRecord(t)) return false;
  return typeof t.id === "string" && isRecord(t.view);
};

const asTabs = (value: unknown): PluginTabSpec[] => {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(isTabSpec);
};

const asMaxHeight = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 64), 2000);
};

export type RowClickHandler = (rowId: string, cmd?: string) => void;

/** True when a view tree contains a `table` with `layout: "fill"`. */
export const viewContainsFillTable = (spec: unknown): boolean => {
  if (!isPlainObject(spec)) return false;
  if (spec.kind === "table" && spec.layout === "fill") return true;
  if (Array.isArray(spec.children)) {
    return spec.children.some((c) => viewContainsFillTable(c));
  }
  if (Array.isArray(spec.tabs)) {
    return spec.tabs.some((t) => viewContainsFillTable(isRecord(t) ? t.view : undefined));
  }
  return false;
};

const PluginTabsView: Component<{
  tabs: PluginTabSpec[];
  onRowClick?: RowClickHandler;
}> = (props) => {
  const t = usePluginViewT();
  // Track by tab id so refreshes (new spec objects) keep the active tab.
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const tabs = createMemo(() => props.tabs);
  const active = createMemo(() => {
    const list = tabs();
    return list.find((t) => t.id === activeId()) ?? list[0];
  });
  return (
    <div data-view-root="tabs" class="flex h-full min-h-0 flex-1 flex-col gap-2 p-2">
      <div class="flex shrink-0 flex-wrap gap-1" role="tablist">
        <For each={tabs()}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={active()?.id === tab.id}
              onClick={() => setActiveId(tab.id)}
              class="rounded-md border px-2.5 py-1 text-xs transition-colors"
              classList={{
                "border-primary/60 bg-accent font-medium": active()?.id === tab.id,
                "border-border/60 text-muted-foreground hover:bg-accent/40":
                  active()?.id !== tab.id,
              }}
            >
              {tab.label || tab.id}
            </button>
          )}
        </For>
      </div>
      <div
        class="min-h-0 flex-1"
        classList={{
          "overflow-y-auto": !viewContainsFillTable(active()?.view),
          "overflow-hidden flex flex-col": viewContainsFillTable(active()?.view),
        }}
        role="tabpanel"
      >
        <Show
          when={active()?.view}
          fallback={
            <p class="px-2 py-8 text-center text-sm text-muted-foreground">
              {t("pluginView.noResults") as string}
            </p>
          }
        >
          {(view) => <PluginViewRenderer spec={view()} onRowClick={props.onRowClick} />}
        </Show>
      </div>
    </div>
  );
};

export const PluginViewRenderer: Component<{
  spec: AnyViewSpec;
  onRowClick?: RowClickHandler;
}> = (props) => {
  const t = usePluginViewT();
  return (
    <Switch
      fallback={
        <p class="p-4 text-xs text-muted-foreground">{t("pluginView.unsupportedView") as string}</p>
      }
    >
      <Match when={props.spec.kind === "table"}>
        <PluginTableView spec={asTableSpec(props.spec)} onRowClick={props.onRowClick} />
      </Match>
      <Match when={props.spec.kind === "stats"}>
        <div data-view-root="stats" class="shrink-0 p-2">
          <PluginStatsView items={asStatsItems(props.spec.items)} />
        </div>
      </Match>
      <Match when={props.spec.kind === "markdown"}>
        <div data-view-root="markdown" class="shrink-0 p-2">
          <PluginMarkdownView content={String(props.spec.content ?? "")} />
        </div>
      </Match>
      <Match when={props.spec.kind === "list"}>
        <div data-view-root="list" class="min-h-0 shrink-0">
          <PluginListView items={asItems(props.spec.items)} onRowClick={props.onRowClick} />
        </div>
      </Match>
      <Match when={props.spec.kind === "stack"}>
        <div data-view-root="stack" class="flex h-full min-h-0 flex-1 flex-col gap-2 p-2">
          <For each={asChildren(props.spec.children)}>
            {(child) => <PluginViewRenderer spec={child} onRowClick={props.onRowClick} />}
          </For>
          <Show when={asChildren(props.spec.children).length === 0}>
            <p class="px-2 py-8 text-center text-sm text-muted-foreground">
              {t("pluginView.noResults") as string}
            </p>
          </Show>
        </div>
      </Match>
      <Match when={props.spec.kind === "tabs"}>
        <PluginTabsView tabs={asTabs(props.spec.tabs)} onRowClick={props.onRowClick} />
      </Match>
      <Match when={props.spec.kind === "scroll"}>
        <div
          data-view-root="scroll"
          class="min-h-0 overflow-y-auto rounded-md"
          style={
            asMaxHeight((props.spec as Record<string, unknown>).maxHeight) != null
              ? {
                  "max-height": `${asMaxHeight((props.spec as Record<string, unknown>).maxHeight)}px`,
                }
              : {}
          }
        >
          <div class="flex min-h-0 flex-col gap-2 p-2">
            <For each={asChildren(props.spec.children)}>
              {(child) => <PluginViewRenderer spec={child} onRowClick={props.onRowClick} />}
            </For>
            <Show when={asChildren(props.spec.children).length === 0}>
              <p class="px-2 py-8 text-center text-sm text-muted-foreground">
                {t("pluginView.noResults") as string}
              </p>
            </Show>
          </div>
        </div>
      </Match>
      <Match when={props.spec.kind === "form"}>
        <p class="p-4 text-xs text-muted-foreground">
          {t("pluginView.formNotSupported") as string}
        </p>
      </Match>
    </Switch>
  );
};
