import { fuzzyScore } from "~/lib/fuzzy-score";
import { SHORTCUT_ACTION_LABEL_KEYS } from "~/lib/shortcut-registry";

export type SettingsSearchItem = {
  id: string;
  tab: string;
  labelKey: string;
  descriptionKey?: string;
  extraKeys?: string[];
};

export type SettingsSearchResult = SettingsSearchItem & {
  score: number;
  label: string;
  tabLabel: string;
};

const TAB_LABEL_KEYS: Record<string, string> = {
  general: "settings.tabGeneral",
  locations: "settings.tabLocations",
  tools: "settings.tabTools",
  shortcuts: "settings.tabShortcuts",
  templates: "settings.tabTemplates",
  plugins: "settings.tabPlugins",
  accounts: "settings.tabAccounts",
  notifications: "settings.tabNotifications",
};

const STATIC_SETTINGS_ITEMS: SettingsSearchItem[] = [
  {
    id: "general-interface",
    tab: "general",
    labelKey: "settings.interfaceTitle",
    descriptionKey: "settings.interfaceDescription",
  },
  {
    id: "general-clipboard",
    tab: "general",
    labelKey: "settings.clipboardHistoryTitle",
    descriptionKey: "settings.clipboardHistoryDescription",
  },
  {
    id: "general-portless",
    tab: "general",
    labelKey: "settings.portlessTitle",
    descriptionKey: "settings.portlessDescription",
  },
  {
    id: "general-data",
    tab: "general",
    labelKey: "settings.dataTitle",
    descriptionKey: "settings.dataDescription",
  },
  {
    id: "general-maintenance",
    tab: "general",
    labelKey: "settings.maintenanceTitle",
    descriptionKey: "settings.maintenanceDescription",
  },
  { id: "general-language", tab: "general", labelKey: "settings.language" },
  { id: "general-scan-interval", tab: "general", labelKey: "settings.scanInterval" },
  {
    id: "general-auto-index",
    tab: "general",
    labelKey: "settings.autoIndexTitle",
    descriptionKey: "settings.autoIndexDescription",
    extraKeys: ["settings.autoIndexToggle"],
  },
  {
    id: "general-auto-check-updates",
    tab: "general",
    labelKey: "settings.updatesTitle",
    descriptionKey: "settings.updatesDescription",
    extraKeys: ["settings.autoCheckUpdatesToggle"],
  },
  { id: "general-check-for-updates", tab: "general", labelKey: "settings.checkForUpdates" },
  {
    id: "general-auto-start",
    tab: "general",
    labelKey: "settings.autoStartTitle",
    descriptionKey: "settings.autoStartDescription",
    extraKeys: ["settings.autoStartToggle"],
  },
  {
    id: "general-global-terminal-cwd",
    tab: "general",
    labelKey: "settings.terminalTitle",
    descriptionKey: "settings.terminalDescription",
    extraKeys: ["settings.globalTerminalCwd"],
  },
  {
    id: "general-screenshot-save-dir",
    tab: "general",
    labelKey: "settings.screenshotTitle",
    descriptionKey: "settings.screenshotDescription",
    extraKeys: ["settings.screenshotSaveDir"],
  },
  {
    id: "general-clipboard-enabled",
    tab: "general",
    labelKey: "settings.clipboardHistoryEnabled",
    descriptionKey: "settings.clipboardHistoryDescription",
  },
  {
    id: "general-clipboard-max-entries",
    tab: "general",
    labelKey: "settings.clipboardHistoryMaxEntries",
  },
  {
    id: "general-clipboard-dedup",
    tab: "general",
    labelKey: "settings.clipboardHistoryDedup",
  },
  {
    id: "general-clipboard-show-source",
    tab: "general",
    labelKey: "settings.clipboardHistoryShowSource",
  },
  {
    id: "general-portless-enabled",
    tab: "general",
    labelKey: "settings.portlessToggle",
    descriptionKey: "settings.portlessToggleDescription",
  },
  {
    id: "general-portless-proxy-port",
    tab: "general",
    labelKey: "settings.portlessProxyPort",
  },
  {
    id: "general-portless-tls",
    tab: "general",
    labelKey: "settings.portlessTls",
    descriptionKey: "settings.portlessTlsDescription",
  },
  { id: "general-export", tab: "general", labelKey: "settings.export" },
  { id: "general-open-app-data-dir", tab: "general", labelKey: "settings.openAppDataDir" },
  {
    id: "general-rebuild-database",
    tab: "general",
    labelKey: "settings.rebuildDatabase",
    descriptionKey: "settings.maintenanceDescription",
  },
  {
    id: "tools-external-apps",
    tab: "tools",
    labelKey: "settings.externalAppsTitle",
    descriptionKey: "settings.externalAppsDescription",
  },
  { id: "tools-default-ide", tab: "tools", labelKey: "settings.defaultIde" },
  { id: "tools-default-shell", tab: "tools", labelKey: "settings.defaultShell" },
  {
    id: "tools-custom-shell-path",
    tab: "tools",
    labelKey: "settings.customShellPath",
    descriptionKey: "settings.customShellPathDescription",
  },
  {
    id: "tools-system-tools",
    tab: "tools",
    labelKey: "settings.systemToolsTitle",
    descriptionKey: "settings.systemToolsDescription",
  },
  {
    id: "accounts-github",
    tab: "accounts",
    labelKey: "settings.githubTitle",
    descriptionKey: "settings.githubDescription",
  },
  { id: "accounts-github-token", tab: "accounts", labelKey: "settings.githubToken" },
  {
    id: "notifications-title",
    tab: "notifications",
    labelKey: "settings.notificationsTitle",
    descriptionKey: "settings.notificationsDescription",
  },
  {
    id: "shortcuts-title",
    tab: "shortcuts",
    labelKey: "settings.shortcutsTitle",
    descriptionKey: "settings.shortcutsDescription",
  },
  {
    id: "shortcuts-app",
    tab: "shortcuts",
    labelKey: "settings.shortcutsAppSection",
  },
  {
    id: "shortcuts-hotkey",
    tab: "shortcuts",
    labelKey: "settings.shortcutsHotkeySection",
    descriptionKey: "settings.shortcutsHotkeyDescription",
  },
  {
    id: "notifications-quiet",
    tab: "notifications",
    labelKey: "settings.quietTitle",
    descriptionKey: "settings.quietDescription",
  },
  {
    id: "notifications-os",
    tab: "notifications",
    labelKey: "settings.osTitle",
    descriptionKey: "settings.osDescription",
  },
  {
    id: "notifications-test",
    tab: "notifications",
    labelKey: "settings.testNotificationLabel",
    descriptionKey: "settings.testNotificationDesc",
  },
  { id: "locations", tab: "locations", labelKey: "locations.title", descriptionKey: "locations.description" },
  { id: "templates", tab: "templates", labelKey: "templates.title", descriptionKey: "templates.description" },
  {
    id: "plugins",
    tab: "plugins",
    labelKey: "settings.pluginsTitle",
    descriptionKey: "settings.pluginsDescription",
  },
];

