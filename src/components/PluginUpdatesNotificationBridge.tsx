import { createEffect, createSignal, type Component } from "solid-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { useNotificationCenter } from "~/lib/notification-center";

export const PLUGIN_UPDATES_NOTIFICATION_ID = "plugin-updates-pending";

export const PluginUpdatesNotificationBridge: Component<{
  t: (key: string, params?: Record<string, unknown>) => string;
  onOpenPluginsSettings: () => void;
}> = (props) => {
  const center = useNotificationCenter();
  const queryClient = useQueryClient();
  const [lastSyncKey, setLastSyncKey] = createSignal<string | null>(null);

  const pluginUpdatesQ = createQuery(() => ({
    queryKey: ["plugins", "updates"] as const,
    queryFn: async () => {
      try {
        return await invoke<string[]>("check_plugin_updates");
      } catch (e) {
        console.error("[plugin updates] check failed:", e);
        return [];
      }
    },
    refetchInterval: 5 * 60 * 1000,
    enabled: isTauri(),
  }));

  const syncNotification = (updates: string[]) => {
    const syncKey = updates.length === 0 ? "" : [...updates].sort().join("\0");
    if (syncKey === lastSyncKey()) return;
    setLastSyncKey(syncKey);

    if (updates.length === 0) {
      center.dismiss(PLUGIN_UPDATES_NOTIFICATION_ID);
      return;
    }

    const t = props.t;
    center.notify({
      id: PLUGIN_UPDATES_NOTIFICATION_ID,
      severity: "warning",
      title: t("notificationCenter.pluginUpdatesTitle"),
      body: t("notificationCenter.pluginUpdatesBody", { count: updates.length }),
      source: t("notificationCenter.pluginUpdatesSource"),
      icon: "mdi--puzzle-outline",
      persist: true,
      toast: false,
      system: "never",
      actions: [
        {
          id: "open-plugins",
          label: t("notificationCenter.pluginUpdatesOpen"),
          primary: true,
          run: () => props.onOpenPluginsSettings(),
        },
        {
          id: "update-all",
          label: t("notificationCenter.pluginUpdatesUpdateAll"),
          run: async () => {
            try {
              await invoke("update_all_plugins");
              await queryClient.invalidateQueries({ queryKey: ["plugins", "updates"] });
            } catch (e) {
              console.error("[plugin updates] update all failed:", e);
              center.notify({
                severity: "error",
                title: t("pluginsDashboard.notifyAllUpdateFailed"),
                body: e instanceof Error ? e.message : String(e),
                durationMs: 6000,
                persist: false,
              });
            }
          },
        },
      ],
    });
  };

  createEffect(() => {
    const updates = pluginUpdatesQ.data;
    if (updates === undefined) return;
    syncNotification(updates);
  });

  return null;
};
