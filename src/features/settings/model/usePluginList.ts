import { createMemo, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Setter } from "solid-js";

import type { NotificationCenterApi } from "~/lib/notification-store";
import {
  asPluginConfigList,
  asPluginOptionList,
  type PluginInfo,
  type TFunction,
} from "./pluginTypes";

/**
 * Installed-plugin list domain: fetch, toggle, uninstall, derived stats.
 * (Extracted verbatim from PluginDashboard.)
 */
export function createPluginListModel(opts: {
  t: TFunction;
  notify: NotificationCenterApi["notify"];
  setBusy: Setter<boolean>;
}) {
  const { t, notify, setBusy } = opts;
  const [plugins, setPlugins] = createSignal<PluginInfo[]>([]);

  // Fetch all plugins
  const fetchPlugins = async () => {
    try {
      const res = await invoke<PluginInfo[]>("list_plugins");
      setPlugins(
        res.map((plugin) => ({
          ...plugin,
          commands: Array.isArray(plugin.commands) ? plugin.commands : [],
          options: asPluginOptionList(plugin.options),
          config: asPluginConfigList(plugin.config),
        })),
      );
    } catch (e: unknown) {
      console.error("Failed to list plugins:", e);
    }
  };

  // Toggle enable/disable
  const handleToggle = async (plugin: PluginInfo) => {
    setBusy(true);
    try {
      const nextState = !plugin.enabled;
      await invoke("toggle_plugin", { pluginId: plugin.id, enabled: nextState });
      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to toggle plugin:", e);
    } finally {
      setBusy(false);
    }
  };

  // Uninstall plugin
  const handleUninstall = async (pluginId: string) => {
    if (!confirm(t("pluginsDashboard.uninstallConfirm", { id: pluginId }))) {
      return;
    }
    setBusy(true);
    try {
      await invoke("uninstall_plugin", { pluginId });
      notify({
        severity: "info",
        title: t("pluginsDashboard.notifyUninstalled"),
        body: t("pluginsDashboard.notifyUninstalledDesc", { id: pluginId }),
        durationMs: 3000,
      });
      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to uninstall:", e);
    } finally {
      setBusy(false);
    }
  };

  // Derived stats
  const totalPlugins = createMemo(() => plugins().length);
  const activeCount = createMemo(() => plugins().filter((p) => p.active && p.enabled).length);
  const lazyCount = createMemo(
    () => plugins().filter((p) => p.lazy && !p.active && p.enabled).length,
  );
  const localCount = createMemo(() => plugins().filter((p) => !!p.dir || !p.repo).length);
  const totalLoadTime = createMemo(() =>
    plugins().reduce((acc, p) => acc + (p.active && p.enabled ? p.loadTimeMs : 0), 0),
  );

  return {
    plugins,
    fetchPlugins,
    handleToggle,
    handleUninstall,
    totalPlugins,
    activeCount,
    lazyCount,
    localCount,
    totalLoadTime,
  };
}
