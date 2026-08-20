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
export const PLUGINS_PATH_PREFIX = "/plugins";

const SETTINGS_TABS = new Set([
  "general",
  "locations",
  "tools",
  "shortcuts",
  "templates",
  "plugins",
  "accounts",
  "notifications",
]);

export type AppView = "library" | "project" | "processes" | "settings" | "plugin";

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
  pluginId: string | null;
  pluginPageId: string | null;
  view: AppView;
} {
  if (typeof window === "undefined") {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      pluginId: null,
      pluginPageId: null,
      view: "library",
    };
  }
  const path = window.location.pathname;

  if (path === PROCESSES_PATH) {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      pluginId: null,
      pluginPageId: null,
      view: "processes",
    };
  }

  if (path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`)) {
    const parts = path.split("/");
    const settingsTab = normalizeSettingsTab(parts[2] || null);
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab,
      pluginId: null,
      pluginPageId: null,
      view: "settings",
    };
  }

  if (path.startsWith(`${PLUGINS_PATH_PREFIX}/`)) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 3 && parts[0] === "plugins") {
      try {
        const pluginId = decodeURIComponent(parts[1]!);
        const pluginPageId = decodeURIComponent(parts[2]!);
        return {
          projectId: null,
          tab: "readme",
          subDetail: null,
          settingsTab: "general",
          pluginId,
          pluginPageId,
          view: "plugin",
        };
      } catch {
        // fall through to library
      }
    }
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
      pluginId: null,
      pluginPageId: null,
      view: "library",
    };
  }

  try {
    const projectId = decodeURIComponent(m[1]!);
    const tab = normalizeTab(m[2] || null);
    const subDetail = m[3] ? decodeURIComponent(m[3]) : null;
    return {
      projectId,
      tab,
      subDetail,
      settingsTab: "general",
      pluginId: null,
      pluginPageId: null,
      view: "project",
    };
  } catch {
    return {
      projectId: null,
      tab: "readme",
      subDetail: null,
      settingsTab: "general",
      pluginId: null,
      pluginPageId: null,
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

export function buildPluginPageUrl(pluginId: string, pageId: string): string {
  return `${PLUGINS_PATH_PREFIX}/${encodeURIComponent(pluginId)}/${encodeURIComponent(pageId)}`;
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

export function pushUrlToPluginPage(pluginId: string, pageId: string): void {
  if (typeof window === "undefined") return;
  const want = buildPluginPageUrl(pluginId, pageId);
  if (currentLocationKey() === want) return;
  window.history.pushState({ view: "plugin", pluginId, pageId }, "", want);
}

export function replaceUrlToLibrary(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/") return;
  if (
    window.location.pathname.startsWith(`${PROJECTS_PATH_PREFIX}/`) ||
    window.location.pathname.startsWith(SETTINGS_PATH) ||
    window.location.pathname === PROCESSES_PATH ||
    window.location.pathname.startsWith(`${PLUGINS_PATH_PREFIX}/`)
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
    window.location.pathname === PROCESSES_PATH ||
    window.location.pathname.startsWith(`${PLUGINS_PATH_PREFIX}/`)
  ) {
    window.history.pushState({}, "", "/");
  }
}
