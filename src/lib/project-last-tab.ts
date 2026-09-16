import { PROJECT_DETAIL_TABS, type ProjectDetailTab } from "./app-url";

const STORAGE_KEY = "pv-project-last-tab";
const TAB_VALUES = new Set<string>(PROJECT_DETAIL_TABS);

function readMap(): Record<string, ProjectDetailTab> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ProjectDetailTab>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, ProjectDetailTab>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function normalizeTab(tab: string): ProjectDetailTab {
  if (TAB_VALUES.has(tab)) return tab as ProjectDetailTab;
  return "readme";
}

export function lastTabFor(projectId: string): ProjectDetailTab {
  const tab = readMap()[projectId];
  if (tab != null) return normalizeTab(tab);
  return "readme";
}

export function rememberTab(projectId: string, tab: string) {
  const map = readMap();
  map[projectId] = normalizeTab(tab);
  writeMap(map);
}
