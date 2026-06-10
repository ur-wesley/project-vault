import { getSetting, setSetting } from "~/services/tauri/settings";

export type ShortcutAction =
  | "command-palette:open"
  | "settings:open"
  | "locations:open"
  | "sidebar:toggle"
  | "new-project:open"
  | "screenshot:capture"
  | "notification-center:toggle"
  | "project-tab:1"
  | "project-tab:2"
  | "project-tab:3"
  | "project-tab:4"
  | "project-tab:5"
  | "project-tab:6"
  | "project-tab:next"
  | "project-tab:prev"
  | "project-terminal:focus";

export const SHORTCUT_SETTING_KEY = "shortcut_registry_v1";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  "command-palette:open": ["Control", "k"],
  "settings:open": ["Control", ","],
  "locations:open": ["Control", "Shift", "l"],
  "sidebar:toggle": ["Control", "b"],
  "new-project:open": [],
  "screenshot:capture": ["Control", "Shift", "s"],
  "notification-center:toggle": ["Control", "Shift", "n"],
  "project-tab:1": ["Control", "1"],
  "project-tab:2": ["Control", "2"],
  "project-tab:3": ["Control", "3"],
  "project-tab:4": ["Control", "4"],
  "project-tab:5": ["Control", "5"],
  "project-tab:6": ["Control", "6"],
  "project-tab:next": ["Control", "Tab"],
  "project-tab:prev": ["Control", "Shift", "Tab"],
  "project-terminal:focus": ["Control", "Shift", "t"],
};

export const SHORTCUT_ACTION_LABEL_KEYS: Record<ShortcutAction, string> = {
  "command-palette:open": "settings.shortcutsLabelCommandPalette",
  "settings:open": "settings.shortcutsLabelSettings",
  "locations:open": "settings.shortcutsLabelLocations",
  "sidebar:toggle": "settings.shortcutsLabelSidebar",
  "new-project:open": "settings.shortcutsLabelNewProject",
  "screenshot:capture": "settings.shortcutsLabelScreenshot",
  "notification-center:toggle": "settings.shortcutsLabelNotificationCenter",
  "project-tab:1": "settings.shortcutsLabelProjectTab1",
  "project-tab:2": "settings.shortcutsLabelProjectTab2",
  "project-tab:3": "settings.shortcutsLabelProjectTab3",
  "project-tab:4": "settings.shortcutsLabelProjectTab4",
  "project-tab:5": "settings.shortcutsLabelProjectTab5",
  "project-tab:6": "settings.shortcutsLabelProjectTab6",
  "project-tab:next": "settings.shortcutsLabelProjectTabNext",
  "project-tab:prev": "settings.shortcutsLabelProjectTabPrev",
  "project-terminal:focus": "settings.shortcutsLabelProjectTerminalFocus",
};

export function isGlobalHotkeyAction(action: string): boolean {
  return action === "screenshot:capture";
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

export async function saveShortcutRegistry(
  registry: Record<string, string[]>,
): Promise<void> {
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
