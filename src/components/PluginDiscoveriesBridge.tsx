import { createEffect, type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/solid-query";
import { useNotificationCenter } from "~/lib/notification-center";

type DiscoveryEvent = {
  repo: string;
  slug: string;
  ids: string[];
};

export const PLUGIN_DISCOVERIES_NOTIFICATION_ID = "plugin-discoveries-pending";

export const PluginDiscoveriesBridge: Component<{
  t: (key: string, params?: Record<string, unknown>) => string;
  onOpenPluginsSettings: () => void;
}> = (props) => {
  const center = useNotificationCenter();
  const queryClient = useQueryClient();

  createEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<DiscoveryEvent[]>("plugin:discoveries", (event) => {
      const totalCount = (event.payload ?? []).reduce(
        (acc, item) => acc + (item.ids?.length ?? 0),
        0,
      );
      if (totalCount === 0) return;

      const t = props.t;
      center.notify({
        id: PLUGIN_DISCOVERIES_NOTIFICATION_ID,
        severity: "info",
        title: t("notificationCenter.pluginDiscoveriesTitle"),
        body: t("notificationCenter.pluginDiscoveriesBody", { count: totalCount }),
        source: t("notificationCenter.pluginDiscoveriesSource"),
        icon: "mdi--puzzle-outline",
        persist: true,
        toast: false,
        system: "never",
        actions: [
          {
            id: "open-plugins-discoveries",
            label: t("notificationCenter.pluginDiscoveriesReview"),
            primary: true,
            run: () => props.onOpenPluginsSettings(),
          },
          {
            id: "dismiss-discoveries",
            label: t("notificationCenter.pluginDiscoveriesDismiss"),
            run: () => center.dismiss(PLUGIN_DISCOVERIES_NOTIFICATION_ID),
          },
        ],
      });

      void queryClient.invalidateQueries({ queryKey: ["plugins", "discoveries"] });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  });

  return null;
};
