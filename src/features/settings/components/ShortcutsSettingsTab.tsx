import { For, Show, createEffect, createSignal, createResource, on, type Component } from "solid-js";
import { useKeyDownList } from "@solid-primitives/keyboard";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "~/components/ui/button";
import {
  type ShortcutAction,
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTION_LABELS,
  saveShortcutRegistry,
  formatShortcut,
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

export const ShortcutsSettingsTab: Component<ShortcutsSettingsTabProps> = (props) => {
  const shortcuts = useShortcuts();
  const { locale } = useI18n();
  const keysHeld = useKeyDownList();
  let recordingRef: HTMLDivElement | undefined;
  const [editing, setEditing] = createSignal<ShortcutAction | null>(null);
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

  const allActions = () => {
    const list: { action: string; label: string; keys: string[] }[] = [];
    
    // Core actions first
    for (const [action, labelKey] of Object.entries(SHORTCUT_ACTION_LABELS)) {
      list.push({
        action,
        label: props.t(labelKey),
        keys: shortcuts.bindings()[action] || [],
      });
    }
    
    // Plugin commands next
    const cmds = pluginCommands() || [];
    for (const cmd of cmds) {
      const action = `plugin:${cmd.pluginId}:${cmd.id}`;
      list.push({
        action,
        label: getPluginCommandLabel(cmd),
        keys: shortcuts.bindings()[action] || [],
      });
    }
    
    return list;
  };

  createEffect(() => {
    if (editing()) {
      setTimeout(() => recordingRef?.focus(), 0);
    }
  });

  const startRecording = (action: ShortcutAction) => {
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

  const saveBinding = async (action: ShortcutAction, keys: string[]) => {
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
      await saveShortcutRegistry({ ...DEFAULT_SHORTCUTS });
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
        // Track the largest combo held during this recording session
        setPeakKeys((prevPeak) => {
          if (normalized.length > prevPeak.length) return normalized;
          return prevPeak;
        });
      } else if ((prev?.length ?? 0) > 0) {
        // All keys released — commit the peak combo
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

  return (
    <div class="space-y-6 animate-in fade-in duration-300">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">{props.t("settings.shortcutsTitle")}</h3>
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

      <div class="rounded-md border">
        <For each={allActions()}>
          {({ action, label, keys }) => (
            <div class="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
              <span class="text-sm">
                {label}
              </span>
              <Show
                when={editing() === action}
                fallback={
                  <button
                    type="button"
                    disabled={busy()}
                    class="flex h-8 min-w-[6rem] items-center justify-center rounded border bg-muted px-3 text-xs font-mono font-medium transition-colors hover:bg-muted/80 disabled:opacity-50"
                    onClick={() => startRecording(action)}
                  >
                    {keys.length > 0 ? formatShortcut(keys) : props.t("settings.shortcutsNone")}
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
          )}
        </For>
      </div>
    </div>
  );
};
