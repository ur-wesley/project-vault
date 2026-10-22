import type { Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { PluginUpdatesNotificationBridge } from "~/components/PluginUpdatesNotificationBridge";

export const PluginUpdatesNotificationHost: Component = () => {
  const { t } = useI18n();
  const hub = useEventHub();

  return (
    <PluginUpdatesNotificationBridge
      t={(key: string, params?: Record<string, unknown>) =>
        t(key as Parameters<typeof t>[0], params as never) as string
      }
      onOpenPluginsSettings={() => {
        hub.emit("ui:open-plugins-settings");
      }}
    />
  );
};
