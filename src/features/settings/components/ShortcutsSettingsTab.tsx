import { For, Show, createEffect, createSignal, createResource, on, type Component } from "solid-js";
import { useKeyDownList } from "@solid-primitives/keyboard";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "~/components/ui/button";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTION_LABEL_KEYS,
  saveShortcutRegistry,
  formatShortcut,
  isGlobalHotkeyAction,
  type ShortcutAction,
} from "~/lib/shortcut-registry";
import { useShortcuts } from "~/lib/shortcut-context";
import { useI18n } from "~/lib/i18n-context";

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "control") return "Control";
  if (lower === "alt") return "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "meta") return "Meta";
  if (key.length === 1) return key.toLowerCase();
  const specialMap: Record<string, string> = {
    escape: "Escape",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    space: " ",
    pageup: "PageUp",
    pagedown: "PageDown",
    home: "Home",
    end: "End",
    insert: "Insert",
    capslock: "CapsLock",
    numlock: "NumLock",
    scrolllock: "ScrollLock",
    pause: "Pause",
    printscreen: "PrintScreen",
    contextmenu: "ContextMenu",
  };
  return specialMap[lower] ?? (key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
}

interface ShortcutsSettingsTabProps {
  t: (key: string) => string;
}

interface PluginCommandMetadata {
  id: string;
  title: string;
  scope: string;
  pluginId: string;
  locales?: any;
}

interface ShortcutRow {
  action: string;
  label: string;
  keys: string[];
  group: "app" | "hotkey";
}

