import { createSignal } from "solid-js";

export type PluginPageItem = {
  id: string;
  label: string;
  detail?: string;
  icon?: string;
};

export type PluginPageContent = {
  key: string;
  pluginId: string;
  id: string;
  title?: string;
  itemCommand?: string;
  items: PluginPageItem[];
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
    const next = { ...page, key };
    if (existing === -1) return [...prev, next];
    const copy = [...prev];
    copy[existing] = next;
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
