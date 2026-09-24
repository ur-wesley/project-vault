import { createSignal } from "solid-js";
import { isPlainObject } from "~/lib/guards";

export type PluginPageItem = {
  id: string;
  label: string;
  detail?: string;
  icon?: string;
};

export type PluginPageViewSpec = Record<string, unknown> & { kind: string };

export type PluginPageActionItem = {
  id: string;
  label: string;
  icon?: string;
  command?: string;
};

export type PluginPageContent = {
  key: string;
  pluginId: string;
  id: string;
  title?: string;
  itemCommand?: string;
  items: PluginPageItem[];
  /** Native view spec pushed via `vault.ui.set_view` (table/stack/stats/...). */
  view?: PluginPageViewSpec;
  kind?: string;
  /** Header action buttons pushed via `set_view` `actions` (cleared by legacy `set_page`). */
  actions?: PluginPageActionItem[];
};

const [pluginPages, setPluginPages] = createSignal<PluginPageContent[]>([]);

export { pluginPages };

export function getPluginPage(pluginId: string, pageId: string): PluginPageContent | undefined {
  const key = `${pluginId}:${pageId}`;
  return pluginPages().find((p) => p.key === key);
}

export function upsertPluginPage(page: Omit<PluginPageContent, "key">) {
  const key = `${page.pluginId}:${page.id}`;
  setPluginPages((prev) => {
    const existing = prev.findIndex((p) => p.key === key);
    // Legacy list pages carry no actions: clear any stale buttons.
    const next = { ...page, actions: undefined, key };
    if (existing === -1) return [...prev, next];
    const copy = [...prev];
    copy[existing] = next;
    return copy;
  });
}

export function upsertPluginViewPage(page: {
  pluginId: string;
  id: string;
  title?: string;
  kind?: string;
  view?: PluginPageViewSpec;
  itemCommand?: string;
  actions?: PluginPageActionItem[];
}) {
  const key = `${page.pluginId}:${page.id}`;
  setPluginPages((prev) => {
    const existing = prev.findIndex((p) => p.key === key);
    if (existing === -1) {
      return [...prev, { ...page, items: [], key }];
    }
    const copy = [...prev];
    copy[existing] = {
      ...copy[existing],
      title: page.title ?? copy[existing].title,
      kind: page.kind ?? copy[existing].kind,
      view: page.view ?? copy[existing].view,
      itemCommand: page.itemCommand ?? copy[existing].itemCommand,
      actions: page.actions ?? copy[existing].actions,
    };
    return copy;
  });
}

export function applyPluginViewPatch(
  pluginId: string,
  id: string,
  patch: { title?: string; view?: PluginPageViewSpec; [k: string]: unknown },
) {
  const key = `${pluginId}:${id}`;
  setPluginPages((prev) => {
    const existing = prev.findIndex((p) => p.key === key);
    if (existing === -1) {
      const { title, view, ...rest } = patch;
      const viewState: PluginPageViewSpec | undefined =
        view ??
        (Object.keys(rest).length > 0
          ? ({ kind: "stack", ...rest } as PluginPageViewSpec)
          : undefined);
      return [...prev, { pluginId, id, title, view: viewState, items: [], key }];
    }
    const copy = [...prev];
    const current = copy[existing];
    const storedView = current.view;
    let nextView = storedView;
    if (patch.view !== undefined) {
      if (storedView !== undefined && isPlainObject(patch.view)) {
        nextView = { ...storedView, ...patch.view };
      } else {
        nextView = patch.view;
      }
    } else {
      const { title: _title, view: _view, ...rest } = patch;
      if (storedView !== undefined && Object.keys(rest).length > 0) {
        nextView = { ...storedView, ...rest };
      }
    }
    copy[existing] = {
      ...current,
      title: patch.title ?? current.title,
      view: nextView,
      kind: typeof nextView?.kind === "string" ? nextView.kind : current.kind,
    };
    return copy;
  });
}

export function removePluginPage(pluginId: string, id: string) {
  const key = `${pluginId}:${id}`;
  setPluginPages((prev) => prev.filter((p) => p.key !== key));
}

export function clearPluginPages(pluginId: string) {
  setPluginPages((prev) => prev.filter((p) => p.pluginId !== pluginId));
}
