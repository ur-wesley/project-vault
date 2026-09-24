import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Accessor, Setter } from "solid-js";

import type { NotificationCenterApi } from "~/lib/notification-store";
import { configDefaultToString } from "~/lib/plugin/plugin-config-value";
import { asPluginConfigList, type PluginInfo } from "./pluginTypes";

/**
 * Per-plugin config domain: expand/load values, presets, save.
 * (Extracted verbatim from PluginDashboard.)
 */
export function createPluginConfigModel(opts: {
  notify: NotificationCenterApi["notify"];
  setBusy: Setter<boolean>;
  plugins: Accessor<PluginInfo[]>;
  fetchPlugins: () => Promise<void>;
}) {
  const { notify, setBusy, plugins, fetchPlugins } = opts;
  const [expandedPlugin, setExpandedPlugin] = createSignal<string | null>(null);
  const [configValues, setConfigValues] = createSignal<Record<string, Record<string, string>>>({});

  const handleExpand = async (pluginId: string) => {
    const nextVal = expandedPlugin() === pluginId ? null : pluginId;
    setExpandedPlugin(nextVal);

    if (nextVal) {
      const pluginObj = plugins().find((p) => p.id === pluginId);
      const configItems = asPluginConfigList(pluginObj?.config);
      if (configItems.length > 0) {
        const values: Record<string, string> = {};
        for (const item of configItems) {
          const dbKey = `plugin:${pluginId}:${item.key}`;
          try {
            const val = await invoke<string | null>("get_setting", { key: dbKey });
            values[item.key] = val !== null ? val : configDefaultToString(item.default);
          } catch (e: unknown) {
            console.error("Failed to load setting:", e);
            values[item.key] = configDefaultToString(item.default);
          }
        }
        setConfigValues((prev) => ({ ...prev, [pluginId]: values }));
      }
    }
  };

  const handleSelectPreset = async (pluginId: string, optionId: string) => {
    setBusy(true);
    try {
      const dbKey = `plugin:${pluginId}:active_flavor`;
      await invoke("set_setting", { key: dbKey, value: optionId });

      const pluginObj = plugins().find((p) => p.id === pluginId);
      if (pluginObj && pluginObj.active && pluginObj.enabled) {
        await invoke("execute_plugin_command", {
          pluginId,
          commandId: "apply_theme",
          context: { flavor: optionId },
        });
      }

      notify({
        severity: "success",
        title: "Preset Option Selected",
        body: `Applied flavor: ${optionId}`,
        durationMs: 3000,
      });

      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to select preset:", e);
      notify({
        severity: "error",
        title: "Preset Selection Failed",
        body: e instanceof Error ? e.message : String(e),
        durationMs: 4000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (pluginId: string, key: string, value: string) => {
    try {
      const dbKey = `plugin:${pluginId}:${key}`;
      await invoke("set_setting", { key: dbKey, value });

      setConfigValues((prev) => ({
        ...prev,
        [pluginId]: {
          ...prev[pluginId],
          [key]: value,
        },
      }));

      const pluginObj = plugins().find((p) => p.id === pluginId);
      if (pluginObj && pluginObj.active && pluginObj.enabled) {
        await invoke("execute_plugin_command", {
          pluginId,
          commandId: "init",
          context: {},
        });
      }
    } catch (e: unknown) {
      console.error("Failed to save config:", e);
    }
  };

  return {
    expandedPlugin,
    configValues,
    handleExpand,
    handleSelectPreset,
    handleSaveConfig,
  };
}
