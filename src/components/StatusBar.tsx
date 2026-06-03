import { For, Show, createMemo, onCleanup, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { useNotificationCenter } from "~/lib/notification-center";
import { pluginFooterSegments, type PluginFooterColor } from "~/lib/plugin-footer";
import { listAllProcesses } from "~/services/tauri/sessions";
import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { NotificationCenter } from "~/components/NotificationCenter";

export const StatusBar: Component<{
  activeView: "library" | "project" | "processes" | "settings";
  pathname: string;
  projectName?: string | null;
  projectId?: string | null;
  onShowProcesses: () => void;
  onToggleTerminal: () => void;
  updateVersion?: string | null;
  onOpenUpdatePopup: () => void;
}> = (props) => {
  const { t } = useI18n();
  const hub = useEventHub();
  const center = useNotificationCenter();

  const processesQ = createQuery(() => ({
    queryKey: ["processes", "all"] as const,
    queryFn: async () => {
      const r = await listAllProcesses();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 3000,
    enabled: isTauri(),
  }));

  const runningCount = createMemo(() =>
    (processesQ.data ?? []).filter((p) => p.state === "running" || p.state === "starting").length,
  );

  const unsub = hub.on("scan:complete", (payload) => {
    center.notify({
      severity: "info",
      title: t("library.scanCompleteTitle") as string,
      body: payload.projectCount > 0 ? (t("library.scanCompleteBody", { count: payload.projectCount }) as string) : undefined,
      source: t("library.scanCompleteSource") as string,
      durationMs: 5000,
      system: "auto",
    });
  });
  onCleanup(unsub);

  const leftLabel = createMemo(() => {
    if (props.activeView === "project" && props.projectName) {
      return props.projectName;
    }
    return props.pathname || "/";
  });

  // Color mappings for plugin footer segment variants
  const footerColorClass = (color: PluginFooterColor) => {
    switch (color) {
      case "success":  return "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20";
      case "warning":  return "text-amber-400   bg-amber-500/10   hover:bg-amber-500/20";
      case "error":    return "text-red-400     bg-red-500/10     hover:bg-red-500/20";
      case "primary":  return "text-primary     bg-primary/10     hover:bg-primary/20";
      case "muted":    return "text-muted-foreground/60 bg-transparent hover:bg-accent";
      default:         return "text-foreground/70 bg-transparent hover:bg-accent";
    }
  };

  const handleFooterSegmentClick = async (pluginId: string, command?: string) => {
    if (!command) return;
    try {
      await invoke("execute_plugin_command", {
        pluginId,
        commandId: command,
        context: { projectId: props.projectId ?? null },
      });
    } catch (e) {
      console.error("[plugin footer] command failed:", e);
    }
  };

  return (
    <div class="flex h-6 shrink-0 items-center justify-between border-t border-border/40 bg-background/50 px-2 text-[11px] tabular-nums backdrop-blur-md">
      {/* Left: path or project name */}
      <div class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span class="iconify mdi--routes size-3 shrink-0 opacity-60" />
        <span class="truncate font-mono">{leftLabel()}</span>
      </div>

      {/* Centre: plugin footer segments */}
      <Show when={pluginFooterSegments().length > 0}>
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 scrollbar-none">
          <For each={pluginFooterSegments()}>
            {(seg) => (
              <Tooltip>
                <TooltipTrigger
                  as={seg.command ? "button" : "span"}
                  type={seg.command ? "button" : undefined}
                  onClick={() => seg.command && handleFooterSegmentClick(seg.pluginId, seg.command)}
                  class={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${footerColorClass(seg.color)} ${seg.command ? "cursor-pointer" : "cursor-default"}`}
                >
                  <Show when={seg.icon}>
                    <span class={`iconify ${seg.icon} size-3`} />
                  </Show>
                  <span class="font-mono">{seg.text}</span>
                </TooltipTrigger>
                <Show when={seg.tooltip}>
                  <TooltipContent>{seg.tooltip}</TooltipContent>
                </Show>
              </Tooltip>
            )}
          </For>
        </div>
      </Show>

      {/* Right: update + terminal + running count + bell (flush to right border) */}
      <div class="flex shrink-0 items-center gap-3 -mr-2 pr-0">
        {/* Update download button */}
        <Show when={props.updateVersion}>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex items-center gap-1 rounded px-1 py-0.5 text-primary transition-colors hover:bg-primary/10"
              onClick={() => props.onOpenUpdatePopup()}
            >
              <span class="iconify mdi--download-circle-outline size-3" />
            </TooltipTrigger>
            <TooltipContent>{t("updater.download") as string} v{props.updateVersion}</TooltipContent>
          </Tooltip>
        </Show>

        {/* Global terminal toggle */}
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => props.onToggleTerminal()}
          >
            <span class="iconify mdi--console size-3" />
          </TooltipTrigger>
          <TooltipContent>{t("globalTerminal.tooltip") as string}</TooltipContent>
        </Tooltip>

        {/* Running processes */}
        <Show when={runningCount() > 0}>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => props.onShowProcesses()}
            >
              <span class="iconify mdi--lightning-bolt-outline size-3" />
              <span class="font-mono">{runningCount()}</span>
            </TooltipTrigger>
            <TooltipContent>{t("processes.title") as string}</TooltipContent>
          </Tooltip>
        </Show>

        {/* Notification center (bell) — rightmost, flush on hover */}
        <NotificationCenter projectId={props.projectId} />
      </div>
    </div>
  );
};
