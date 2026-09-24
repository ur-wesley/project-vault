import { For, type Component } from "solid-js";
import { cn } from "~/lib/utils";
import { PluginIcon } from "~/components/PluginIcon";
import type { PluginStatsItem, PluginStatsTone } from "../types";

const toneClass = (tone: PluginStatsTone | undefined): string => {
  switch (tone) {
    case "warning":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "success":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "error":
      return "border-red-500/40 text-red-600 dark:text-red-400";
    case "primary":
      return "border-primary/40 text-primary";
    case "info":
      return "border-sky-500/40 text-sky-600 dark:text-sky-400";
    case "muted":
      return "border-border/60 text-muted-foreground";
    default:
      return "border-border/60 text-foreground";
  }
};

export const PluginStatsView: Component<{
  items: PluginStatsItem[];
}> = (props) => {
  return (
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <For each={props.items}>
        {(item) => (
          <div
            class={cn(
              "flex min-w-0 items-center gap-2.5 rounded-md border bg-card px-3 py-2.5",
              toneClass(item.tone),
            )}
          >
            <PluginIcon icon={item.icon} class="size-5 shrink-0 opacity-80" />
            <div class="flex min-w-0 flex-col leading-tight">
              <span class="truncate text-lg font-semibold text-foreground">
                {String(item.value)}
              </span>
              <span class="truncate text-[11px] text-muted-foreground">{item.label}</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
