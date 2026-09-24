import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { getPluginLogStore } from "~/lib/plugin/plugin-log-store";
import { type PluginInfo, type TFunction } from "./pluginTypes";

export type LogPluginOption = { value: string; label: string; textValue: string };

/**
 * Log-console domain: filters, options, filtered entries, sticky autoscroll.
 * (Extracted verbatim from PluginDashboard.)
 */
export function createPluginLogsModel(opts: {
  t: TFunction;
  plugins: Accessor<PluginInfo[]>;
  activeTab: Accessor<string>;
  pluginName: (plugin: PluginInfo) => string;
}) {
  const { t, plugins, activeTab, pluginName } = opts;
  const logStore = getPluginLogStore();
  const [logFilter, setLogFilter] = createSignal<"all" | "info" | "error">("all");
  const [logPluginFilter, setLogPluginFilter] = createSignal("all");

  let logsContainerRef: HTMLDivElement | undefined;
  // Sticky follow: auto-scroll only while the user is pinned near the bottom
  // so new entries don't yank the view away while reading history.
  let logsPinnedToBottom = true;
  let prevTab: string | null = null;

  function snapLogsToBottom() {
    const el = logsContainerRef;
    if (!el) return;
    // Sync attempt for the already-laid-out case; rAF re-applies after
    // mount/paint (inactive tab panels unmount, so geometry may lag a frame).
    el.scrollTop = el.scrollHeight;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const target = logsContainerRef;
        if (target) target.scrollTop = target.scrollHeight;
      });
    }
  }

  const logPluginOptions = createMemo((): LogPluginOption[] => {
    const options: LogPluginOption[] = [
      {
        value: "all",
        label: t("pluginsDashboard.logFilterPluginAll"),
        textValue: t("pluginsDashboard.logFilterPluginAll"),
      },
    ];
    const seen = new Set<string>();
    for (const plugin of plugins()) {
      if (seen.has(plugin.id)) continue;
      seen.add(plugin.id);
      options.push({
        value: plugin.id,
        label: pluginName(plugin),
        textValue: plugin.id,
      });
    }
    for (const log of logStore.logs()) {
      if (seen.has(log.pluginId)) continue;
      seen.add(log.pluginId);
      options.push({
        value: log.pluginId,
        label: log.pluginId,
        textValue: log.pluginId,
      });
    }
    options.sort((a, b) => {
      if (a.value === "all") return -1;
      if (b.value === "all") return 1;
      return a.label.localeCompare(b.label);
    });
    return options;
  });

  const currentLogPluginOption = createMemo(
    () => logPluginOptions().find((o) => o.value === logPluginFilter()) ?? logPluginOptions()[0],
  );

  const filteredLogs = createMemo(() => {
    const pluginId = logPluginFilter();
    return logStore.logs().filter((log) => {
      if (pluginId !== "all" && log.pluginId !== pluginId) return false;
      return logFilter() === "all" || log.level === logFilter();
    });
  });

  // Auto-scroll logs: snap when opening the tab (entries may have arrived
  // while the panel was unmounted); otherwise follow only while pinned to
  // the bottom so reading history isn't yanked away.
  createEffect(() => {
    const tab = activeTab();
    const count = filteredLogs().length;
    const justOpened = prevTab !== null && prevTab !== "logs" && tab === "logs";
    prevTab = tab;
    if (tab !== "logs" || count === 0) return;
    if (justOpened || logsPinnedToBottom) snapLogsToBottom();
  });

  return {
    logFilter,
    setLogFilter,
    logPluginFilter,
    setLogPluginFilter,
    logPluginOptions,
    currentLogPluginOption,
    filteredLogs,
    snapLogsToBottom,
    clearLogs: () => {
      logStore.clear();
    },
    setLogsContainerRef: (el: HTMLDivElement | undefined) => {
      logsContainerRef = el;
    },
    setLogsPinnedToBottom: (pinned: boolean) => {
      logsPinnedToBottom = pinned;
    },
  };
}
