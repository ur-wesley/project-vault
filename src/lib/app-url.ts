export const PROJECT_DETAIL_TABS = [
  "readme",
  "issues",
  "files",
  "tasks",
  "terminal",
  "history",
] as const;

export type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number];

const TAB_VALUES = new Set<string>(PROJECT_DETAIL_TABS);

export const PROJECTS_PATH_PREFIX = "/projects";
export const SETTINGS_PATH = "/settings";
export const PROCESSES_PATH = "/processes";

const SETTINGS_TABS = new Set(["general", "locations", "tools", "shortcuts", "templates", "accounts"]);

function normalizeTab(tab: string | null): string {
  if (tab != null && tab.length > 0 && TAB_VALUES.has(tab)) {
    return tab;
  }
  return "readme";
}

function normalizeSettingsTab(tab: string | null): string {
  if (tab != null && tab.length > 0 && SETTINGS_TABS.has(tab)) {
    return tab;
  }
  return "general";
}

export function readAppUrl(): {
  projectId: string | null;
  tab: string;
  subDetail: string | null;
  settingsTab: string;
  view: "library" | "project" | "processes" | "settings";
} {
  if (typeof window === "undefined") {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      view: "library",
    };
  }
  const path = window.location.pathname;

  if (path === PROCESSES_PATH) {
    return { projectId: null, tab: "readme", subDetail: null, settingsTab: "general", view: "processes" };
  }

  if (path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`)) {
    const parts = path.split("/");
    const settingsTab = normalizeSettingsTab(parts[2] || null);
    return { projectId: null, tab: "readme", subDetail: null, settingsTab, view: "settings" };
  }

  const esc = PROJECTS_PATH_PREFIX.replace(/\//g, "\\/");
  // Regex matches: /projects/:projectId, /projects/:projectId/:tab, /projects/:projectId/:tab/:sub
  const m = path.match(new RegExp(`^${esc}\\/([^/]+)(?:\\/([^/]+))?(?:\\/([^/]+))?/?$`));

  if (m == null) {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      view: "library",
    };
  }

  try {
    const projectId = decodeURIComponent(m[1]!);
    const tab = normalizeTab(m[2] || null);
    const subDetail = m[3] ? decodeURIComponent(m[3]) : null;
    return { projectId, tab, subDetail, settingsTab: "general", view: "project" };
  } catch {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      view: "library",
    };
  }
}

export function buildProjectUrl(projectId: string, tab: string, subDetail?: string | null): string {
  const t = normalizeTab(tab);
  let base = `${PROJECTS_PATH_PREFIX}/${encodeURIComponent(projectId)}/${t}`;
  if (subDetail) {
    base += `/${encodeURIComponent(subDetail)}`;
  }
  return base;
}

export function buildSettingsUrl(tab: string): string {
  return `${SETTINGS_PATH}/${normalizeSettingsTab(tab)}`;
}

function currentLocationKey(): string {
  return window.location.pathname + (window.location.search || "");
}

export function replaceUrlToProject(projectId: string, tab: string, subDetail?: string | null): void {
  if (typeof window === "undefined") return;
  const want = buildProjectUrl(projectId, tab, subDetail);
  if (currentLocationKey() === want) return;
  window.history.replaceState({ projectId, tab: normalizeTab(tab), subDetail }, "", want);
}

export function pushUrlToProject(projectId: string, tab: string, subDetail?: string | null): void {
  if (typeof window === "undefined") return;
  const want = buildProjectUrl(projectId, tab, subDetail);
  if (currentLocationKey() === want) return;
  window.history.pushState({ projectId, tab: normalizeTab(tab), subDetail }, "", want);
}

export function replaceUrlToSettings(tab: string): void {
  if (typeof window === "undefined") return;
  const want = buildSettingsUrl(tab);
  if (currentLocationKey() === want) return;
  window.history.replaceState({ view: "settings", tab }, "", want);
}

export function pushUrlToSettings(tab: string): void {
  if (typeof window === "undefined") return;
  const want = buildSettingsUrl(tab);
  if (currentLocationKey() === want) return;
  window.history.pushState({ view: "settings", tab }, "", want);
}

export function replaceUrlToProcesses(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === PROCESSES_PATH) return;
  window.history.replaceState({ view: "processes" }, "", PROCESSES_PATH);
}

export function pushUrlToProcesses(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === PROCESSES_PATH) return;
  window.history.pushState({ view: "processes" }, "", PROCESSES_PATH);
}

export function replaceUrlToLibrary(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/") return;
  if (
    window.location.pathname.startsWith(`${PROJECTS_PATH_PREFIX}/`) ||
    window.location.pathname.startsWith(SETTINGS_PATH) ||
    window.location.pathname === PROCESSES_PATH
  ) {
    window.history.replaceState({}, "", "/");
  }
}

export function pushUrlToLibrary(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/") return;
  if (
    window.location.pathname.startsWith(`${PROJECTS_PATH_PREFIX}/`) ||
    window.location.pathname.startsWith(SETTINGS_PATH) ||
    window.location.pathname === PROCESSES_PATH
  ) {
    window.history.pushState({}, "", "/");
  }
}
