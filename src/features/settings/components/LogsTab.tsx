import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { Select } from "~/components/ui/select";
import type { TFunction } from "../model/pluginTypes";
import type { createPluginLogsModel, LogPluginOption } from "../model/usePluginLogs";

/**
 * Log-console tab: filters, test/clear actions, autoscrolling entry list.
 * (Extracted verbatim from PluginDashboard.)
 */
export const LogsTab: Component<{
  t: TFunction;
  activeTab: Accessor<string>;
  logs: ReturnType<typeof createPluginLogsModel>;
}> = (props) => {
  const { t, activeTab, logs } = props;

  return (
    <>
      <div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h5 class="text-xs font-bold text-foreground">{t("pluginsDashboard.consoleTitle")}</h5>
        <div class="flex flex-wrap items-center gap-2">
          <Select<LogPluginOption>
            options={logs.logPluginOptions()}
            optionValue="value"
            optionTextValue="textValue"
            value={logs.currentLogPluginOption()}
            onChange={(o) => o && logs.setLogPluginFilter(o.value)}
            itemComponent={(p) => (
              <Select.Item item={p.item}>
                <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
              </Select.Item>
            )}
          >
            <Select.Trigger class="h-7 min-w-[8rem] max-w-[12rem] border bg-muted/20 px-2 text-[10px] font-semibold shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Select.Value<LogPluginOption>>
                {(s) => (
                  <span class="truncate">
                    {s.selectedOption()?.label ?? t("pluginsDashboard.logFilterPluginAll")}
                  </span>
                )}
              </Select.Value>
              <span
                class="iconify mdi--chevron-down size-3.5 shrink-0 opacity-50"
                aria-hidden="true"
              />
            </Select.Trigger>
            <Select.Content>
              <Select.Listbox />
            </Select.Content>
          </Select>
          <div class="flex items-center rounded border bg-muted/20 p-0.5">
            <button
              class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logs.logFilter() === "all" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
              onClick={() => logs.setLogFilter("all")}
            >
              {t("pluginsDashboard.logFilterAll")}
            </button>
            <button
              class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logs.logFilter() === "info" ? "bg-background shadow text-emerald-400" : "text-muted-foreground"}`}
              onClick={() => logs.setLogFilter("info")}
            >
              {t("pluginsDashboard.logFilterInfo")}
            </button>
            <button
              class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logs.logFilter() === "error" ? "bg-background shadow text-rose-400" : "text-muted-foreground"}`}
              onClick={() => logs.setLogFilter("error")}
            >
              {t("pluginsDashboard.logFilterError")}
            </button>
          </div>
          <button
            class="text-muted-foreground hover:text-foreground text-[10px] flex items-center font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            onClick={() => {
              if (!isTauri()) return;
              void invoke("emit_test_plugin_logs").catch((e: unknown) => {
                console.error("Failed to emit test logs:", e);
              });
            }}
          >
            {t("pluginsDashboard.consoleTest")}
          </button>
          <button
            class="text-muted-foreground hover:text-foreground text-[10px] flex items-center font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            onClick={() => logs.clearLogs()}
          >
            {t("pluginsDashboard.consoleClear")}
          </button>
        </div>
      </div>

      <div
        ref={(el: HTMLDivElement | undefined) => {
          logs.setLogsContainerRef(el);
          // Panel (re)mounted (inactive tabs unmount): if the console is
          // visible, open it at the bottom.
          if (el && activeTab() === "logs" && logs.filteredLogs().length > 0) {
            logs.snapLogsToBottom();
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          logs.setLogsPinnedToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        class="min-h-0 flex-1 basis-64 rounded-lg border border-muted/50 bg-[#07090e] p-2 font-mono text-[10px] leading-tight overflow-y-auto scrollbar-thin select-text flex flex-col gap-0.5"
      >
        <Show
          when={logs.filteredLogs().length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center text-muted-foreground/30 font-sans">
              <span class="iconify mdi--console mb-1 size-8 shrink-0" aria-hidden="true" />
              <span class="text-[9px] font-semibold tracking-wide uppercase">
                {t("pluginsDashboard.consoleEmpty")}
              </span>
            </div>
          }
        >
          <For each={logs.filteredLogs()}>
            {(log) => (
              <div class="flex items-start gap-2 border-b border-white/[0.02] pb-0.5 last:border-0 leading-tight">
                <span class="text-muted-foreground/50 shrink-0 select-none">[{log.timestamp}]</span>
                <span class="text-sky-400 font-bold shrink-0 uppercase tracking-wider">
                  {log.pluginId}
                </span>
                <span
                  class="font-extrabold shrink-0 select-none"
                  class:text-emerald-500={log.level === "info"}
                  class:text-rose-500={log.level === "error"}
                >
                  [{log.level.toUpperCase()}]
                </span>
                <span
                  class="break-all whitespace-pre-wrap flex-1"
                  class:text-slate-200={log.level === "info"}
                  class:text-rose-300={log.level === "error"}
                >
                  {log.message}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
};
