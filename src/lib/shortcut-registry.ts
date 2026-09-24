import { getSetting, setSetting } from "~/services/tauri/settings";

export type ShortcutAction =
  | "command-palette:open"
  | "settings:open"
  | "locations:open"
  | "sidebar:toggle"
  | "new-project:open"
  | "screenshot:capture"
  | "clipboard-history:open"
  | "notification-center:toggle"
  | "project-tab:1"
  | "project-tab:2"
  | "project-tab:3"
  | "project-tab:4"
  | "project-tab:5"
  | "project-tab:6"
  | "project-tab:7"
  | "project-tab:8"
  | "project-tab:next"
  | "project-tab:prev"
  | "project-terminal:focus"
  | "file:save"
  | "file:save-all"
  | "file:close-tab"
  | "file:find"
  | "file:goto-line"
  | "file:format";

export const SHORTCUT_SETTING_KEY = "shortcut_registry_v1";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  "command-palette:open": ["Control", "k"],
  "settings:open": ["Control", ","],
  "locations:open": ["Control", "Shift", "l"],
  "sidebar:toggle": ["Control", "b"],
  "new-project:open": [],
  "screenshot:capture": ["Control", "Shift", "s"],
  "clipboard-history:open": ["Control", "Shift", "v"],
  "notification-center:toggle": ["Control", "Shift", "n"],
  "project-tab:1": ["Control", "1"],
  "project-tab:2": ["Control", "2"],
  "project-tab:3": ["Control", "3"],
  "project-tab:4": ["Control", "4"],
  "project-tab:5": ["Control", "5"],
  "project-tab:6": ["Control", "6"],
  "project-tab:7": ["Control", "7"],
  "project-tab:8": ["Control", "8"],
  "project-tab:next": ["Control", "Tab"],
  "project-tab:prev": ["Control", "Shift", "Tab"],
  "project-terminal:focus": ["Control", "Shift", "t"],
  "file:save": ["Control", "s"],
  "file:save-all": ["Control", "Shift", "s"],
  "file:close-tab": [],
  "file:find": ["Control", "f"],
  "file:goto-line": ["Control", "g"],
  "file:format": ["Shift", "Alt", "f"],
};

export const SHORTCUT_ACTION_LABEL_KEYS: Record<ShortcutAction, string> = {
  "command-palette:open": "settings.shortcutsLabelCommandPalette",
  "settings:open": "settings.shortcutsLabelSettings",
  "locations:open": "settings.shortcutsLabelLocations",
  "sidebar:toggle": "settings.shortcutsLabelSidebar",
  "new-project:open": "settings.shortcutsLabelNewProject",
  "screenshot:capture": "settings.shortcutsLabelScreenshot",
  "clipboard-history:open": "settings.shortcutsLabelClipboardHistory",
  "notification-center:toggle": "settings.shortcutsLabelNotificationCenter",
  "project-tab:1": "settings.shortcutsLabelProjectTab1",
  "project-tab:2": "settings.shortcutsLabelProjectTab2",
  "project-tab:3": "settings.shortcutsLabelProjectTab3",
  "project-tab:4": "settings.shortcutsLabelProjectTab4",
  "project-tab:5": "settings.shortcutsLabelProjectTab5",
  "project-tab:6": "settings.shortcutsLabelProjectTab6",
  "project-tab:7": "settings.shortcutsLabelProjectTab7",
  "project-tab:8": "settings.shortcutsLabelProjectTab8",
  "project-tab:next": "settings.shortcutsLabelProjectTabNext",
  "project-tab:prev": "settings.shortcutsLabelProjectTabPrev",
  "project-terminal:focus": "settings.shortcutsLabelProjectTerminalFocus",
  "file:save": "settings.shortcutsLabelFileSave",
  "file:save-all": "settings.shortcutsLabelFileSaveAll",
  "file:close-tab": "settings.shortcutsLabelFileCloseTab",
  "file:find": "settings.shortcutsLabelFileFind",
  "file:goto-line": "settings.shortcutsLabelFileGotoLine",
  "file:format": "settings.shortcutsLabelFileFormat",
};

export function isGlobalHotkeyAction(action: string): boolean {
  return action === "screenshot:capture" || action === "clipboard-history:open";
}

export function isAppShortcutAction(action: string): boolean {
  return !isGlobalHotkeyAction(action);
}

export async function loadShortcutRegistry(): Promise<Record<string, string[]>> {
  const r = await getSetting(SHORTCUT_SETTING_KEY);
  if (r.isErr()) return { ...DEFAULT_SHORTCUTS };
  try {
    const parsed = JSON.parse(r.value ?? "{}") as Record<string, string[]>;
    const merged: Record<string, string[]> = { ...DEFAULT_SHORTCUTS };
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key])) {
        merged[key] = parsed[key]!;
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export async function saveShortcutRegistry(registry: Record<string, string[]>): Promise<void> {
  const r = await setSetting(SHORTCUT_SETTING_KEY, JSON.stringify(registry));
  if (r.isErr()) throw new Error(r.error.message);
}

export function formatShortcut(keys: string[]): string {
  if (keys.length === 0) return "";
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return keys
    .map((k) => {
      const lower = k.toLowerCase();
      if (lower === "meta") return isMac ? "⌘" : "Ctrl";
      if (lower === "control") return "Ctrl";
      if (lower === "alt") return isMac ? "⌥" : "Alt";
      if (lower === "shift") return isMac ? "⇧" : "Shift";
      return k.toUpperCase();
    })
    .join(isMac ? "" : "+");
}

export function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}
