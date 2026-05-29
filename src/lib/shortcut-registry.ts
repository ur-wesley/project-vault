import { getSetting, setSetting } from "~/services/tauri/settings";

export type ShortcutAction =
  | "command-palette:open"
  | "settings:open"
  | "locations:open"
  | "sidebar:toggle"
  | "new-project:open"
  | "terminal:toggle";

export const SHORTCUT_SETTING_KEY = "shortcut_registry_v1";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  "command-palette:open": ["Control", "k"],
  "settings:open": ["Control", ","],
  "locations:open": ["Control", "Shift", "l"],
  "sidebar:toggle": ["Control", "b"],
  "new-project:open": [],
  "terminal:toggle": ["Control", "`"],
};

export const SHORTCUT_ACTION_LABELS: Record<ShortcutAction, string> = {
  "command-palette:open": "shortcuts.commandPalette",
  "settings:open": "shortcuts.settings",
  "locations:open": "shortcuts.locations",
  "sidebar:toggle": "shortcuts.sidebar",
  "new-project:open": "shortcuts.newProject",
  "terminal:toggle": "shortcuts.terminal",
};

export async function loadShortcutRegistry(): Promise<Record<ShortcutAction, string[]>> {
  const r = await getSetting(SHORTCUT_SETTING_KEY);
  if (r.isErr()) return { ...DEFAULT_SHORTCUTS };
  try {
    const parsed = JSON.parse(r.value ?? "{}") as Record<string, string[]>;
    const merged: Record<ShortcutAction, string[]> = { ...DEFAULT_SHORTCUTS };
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
      if (parsed[key] && Array.isArray(parsed[key])) {
        merged[key as ShortcutAction] = parsed[key]!;
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export async function saveShortcutRegistry(
  registry: Record<ShortcutAction, string[]>,
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
