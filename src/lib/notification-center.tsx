import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { toast, type ExternalToast } from "solid-sonner";
import { useWindowFocus } from "~/lib/use-window-focus";
import { sendOsNotification } from "~/services/tauri/notifications";
import { getSetting, setSetting } from "~/services/tauri/settings";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export type NotificationAction = {
  id: string;
  label: string;
  primary?: boolean;
  /** Native callback invoked in the renderer. */
  run?: () => void | Promise<void>;
  /** Plugin command id, dispatched as `plugin:<id>:<commandId>` (only when set on plugin items). */
  command?: string;
};

export type NotificationProgress = {
  value?: number;
  indeterminate?: boolean;
};

export type NotificationItem = {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  source?: string;
  icon?: string;
  actions?: NotificationAction[];
  progress?: NotificationProgress;
  createdAt: number;
  read: boolean;
  /** When non-null, the item is auto-removed after this many ms (sticky by default). */
  durationMs?: number;
  /** When true, the item was mirrored to the OS notification surface. */
  systemSent: boolean;
  /** Resolves to "auto" | "always" | "never". */
  system: "auto" | "always" | "never";
  persist?: boolean;
  toast?: boolean;
};

export type NotifyOptions = {
  id?: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  source?: string;
  icon?: string;
  actions?: NotificationAction[];
  progress?: NotificationProgress;
  durationMs?: number;
  system?: "auto" | "always" | "never";
  persist?: boolean;
  toast?: boolean;
};

export type NotificationCenterApi = {
  items: Accessor<NotificationItem[]>;
  unreadCount: Accessor<number>;
  quiet: Accessor<boolean>;
  setQuiet: (next: boolean) => void;
  notify: (opts: NotifyOptions) => string;
  dismiss: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  clearRead: () => void;
  setSystemEnabled: (next: boolean) => void;
  systemEnabled: Accessor<boolean>;
};

const MAX_ITEMS = 100;
const QUIET_SETTING_KEY = "notification_quiet";
const OS_ENABLED_SETTING_KEY = "notification_os_enabled";

const NotificationCenterCtx = createContext<NotificationCenterApi>();

// Module-level reference set by the provider so callers don't need the hook.
let _centerRef: NotificationCenterApi | null = null;
function setCenterRef(api: NotificationCenterApi | null) {
  _centerRef = api;
}

/**
 * Top-level entry point for creating notifications.
 *
 * Works without the `useNotificationCenter` hook — call from anywhere once
 * `<NotificationCenterProvider>` is mounted in the tree. Falls back to a
 * console warning if the provider is not yet mounted.
 */
export function notify(opts: NotifyOptions): string {
  if (!_centerRef) {
    console.warn("[NotificationCenter] notify() called before provider mounted");
    return "";
  }
  return _centerRef.notify(opts);
}

/** Top-level dismiss — removes a notification by id. */
export function dismissNotification(id: string): void {
  _centerRef?.dismiss(id);
}

function randomId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function newItem(id: string, opts: NotifyOptions): NotificationItem {
  return {
    id,
    severity: opts.severity ?? "info",
    title: opts.title,
    body: opts.body,
    source: opts.source,
    icon: opts.icon,
    actions: opts.actions,
    progress: opts.progress,
    createdAt: Date.now(),
    read: false,
    durationMs: opts.durationMs,
    systemSent: false,
    system: opts.system ?? "auto",
    persist: opts.persist,
    toast: opts.toast,
  };
}

