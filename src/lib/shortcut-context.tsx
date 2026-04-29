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
