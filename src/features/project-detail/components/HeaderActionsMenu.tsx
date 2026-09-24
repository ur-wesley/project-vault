import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

import { cn } from "~/lib/utils";
import { pluginHeaderWidgets } from "~/lib/plugin/plugin-header-widgets";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { PluginIcon } from "~/components/PluginIcon";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { HeaderIdePill } from "./HeaderIdePill";
import { HeaderStats } from "./HeaderStats";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Header right column: plugin widgets, IDE pill, playtime stats.
 * (Extracted verbatim from ProjectDetailHeader.)
 */
export const HeaderActionsMenu: Component<{
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
  livePlaytimeMs: Accessor<number>;
}> = (props) => {
  const { t, m, p, livePlaytimeMs } = props;

  return (
    <div class="flex shrink-0 flex-col items-end gap-1 self-start">
      <div class="flex items-center gap-2">
        <Show when={pluginHeaderWidgets().length > 0}>
          <div class="flex items-center gap-1.5">
            <For each={pluginHeaderWidgets()}>
              {(w) => {
                const executeWidget = async () => {
                  if (w.command) {
                    await invoke("execute_plugin_command", {
                      pluginId: w.pluginId,
                      commandId: w.command,
                      context: { projectId: p().id },
                    });
                  }
                };

                const colorClass = () => {
                  switch (w.color) {
                    case "success":
                      return "bg-green-500/10 text-green-500 border-green-500/30 hover:bg-green-500/20";
                    case "warning":
                      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/20";
                    case "error":
                      return "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20";
                    case "primary":
                      return "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20";
                    case "muted":
                      return "bg-muted/10 text-muted-foreground border-border/40 hover:bg-muted/20";
                    default:
                      return "bg-background text-foreground border-border/60 hover:bg-muted/10";
                  }
                };

                return (
                  <Tooltip>
                    <TooltipTrigger>
                      <Show
                        when={w.type === "button"}
                        fallback={
                          <span
                            class={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold cursor-default",
                              colorClass(),
                            )}
                          >
                            <PluginIcon icon={w.icon} class="size-3.5" />
                            {w.text}
                          </span>
                        }
                      >
                        <button
                          type="button"
                          onClick={executeWidget}
                          class={cn(
                            "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold transition-all active:scale-95",
                            colorClass(),
                          )}
                        >
                          <PluginIcon icon={w.icon} class="size-3.5" />
                          {w.text}
                        </button>
                      </Show>
                    </TooltipTrigger>
                    <Show when={w.tooltip}>
                      <TooltipContent>{w.tooltip}</TooltipContent>
                    </Show>
                  </Tooltip>
                );
              }}
            </For>
          </div>
        </Show>

        <HeaderIdePill t={t} m={m} p={p} />
      </div>
      <HeaderStats t={t} p={p} livePlaytimeMs={livePlaytimeMs} />
    </div>
  );
};
