import { For, Show, createMemo, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import type { PluginInfo, TFunction } from "../model/pluginTypes";

/**
 * Profile tab: per-plugin load-time bar chart. (Extracted verbatim from
 * PluginDashboard.)
 */
export const ProfileTab: Component<{
  t: TFunction;
  plugins: Accessor<PluginInfo[]>;
  totalLoadTime: Accessor<number>;
}> = (props) => {
  const { t, plugins, totalLoadTime } = props;

  return (
    <>
      <div class="flex justify-between border-b border-muted/20 pb-2">
        <h5 class="text-xs font-bold text-foreground">{t("pluginsDashboard.loadTimeBreakdown")}</h5>
        <span class="text-xs text-muted-foreground">
          {t("pluginsDashboard.totalLoadTime", { time: totalLoadTime().toFixed(1) })}
        </span>
      </div>

      <div class="space-y-3 font-mono text-[11px]">
        <For
          each={plugins()
            .filter((p) => p.active && p.enabled)
            .sort((a, b) => b.loadTimeMs - a.loadTimeMs)}
        >
          {(plugin) => {
            // Calculate percentage width for visual bar
            const pct = createMemo(() => {
              const max = Math.max(...plugins().map((p) => p.loadTimeMs), 1);
              return (plugin.loadTimeMs / max) * 100;
            });

            return (
              <div class="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                <div class="flex items-center gap-1.5 md:col-span-1">
                  <span
                    class="iconify mdi--flash-outline size-3 shrink-0 text-amber-400"
                    aria-hidden="true"
                  />
                  <span class="truncate font-bold text-foreground">{plugin.id}</span>
                </div>
                <div class="md:col-span-2 bg-muted/20 h-2 rounded overflow-hidden">
                  <div
                    class="bg-primary h-full rounded transition-all duration-500"
                    style={{ width: `${pct()}%` }}
                  />
                </div>
                <div class="md:col-span-1 text-right text-muted-foreground font-bold text-[10px]">
                  {plugin.loadTimeMs.toFixed(2)}ms
                </div>
              </div>
            );
          }}
        </For>
        <Show when={plugins().filter((p) => p.active && p.enabled).length === 0}>
          <div class="py-8 text-center text-xs text-muted-foreground font-sans">
            {t("pluginsDashboard.noActivePlugins")}
          </div>
        </Show>
      </div>
    </>
  );
};
