import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Setter } from "solid-js";

import type { NotificationCenterApi } from "~/lib/notification-store";
import type { TFunction } from "./pluginTypes";

/**
 * Update-check domain: pending updates, check/update/update-all.
 * (Extracted verbatim from PluginDashboard.)
 */
export function createPluginUpdatesModel(opts: {
  t: TFunction;
  notify: NotificationCenterApi["notify"];
  setBusy: Setter<boolean>;
  fetchPlugins: () => Promise<void>;
  invalidatePluginUpdateQueries: () => void;
}) {
  const { t, notify, setBusy, fetchPlugins, invalidatePluginUpdateQueries } = opts;
  const [pendingUpdates, setPendingUpdates] = createSignal<string[]>([]);

  // Check for updates
  const handleCheckUpdates = async () => {
    setBusy(true);
    notify({
      severity: "info",
      title: t("pluginsDashboard.notifyCheckingUpdates"),
      body: t("pluginsDashboard.notifyCheckingUpdatesDesc"),
      durationMs: 3000,
    });
    try {
      const updates = await invoke<string[]>("check_plugin_updates");
      setPendingUpdates(updates);
      if (updates.length > 0) {
        notify({
          severity: "success",
          title: t("pluginsDashboard.notifyUpdatesFound"),
          body: t("pluginsDashboard.notifyUpdatesFoundDesc", { count: updates.length }),
          durationMs: 5000,
        });
      } else {
        notify({
          severity: "info",
          title: t("pluginsDashboard.notifyUpToDate"),
          body: t("pluginsDashboard.notifyUpToDateDesc"),
          durationMs: 3000,
        });
      }
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyUpdateCheckFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshPendingUpdates = async () => {
    try {
      const updates = await invoke<string[]>("check_plugin_updates");
      setPendingUpdates(updates);
    } catch {
      setPendingUpdates([]);
    }
    invalidatePluginUpdateQueries();
  };

  const handleUpdatePlugin = async (pluginId: string) => {
    setBusy(true);
    notify({
      severity: "info",
      title: t("pluginsDashboard.notifyUpdatingPlugin"),
      body: t("pluginsDashboard.notifyUpdatingPluginDesc"),
      durationMs: 3000,
    });
    try {
      await invoke("update_plugin_git", { pluginId });
      await fetchPlugins();
      await refreshPendingUpdates();
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyPluginUpdated"),
        body: t("pluginsDashboard.notifyPluginUpdatedDesc"),
        durationMs: 4000,
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyPluginUpdateFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateAll = async () => {
    const pending = pendingUpdates();
    if (pending.length === 0) return;
    setBusy(true);
    notify({
      severity: "info",
      title: t("pluginsDashboard.notifyUpdatingAll"),
      body: t("pluginsDashboard.notifyUpdatingAllDesc"),
      durationMs: 3000,
    });
    try {
      const updated = await invoke<string[]>("update_all_plugins");
      await fetchPlugins();
      await refreshPendingUpdates();
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyAllUpdated"),
        body: t("pluginsDashboard.notifyAllUpdatedDesc", { count: updated.length }),
        durationMs: 5000,
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyAllUpdateFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    pendingUpdates,
    handleCheckUpdates,
    refreshPendingUpdates,
    handleUpdatePlugin,
    handleUpdateAll,
  };
}
