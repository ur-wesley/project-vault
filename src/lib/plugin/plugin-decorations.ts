import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DecorationItem = {
  icon?: string;
  label?: string;
  color?: "default" | "success" | "warning" | "error" | "primary" | "muted" | string;
  tooltip?: string;
  command?: string;
  pluginId: string;
};

export type ElementDecorations = {
  before?: DecorationItem[];
  after?: DecorationItem[];
};

export type TabDecorations = Record<string, ElementDecorations>;

// Cache of decorations: projectId -> tabId -> decorations map
const [decorationsCache, setDecorationsCache] = createSignal<
  Record<string, Record<string, TabDecorations>>
>({});
const [decorationsVersion, setDecorationsVersion] = createSignal(0);

export { decorationsCache, decorationsVersion };

export function refreshTabDecorations() {
  setDecorationsVersion((v) => v + 1);
}

export async function fetchTabDecorations(projectId: string, tabId: string, elementIds: string[]) {
  if (elementIds.length === 0) return;
  try {
    const res = await invoke<TabDecorations>("get_tab_decorations", {
      projectId,
      tabId,
      elementIds,
    });
    setDecorationsCache((prev) => {
      const projCache = prev[projectId] || {};
      const tabCache = projCache[tabId] || {};
      const newTabCache = { ...tabCache, ...res };
      return {
        ...prev,
        [projectId]: {
          ...projCache,
          [tabId]: newTabCache,
        },
      };
    });
  } catch (e) {
    console.error(`Failed to fetch decorations for tab ${tabId} in project ${projectId}:`, e);
  }
}

export function getElementDecorations(
  projectId: string,
  tabId: string,
  elementId: string,
): ElementDecorations {
  const projCache = decorationsCache()[projectId];
  if (!projCache) return {};
  const tabCache = projCache[tabId];
  if (!tabCache) return {};
  return tabCache[elementId] || {};
}

export function clearDecorationsCache() {
  setDecorationsCache({});
}

// Only these changeTypes can affect file/git decorations. Everything else
// (viewed, opened, favorite, tags, tasks, ...) must not rebuild the tree.
const DECORATION_RELEVANT_CHANGE_TYPES = new Set([
  "git",
  "version-bump",
  "git-clean",
  "scan",
  "refreshed",
]);

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDecorationsRefresh() {
  // The git watcher can emit bursts; coalesce them into one trailing bump so
  // open folders refetch decorations once instead of once per event.
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshTabDecorations();
  }, 300);
}

// Listen for project:changed to clear cache and trigger re-fetches
void listen<{ projectId: string; changeType: string }>("project:changed", (ev) => {
  const { projectId, changeType } = ev.payload;
  if (!DECORATION_RELEVANT_CHANGE_TYPES.has(changeType)) return;
  setDecorationsCache((prev) => {
    const copy = { ...prev };
    delete copy[projectId];
    return copy;
  });
  scheduleDecorationsRefresh();
});