export const NotificationCenterProvider: ParentComponent = (props) => {
  const [items, setItems] = createSignal<NotificationItem[]>([]);
  const [quiet, setQuietSignal] = createSignal(false);
  const [systemEnabled, setSystemEnabledSignal] = createSignal(true);
  const isFocused = useWindowFocus();

  // Load persisted preferences on mount.
  onMount(async () => {
    if (!isTauri()) return;
    try {
      const qR = await getSetting(QUIET_SETTING_KEY);
      if (qR.isOk() && qR.value === "true") setQuietSignal(true);
      const sR = await getSetting(OS_ENABLED_SETTING_KEY);
      if (sR.isOk() && sR.value === "false") setSystemEnabledSignal(false);
    } catch {
      // ignore — fall back to defaults
    }
  });

  const setQuiet = (next: boolean) => {
    setQuietSignal(next);
    if (!isTauri()) return;
    void setSetting(QUIET_SETTING_KEY, next ? "true" : "false");
  };

  const setSystemEnabled = (next: boolean) => {
    setSystemEnabledSignal(next);
    if (!isTauri()) return;
    void setSetting(OS_ENABLED_SETTING_KEY, next ? "true" : "false");
  };

  const unreadCount = createMemo(() => items().filter((i) => !i.read).length);

  const maybeSendOs = (item: NotificationItem) => {
    if (item.system === "never") return;
    if (item.system !== "always" && !systemEnabled()) return;
    if (item.system === "auto" && isFocused()) return;
    if (item.systemSent) return;
    void sendOsNotification(item.title, item.body);
    setItems((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, systemSent: true } : p)),
    );
  };

  const notify: NotificationCenterApi["notify"] = (opts) => {
    const id = opts.id ?? randomId();
    const existing = items().find((i) => i.id === id);
    const next = existing ? { ...existing, ...newItem(id, opts), read: existing.read } : newItem(id, opts);

    if (opts.persist === true) {
      setItems((prev) => {
        const without = prev.filter((p) => p.id !== id);
        const merged = [next, ...without];
        if (merged.length > MAX_ITEMS) merged.length = MAX_ITEMS;
        return merged;
      });

      if (next.durationMs && next.durationMs > 0) {
        const removeId = id;
        window.setTimeout(() => {
          setItems((prev) => prev.filter((p) => p.id !== removeId));
        }, next.durationMs);
      }
    }

    if (opts.toast !== false) {
      const severity = opts.severity ?? "info";
      const toastOpts: ExternalToast = {
        id,
        description: opts.body,
        duration: opts.durationMs,
      };

      if (opts.actions && opts.actions.length > 0) {
        const first = opts.actions[0];
        toastOpts.action = {
          label: first.label,
          onClick: () => {
            if (first.run) {
              void first.run();
            } else if (first.command) {
              void runNotificationActionCommand(first.command);
            }
          },
        };
        if (opts.actions.length > 1) {
          const second = opts.actions[1];
          toastOpts.cancel = {
            label: second.label,
            onClick: () => {
              if (second.run) {
                void second.run();
              } else if (second.command) {
                void runNotificationActionCommand(second.command);
              }
            },
          };
        }
      }

      if (severity === "success") {
        toast.success(opts.title, toastOpts);
      } else if (severity === "error") {
        toast.error(opts.title, toastOpts);
      } else if (severity === "warning") {
        toast.warning(opts.title, toastOpts);
      } else {
        toast.info(opts.title, toastOpts);
      }
    }

    maybeSendOs(next);
    return id;
  };

  const dismiss: NotificationCenterApi["dismiss"] = (id) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
    toast.dismiss(id);
  };

  const markAllRead: NotificationCenterApi["markAllRead"] = () => {
    setItems((prev) => prev.map((p) => (p.read ? p : { ...p, read: true })));
  };

  const clear: NotificationCenterApi["clear"] = () => {
    setItems([]);
  };

  const clearRead: NotificationCenterApi["clearRead"] = () => {
    setItems((prev) => prev.filter((p) => !p.read));
  };

  // Listen to plugin notifications and route them into the center instead of toasts.
  onMount(() => {
    const unlistens: UnlistenFn[] = [];

    void listen<{ level: string; message: string }>("plugin:notification", (event) => {
      const { level, message } = event.payload;
      const severity = (
        level === "success" ? "success" :
        level === "error" ? "error" :
        level === "warn" ? "warning" : "info"
      ) as NotificationSeverity;
      notify({
        severity,
        title: message,
        source: "Plugin",
        durationMs: 5000,
        system: "auto",
        persist: false,
      });
    }).then((fn) => unlistens.push(fn));

    void listen<{
      pluginId: string;
      severity: string;
      title: string;
      message?: string;
      source?: string;
      actions?: { id: string; label: string; primary?: boolean; command?: string }[];
      persist?: boolean;
    }>("plugin:notification-rich", (event) => {
      const { pluginId, severity, title, message, source, actions, persist } = event.payload;
      const sev = (
        severity === "success" ? "success" :
        severity === "error" ? "error" :
        severity === "warn" ? "warning" : "info"
      ) as NotificationSeverity;
      notify({
        id: `plugin:${pluginId}:${title}:${Date.now()}`,
        severity: sev,
        title,
        body: message,
        source: source ?? "Plugin",
        actions: actions?.map((a) => ({
          id: a.id,
          label: a.label,
          primary: a.primary,
          command: a.command,
        })),
        system: "auto",
        persist: persist ?? false,
      });
    }).then((fn) => unlistens.push(fn));

    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  const api: NotificationCenterApi = {
    items,
    unreadCount,
    quiet,
    setQuiet,
    notify,
    dismiss,
    markAllRead,
    clear,
    clearRead,
    setSystemEnabled,
    systemEnabled,
  };

  onMount(() => {
    setCenterRef(api);
    onCleanup(() => setCenterRef(null));
  });

  return (
    <NotificationCenterCtx.Provider value={api}>
      {props.children}
    </NotificationCenterCtx.Provider>
  );
};

export function useNotificationCenter(): NotificationCenterApi {
  const ctx = useContext(NotificationCenterCtx);
  if (!ctx) throw new Error("NotificationCenterProvider missing");
  return ctx;
}

/**
 * Dispatch a plugin action command captured by a notification item.
 * Looks like `plugin:<pluginId>:<commandId>`. Returns true if dispatched.
 */
export async function runNotificationActionCommand(command: string, projectId?: string | null): Promise<boolean> {
  if (!command.startsWith("plugin:")) return false;
  const rest = command.slice("plugin:".length);
  const idx = rest.indexOf(":");
  if (idx < 0) return false;
  const pluginId = rest.slice(0, idx);
  const commandId = rest.slice(idx + 1);
  try {
    await invoke("execute_plugin_command", {
      pluginId,
      commandId,
      context: { projectId: projectId ?? null },
    });
    return true;
  } catch (e) {
    console.error(`[NotificationCenter] plugin action failed:`, e);
    return false;
  }
}
