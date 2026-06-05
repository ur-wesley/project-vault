import type { Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { PluginUpdatesNotificationBridge } from "~/components/PluginUpdatesNotificationBridge";

export const PluginUpdatesNotificationHost: Component = () => {
  const { t } = useI18n();
  const hub = useEventHub();

  return (
    <PluginUpdatesNotificationBridge
      t={(key, params) => t(key as never, params as never) as string}
      onOpenPluginsSettings={() => {
        hub.emit("ui:open-plugins-settings");
      }}
    />
  );
};