export const ShortcutsSettingsTab: Component<ShortcutsSettingsTabProps> = (props) => {
  const shortcuts = useShortcuts();
  const { locale } = useI18n();
  const keysHeld = useKeyDownList();
  let recordingRef: HTMLDivElement | undefined;
  const [editing, setEditing] = createSignal<string | null>(null);
  const [recordingKeys, setRecordingKeys] = createSignal<string[]>([]);
  const [peakKeys, setPeakKeys] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);

  const [pluginCommands] = createResource(async () => {
    try {
      return await invoke<PluginCommandMetadata[]>("list_plugin_commands");
    } catch {
      return [];
    }
  });

  const getPluginCommandLabel = (cmd: PluginCommandMetadata) => {
    const activeLocale = locale();
    const localMap = cmd.locales?.[activeLocale] || cmd.locales?.["en"];
    return localMap?.[`command.${cmd.id}`] || cmd.title;
  };

  const appRows = (): ShortcutRow[] => {
    const list: ShortcutRow[] = [];
    const knownAppActions: ShortcutAction[] = [
      "command-palette:open",
      "settings:open",
      "locations:open",
      "sidebar:toggle",
      "new-project:open",
      "notification-center:toggle",
      "project-tab:1",
      "project-tab:2",
      "project-tab:3",
      "project-tab:4",
      "project-tab:5",
      "project-tab:6",
      "project-tab:next",
      "project-tab:prev",
      "project-terminal:focus",
    ];
    for (const action of knownAppActions) {
      const labelKey = SHORTCUT_ACTION_LABEL_KEYS[action];
      list.push({
        action,
        label: labelKey ? (props.t(labelKey) ?? action) : action,
        keys: shortcuts.bindings()[action] ?? [],
        group: "app",
      });
    }
    return list;
  };

  const hotkeyRows = (): ShortcutRow[] => {
    const list: ShortcutRow[] = [];
    const all = shortcuts.bindings();

    const globalActions: ShortcutAction[] = ["screenshot:capture", "clipboard-history:open"];
    for (const action of globalActions) {
      const labelKey = SHORTCUT_ACTION_LABEL_KEYS[action];
      list.push({
        action,
        label: labelKey ? (props.t(labelKey) ?? action) : action,
        keys: all[action] ?? [],
        group: "hotkey",
      });
    }

    for (const action of Object.keys(all)) {
      if (!action.startsWith("plugin:")) continue;
      const labelKey =
        SHORTCUT_ACTION_LABEL_KEYS[action as ShortcutAction] ?? null;
      list.push({
        action,
        label: labelKey ? (props.t(labelKey) ?? action) : action,
        keys: all[action] ?? [],
        group: "hotkey",
      });
    }

    const cmds = pluginCommands() || [];
    for (const cmd of cmds) {
      const action = `plugin:${cmd.pluginId}:${cmd.id}`;
      if (all[action]) continue;
      list.push({
        action,
        label: getPluginCommandLabel(cmd),
        keys: [],
        group: "hotkey",
      });
    }

    return list;
  };

  createEffect(() => {
    if (editing()) {
      setTimeout(() => recordingRef?.focus(), 0);
    }
  });

  const startRecording = (action: string) => {
    shortcuts.setRecording(true);
    setEditing(action);
    setRecordingKeys([]);
    setPeakKeys([]);
  };

  const stopRecording = () => {
    shortcuts.setRecording(false);
    setEditing(null);
    setRecordingKeys([]);
    setPeakKeys([]);
  };

  const saveBinding = async (action: string, keys: string[]) => {
    setBusy(true);
    try {
      const next = { ...shortcuts.bindings(), [action]: keys };
      await saveShortcutRegistry(next);
      shortcuts.reload();
    } finally {
      setBusy(false);
      stopRecording();
    }
  };

  const resetAll = async () => {
    setBusy(true);
    try {
      const next: Record<string, string[]> = { ...shortcuts.bindings() };
      for (const action of Object.keys(next)) {
        if (isGlobalHotkeyAction(action)) {
          next[action] = DEFAULT_SHORTCUTS[action as ShortcutAction] ?? [];
        } else if (action in DEFAULT_SHORTCUTS) {
          next[action] = DEFAULT_SHORTCUTS[action as ShortcutAction] ?? [];
        } else {
          next[action] = [];
        }
      }
      await saveShortcutRegistry(next);
      shortcuts.reload();
    } finally {
      setBusy(false);
    }
  };

  createEffect(
    on(keysHeld, (current, prev) => {
      if (!editing()) return;

      if (current.length > 0) {
        const normalized = current.map(normalizeKey);
        setRecordingKeys(normalized);
        setPeakKeys((prevPeak) => {
          if (normalized.length > prevPeak.length) return normalized;
          return prevPeak;
        });
      } else if ((prev?.length ?? 0) > 0) {
        const final = peakKeys();
        if (final.length === 1 && final[0] === "Escape") {
          stopRecording();
        } else if (final.length > 0) {
          void saveBinding(editing()!, final);
        } else {
          stopRecording();
        }
      }
    })
  );

  const renderRow = (row: ShortcutRow) => (
    <div class="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
      <span class="text-sm">{row.label}</span>
      <Show
        when={editing() === row.action}
        fallback={
          <button
            type="button"
            disabled={busy()}
            class="flex h-8 min-w-[6rem] items-center justify-center rounded border bg-muted px-3 text-xs font-mono font-medium transition-colors hover:bg-muted/80 disabled:opacity-50"
            onClick={() => startRecording(row.action)}
          >
            {row.keys.length > 0
              ? formatShortcut(row.keys)
              : props.t("settings.shortcutsNone")}
          </button>
        }
      >
        <div
          ref={recordingRef}
          class="flex h-8 min-w-[6rem] items-center justify-center rounded border border-primary bg-primary/5 px-3 text-xs font-mono font-medium text-primary animate-pulse outline-none"
          tabindex={0}
          onBlur={() => stopRecording()}
        >
          {recordingKeys().length > 0
            ? formatShortcut(recordingKeys())
            : props.t("settings.shortcutsPressKeys")}
        </div>
      </Show>
    </div>
  );

  return (
    <div class="space-y-6 animate-in fade-in duration-300">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">
            {props.t("settings.shortcutsTitle")}
          </h3>
          <p class="text-xs text-muted-foreground mt-1">
            {props.t("settings.shortcutsDescription")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy()}
          onClick={() => void resetAll()}
        >
          {props.t("settings.shortcutsResetAll")}
        </Button>
      </div>

      <section class="space-y-2">
        <header>
          <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {props.t("settings.shortcutsAppSection")}
          </h4>
        </header>
        <div class="rounded-md border">
          <For each={appRows()}>{(row) => renderRow(row)}</For>
        </div>
      </section>

      <section class="space-y-2">
        <header>
          <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {props.t("settings.shortcutsHotkeySection")}
          </h4>
          <p class="text-[10px] text-muted-foreground mt-0.5">
            {props.t("settings.shortcutsHotkeyDescription")}
          </p>
        </header>
        <div class="rounded-md border">
          <For each={hotkeyRows()}>{(row) => renderRow(row)}</For>
        </div>
      </section>
    </div>
  );
};
