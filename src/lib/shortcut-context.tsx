import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  type ParentComponent,
  For,
  createResource,
  onCleanup,
} from "solid-js";
import { useEventHub } from "./event-hub-context";
import {
  loadShortcutRegistry,
  DEFAULT_SHORTCUTS,
  formatShortcut,
  isGlobalHotkeyAction,
} from "./shortcut-registry";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import { isTauri } from "@tauri-apps/api/core";

interface ShortcutContextValue {
  bindings: () => Record<string, string[]>;
  reload: () => void;
  format: (action: string) => string;
  isRecording: () => boolean;
  setRecording: (v: boolean) => void;
}

const ShortcutCtx = createContext<ShortcutContextValue>();

function ShortcutListener(props: {
  keys: string[];
  onPress: () => void;
  enabled: () => boolean;
}) {
  createEffect(() => {
    if (props.keys.length === 0) return;

    const target = props.keys.map((k) => k.toLowerCase());
    const targetSet = new Set(target);

    const handler = (e: KeyboardEvent) => {
      if (!props.enabled()) return;

      const heldSet = new Set<string>();
      if (e.ctrlKey) heldSet.add("control");
      if (e.altKey) heldSet.add("alt");
      if (e.shiftKey) heldSet.add("shift");
      if (e.metaKey) heldSet.add("meta");

      const key = e.key.toLowerCase();
      heldSet.add(key);

      const exact =
        heldSet.size === targetSet.size &&
        target.every((k) => heldSet.has(k));
      if (!exact) return;

      e.preventDefault();
      props.onPress();
    };

    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });
  return null;
}

function keysToTauriShortcut(keys: string[]): string {
  return keys
    .map((k) => {
      const lower = k.toLowerCase();
      if (lower === "control") return "Ctrl";
      if (lower === "meta") return "Super";
      if (lower === "alt") return "Alt";
      if (lower === "shift") return "Shift";
      return k.toUpperCase();
    })
    .join("+");
}

export const ShortcutProvider: ParentComponent = (props) => {
  const hub = useEventHub();
  const [registry] = createResource(loadShortcutRegistry);
  const [bindings, setBindings] = createSignal<Record<string, string[]>>({
    ...DEFAULT_SHORTCUTS,
  });
  const [isRecording, setRecording] = createSignal(false);

  createEffect(() => {
    const data = registry();
    if (data) setBindings(data);
  });

  const registeredShortcuts = new Map<string, string>();
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;

  createEffect(() => {
    if (!isTauri()) return;
    const current = bindings();
    const globalActions = Object.keys(current).filter(isGlobalHotkeyAction);
    const myGen = ++generation;

    const desired = new Map<string, string>();
    const seen = new Set<string>();
    for (const action of globalActions) {
      const keys = current[action] ?? [];
      if (keys.length === 0) continue;
      const shortcutStr = keysToTauriShortcut(keys);
      if (!shortcutStr) continue;
      if (seen.has(shortcutStr)) continue;
      seen.add(shortcutStr);
      desired.set(shortcutStr, action);
    }

    queue = queue.then(async () => {
      if (myGen !== generation) return;

      const toUnregister: string[] = [];
      for (const [shortcut, action] of registeredShortcuts) {
        if (desired.get(shortcut) !== action) {
          toUnregister.push(shortcut);
        }
      }

      for (const shortcut of toUnregister) {
        if (myGen !== generation) return;
        try {
          if (await isRegistered(shortcut)) {
            await unregister(shortcut);
          }
        } catch (e) {
          console.error(
            "[ShortcutContext] Failed to unregister global shortcut:",
            shortcut,
            e,
          );
        }
        registeredShortcuts.delete(shortcut);
      }

      if (myGen !== generation) return;

      for (const [shortcut, action] of desired) {
        if (myGen !== generation) return;
        if (registeredShortcuts.has(shortcut)) continue;

        try {
          if (await isRegistered(shortcut)) {
            await unregister(shortcut);
          }
        } catch (e) {
          console.warn(
            "[ShortcutContext] Failed to unregister stale shortcut:",
            shortcut,
            e,
          );
        }

        try {
          const ok = await register(shortcut, (event: { state: string }) => {
            if (event.state === "Pressed") {
              hub.emit("shortcut:action", { action });
            }
          }).then(
            () => true,
            (e) => {
              console.error(
                "[ShortcutContext] Failed to register global shortcut:",
                shortcut,
                e,
              );
              return false;
            },
          );
          if (ok) registeredShortcuts.set(shortcut, action);
        } catch (e) {
          console.error(
            "[ShortcutContext] Failed to register global shortcut:",
            shortcut,
            e,
          );
        }
      }
    });
  });

  onCleanup(() => {
    if (!isTauri()) return;
    generation++;
    const leftovers = Array.from(registeredShortcuts.keys());
    registeredShortcuts.clear();
    if (leftovers.length > 0) {
      void unregister(leftovers).catch(() => undefined);
    }
  });

  const reload = () => {
    void loadShortcutRegistry().then((r) => setBindings(r));
  };

  const format = (action: string) => {
    return formatShortcut(bindings()[action] ?? []);
  };

  const usesGlobalHotkey = (action: string) => {
    if (!isTauri()) return false;
    if (!isGlobalHotkeyAction(action)) return false;
    const keys = bindings()[action] ?? [];
    return keys.length > 0;
  };

  return (
    <ShortcutCtx.Provider
      value={{ bindings, reload, format, isRecording, setRecording }}
    >
      <For each={Object.entries(bindings())}>
        {([action, keys]) => {
          if (keys.length === 0) return null;
          if (usesGlobalHotkey(action)) return null;
          return (
            <ShortcutListener
              keys={keys}
              enabled={() => !isRecording()}
              onPress={() => hub.emit("shortcut:action", { action })}
            />
          );
        }}
      </For>
      {props.children}
    </ShortcutCtx.Provider>
  );
};

export function useShortcuts() {
  const ctx = useContext(ShortcutCtx);
  if (!ctx) throw new Error("ShortcutProvider missing");
  return ctx;
}
