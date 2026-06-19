import type { Component } from "solid-js";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { PluginDiscoveriesBridge } from "~/components/PluginDiscoveriesBridge";

export const PluginDiscoveriesHost: Component = () => {
  const { t } = useI18n();
  const hub = useEventHub();

  return (
    <PluginDiscoveriesBridge
      t={(key, params) => t(key as never, params as never) as string}
      onOpenPluginsSettings={() => {
        hub.emit("ui:open-plugins-settings");
      }}
    />
  );
};