function shortcutSearchId(action: string): string {
  return `shortcut-${action.replace(/:/g, "-")}`;
}

function buildCatalog(): SettingsSearchItem[] {
  const shortcutItems: SettingsSearchItem[] = Object.entries(SHORTCUT_ACTION_LABEL_KEYS).map(
    ([action, labelKey]) => ({
      id: shortcutSearchId(action),
      tab: "shortcuts",
      labelKey,
    }),
  );
  return [...STATIC_SETTINGS_ITEMS, ...shortcutItems];
}

export function settingElementId(id: string): string {
  return `setting-${id}`;
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[\s\-_./\\]+/g, "");
}

function scoreAgainst(query: string, target: string): number {
  if (!target) return 0;
  return Math.max(fuzzyScore(query, target), fuzzyScore(compact(query), compact(target)));
}

export function filterSettings(
  query: string,
  t: (key: string) => string,
): SettingsSearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const results: SettingsSearchResult[] = [];

  for (const item of buildCatalog()) {
    const label = t(item.labelKey);
    const description = item.descriptionKey ? t(item.descriptionKey) : "";
    const tabLabel = t(TAB_LABEL_KEYS[item.tab] ?? item.tab);
    const extras = (item.extraKeys ?? []).map((key) => t(key));

    const score = Math.max(
      scoreAgainst(q, label),
      description ? scoreAgainst(q, description) : 0,
      scoreAgainst(q, tabLabel),
      ...extras.map((extra) => scoreAgainst(q, extra)),
    );

    if (score > 0) {
      results.push({ ...item, score, label, tabLabel });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
