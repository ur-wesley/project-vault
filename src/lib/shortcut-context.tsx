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
  type ShortcutAction,
  loadShortcutRegistry,
  DEFAULT_SHORTCUTS,
  formatShortcut,
} from "./shortcut-registry";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import { isTauri } from "@tauri-apps/api/core";


interface ShortcutContextValue {
  bindings: () => Record<ShortcutAction, string[]>;
  reload: () => void;
  format: (action: ShortcutAction) => string;
  isRecording: () => boolean;
  setRecording: (v: boolean) => void;
}

const ShortcutCtx = createContext<ShortcutContextValue>();

function ShortcutListener(props: { keys: string[]; onPress: () => void; enabled: () => boolean }) {
  createEffect(() => {
    if (props.keys.length === 0) return;

    const target = props.keys.map((k) => k.toLowerCase());

    const handler = (e: KeyboardEvent) => {
      if (!props.enabled()) return;

      const held: string[] = [];
      if (e.ctrlKey) held.push("control");
      if (e.altKey) held.push("alt");
      if (e.shiftKey) held.push("shift");
      if (e.metaKey) held.push("meta");

      const key = e.key.toLowerCase();
      if (!held.includes(key)) held.push(key);

      const allHeld = target.every((k) => held.includes(k));
      if (!allHeld) return;

      e.preventDefault();
      props.onPress();
    };

    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });
  return null;
}

export const ShortcutProvider: ParentComponent = (props) => {
  const hub = useEventHub();
  const [registry] = createResource(loadShortcutRegistry);
  const [bindings, setBindings] = createSignal<Record<ShortcutAction, string[]>>({
    ...DEFAULT_SHORTCUTS,
  });
  const [isRecording, setRecording] = createSignal(false);

  createEffect(() => {
    const data = registry();
    if (data) setBindings(data);
  });

  let lastGlobalShortcut: string | null = null;

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

  createEffect(() => {
    const keys = bindings()["screenshot:capture"];
    if (!isTauri()) return;

    void (async () => {
      // 1. Unregister the old shortcut if there was one
      if (lastGlobalShortcut) {
        try {
          if (await isRegistered(lastGlobalShortcut)) {
            await unregister(lastGlobalShortcut);
            console.log("[ShortcutContext] Unregistered global shortcut:", lastGlobalShortcut);
          }
        } catch (e) {
          console.error("Failed to unregister global shortcut:", e);
        }
        lastGlobalShortcut = null;
      }

      // 2. Register the new shortcut if valid
      if (keys && keys.length > 0) {
        const shortcutStr = keysToTauriShortcut(keys);
        try {
          await register(shortcutStr, (event) => {
            if (event.state === "Pressed") {
              hub.emit("shortcut:action", { action: "screenshot:capture" });
            }
          });
          lastGlobalShortcut = shortcutStr;
          console.log("[ShortcutContext] Registered global shortcut:", shortcutStr);
        } catch (e) {
          console.error("[ShortcutContext] Failed to register global shortcut:", shortcutStr, e);
        }
      }
    })();
  });

  onCleanup(() => {
    if (isTauri() && lastGlobalShortcut) {
      void (async () => {
        try {
          if (await isRegistered(lastGlobalShortcut!)) {
            await unregister(lastGlobalShortcut!);
          }
        } catch {
          // ignore
        }
      })();
    }
  });

  const reload = () => {
    void loadShortcutRegistry().then((r) => setBindings(r));
  };

  const format = (action: ShortcutAction) => {
    return formatShortcut(bindings()[action] ?? []);
  };

  return (
    <ShortcutCtx.Provider value={{ bindings, reload, format, isRecording, setRecording }}>
      <For each={Object.entries(bindings()) as [ShortcutAction, string[]][]}>
        {([action, keys]) => {
          if (keys.length === 0) return null;
          // Skip local event listener for screenshot:capture on Tauri to prevent double triggers
          if (action === "screenshot:capture" && isTauri()) return null;
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
