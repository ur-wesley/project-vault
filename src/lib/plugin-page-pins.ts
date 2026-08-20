const STORAGE_KEY = "pv-plugin-page-pins";

export type PluginPagePinKey = `${string}:${string}`;

function pinKey(pluginId: string, pageId: string): PluginPagePinKey {
  return `${pluginId}:${pageId}`;
}

function readOverrides(): Record<PluginPagePinKey, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed as Record<PluginPagePinKey, boolean>;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Record<PluginPagePinKey, boolean>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function isPluginPagePinned(
  pluginId: string,
  pageId: string,
  defaultPinned: boolean,
): boolean {
  const key = pinKey(pluginId, pageId);
  const overrides = readOverrides();
  if (key in overrides) return overrides[key]!;
  return defaultPinned;
}

export function setPluginPagePinned(pluginId: string, pageId: string, pinned: boolean) {
  const key = pinKey(pluginId, pageId);
  const overrides = readOverrides();
  overrides[key] = pinned;
  writeOverrides(overrides);
}

export function togglePluginPagePinned(
  pluginId: string,
  pageId: string,
  defaultPinned: boolean,
): boolean {
  const next = !isPluginPagePinned(pluginId, pageId, defaultPinned);
  setPluginPagePinned(pluginId, pageId, next);
  return next;
}
