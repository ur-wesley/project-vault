import { For, Show, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "~/lib/i18n-context";
import { useEventHub } from "~/lib/event-hub-context";
import { pluginFooterSegments, type PluginFooterColor } from "~/lib/plugin-footer";
import { getGitStatus } from "~/services/tauri/git";
import { listAllProcesses } from "~/services/tauri/sessions";
import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

type Notification = {
  id: number;
  message: string;
};

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

  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  let nextId = 0;

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

  const gitQ = createQuery(() => ({
    queryKey: ["git", "status", props.projectId] as const,
    queryFn: async () => {
      if (!props.projectId) return null;
      const r = await getGitStatus(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.activeView === "project" && props.projectId != null && isTauri(),
    staleTime: 5000,
  }));

  const runningCount = createMemo(() =>
    (processesQ.data ?? []).filter((p) => p.state === "running" || p.state === "starting").length,
  );

  const addNotification = (message: string) => {
    const id = nextId++;
    setNotifications((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  };

  const unsub = hub.on("scan:complete", (payload) => {
    addNotification(
      `Library updated${payload.projectCount > 0 ? ` · ${payload.projectCount} projects` : ""}`,
    );
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

      {/* Right: notifications + terminal + running count + git */}
      <div class="flex shrink-0 items-center gap-3">
        {/* Notifications — auto-fade */}
        <div class="flex items-center gap-2">
          <For each={notifications()}>
            {(n) => (
              <span class="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary transition-opacity duration-500">
                <span class="iconify mdi--information-outline size-3" />
                {n.message}
              </span>
            )}
          </For>
        </div>

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
            class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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

        {/* Git status */}
        <Show when={props.activeView === "project" && gitQ.data}>
          <div class="flex items-center gap-1 text-muted-foreground">
            <span class="iconify mdi--source-branch size-3" />
            <span class="font-mono">{gitQ.data!.branch}</span>
            <Show when={gitQ.data!.version}>
              <span class="rounded bg-muted px-1 py-0 text-[9px] font-mono text-muted-foreground/70">
                {gitQ.data!.version}
              </span>
            </Show>
            <Show when={gitQ.data!.isDirty}>
              <span class="text-primary">●</span>
            </Show>
            <Show when={gitQ.data!.ahead > 0}>
              <span class="font-mono text-emerald-500">↑{gitQ.data!.ahead}</span>
            </Show>
            <Show when={gitQ.data!.behind > 0}>
              <span class="font-mono text-amber-500">↓{gitQ.data!.behind}</span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
