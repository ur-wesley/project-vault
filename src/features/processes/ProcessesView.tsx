import { For, Show, createMemo, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createStore } from "solid-js/store";

import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { listAllProcesses, type ProcessDto } from "~/services/tauri/sessions";
import { stopProjectTask } from "~/services/tauri/tasks";
import { stopProjectIde } from "~/services/tauri/ide";
import { stopAllProjectProcesses } from "~/services/tauri/processes";


type ProjectGroup = {
  projectId: string;
  projectName: string;
  processes: ProcessDto[];
};

type ConfirmState = {
  projectId: string | null;
  timer: number | null;
};

export const ProcessesView: Component<{
  onOpenProject: (id: string) => void;
}> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();

  const [confirmState, setConfirmState] = createStore<ConfirmState>({
    projectId: null,
    timer: null,
  });

  const processesQ = createQuery(() => ({
    queryKey: ["processes", "all"] as const,
    queryFn: async () => {
      const r = await listAllProcesses();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 3000,
  }));

  const grouped = createMemo((): ProjectGroup[] => {
    const data = processesQ.data ?? [];
    const map = new Map<string, ProjectGroup>();
    for (const proc of data) {
      const group = map.get(proc.projectId);
      if (group) {
        group.processes.push(proc);
      } else {
        map.set(proc.projectId, {
          projectId: proc.projectId,
          projectName: proc.projectName,
          processes: [proc],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
  });

  const runningCount = () =>
    (processesQ.data ?? []).filter((p) => p.state === "running" || p.state === "starting").length;

  const handleKill = async (proc: ProcessDto) => {
    if (proc.kind === "ide") {
      const r = await stopProjectIde(proc.projectId);
      if (r.isErr()) {
        console.error("stop ide failed:", r.error);
      }
    } else {
      const r = await stopProjectTask(proc.sessionId);
      if (r.isErr()) {
        const msg = String(r.error.message ?? r.error);
        if (!msg.toLowerCase().includes("not found")) {
          console.error("kill failed:", r.error);
        }
      }
    }
    void qc.invalidateQueries({ queryKey: ["processes", "all"] });
  };

  const clearConfirm = () => {
    if (confirmState.timer != null) {
      window.clearTimeout(confirmState.timer);
    }
    setConfirmState({ projectId: null, timer: null });
  };

  const handleKillAllClick = (projectId: string) => {
    if (confirmState.projectId === projectId) {
      // Second click — confirm and kill all
      clearConfirm();
      void (async () => {
        const r = await stopAllProjectProcesses(projectId);
        if (r.isErr()) {
          console.error("stop all failed:", r.error);
        }
        void qc.invalidateQueries({ queryKey: ["processes", "all"] });
      })();
    } else {
      // First click — show confirmation
      if (confirmState.timer != null) {
        window.clearTimeout(confirmState.timer);
      }
      const timer = window.setTimeout(() => {
        setConfirmState({ projectId: null, timer: null });
      }, 3000);
      setConfirmState({ projectId, timer });
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 class="text-lg font-semibold">{t("processes.title") as string}</h1>
          <p class="text-xs text-muted-foreground">
            {runningCount()} {t("processes.runningCount") as string}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void processesQ.refetch()}
          disabled={processesQ.isFetching}
        >
          <span class="iconify mdi--refresh size-4" />
          <span class="ml-1">{t("common.refresh") as string}</span>
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Show when={processesQ.isPending}>
          <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
        </Show>
        <Show when={processesQ.isError}>
          <p class="text-sm text-destructive">{t("library.error") as string}</p>
        </Show>

        <Show when={!processesQ.isPending && grouped().length === 0}>
          <div class="flex h-full flex-col items-center justify-center text-muted-foreground">
            <span class="iconify mdi--application-outline size-12 opacity-40" />
            <p class="mt-3 text-sm">{t("processes.empty") as string}</p>
          </div>
        </Show>

        <div class="space-y-4">
          <For each={grouped()}>
            {(group) => (
              <div class="rounded-lg border border-border/60">
                <div class="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-muted/40"
                    onClick={() => props.onOpenProject(group.projectId)}
                  >
                    <span class="iconify mdi--folder-outline size-4 text-muted-foreground" />
                    <span class="truncate text-sm font-medium">{group.projectName}</span>
                    <Badge variant="secondary" class="h-4 px-1.5 text-[9px]">
                      {group.processes.length}
                    </Badge>
                  </button>
                  <Button
                    variant={confirmState.projectId === group.projectId ? "destructive" : "ghost"}
                    size="sm"
                    class="h-7 shrink-0 text-xs"
                    onClick={() => handleKillAllClick(group.projectId)}
                  >
                    <span
                      class={
                        confirmState.projectId === group.projectId
                          ? "iconify mdi--alert-outline size-3.5 mr-1"
                          : "iconify mdi--close-octagon-outline size-3.5 mr-1"
                      }
                    />
                    {confirmState.projectId === group.projectId
                      ? (t("processes.killAllConfirm") as string)
                      : (t("processes.killAll") as string)}
                  </Button>
                </div>
                <div class="divide-y divide-border/40">
                  <For each={group.processes}>
                    {(proc) => (
                      <div class="flex items-center gap-3 px-3 py-2">
                        <span
                          class={
                            proc.kind === "ide"
                              ? "iconify mdi--code-braces size-4 shrink-0 text-muted-foreground"
                              : "iconify mdi--console-line size-4 shrink-0 text-muted-foreground"
                          }
                        />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium">
                              {proc.command ?? "—"}
                            </span>
                            <Badge
                              variant={proc.state === "running" ? "default" : "secondary"}
                              class="h-4 px-1.5 text-[9px] font-black uppercase tracking-wider"
                            >
                              {proc.state}
                            </Badge>
                          </div>
                          <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <Show when={proc.rootPid != null}>
                              <span class="font-mono">PID {proc.rootPid}</span>
                            </Show>
                            <Show when={proc.ports.length > 0}>
                              <span class="flex items-center gap-1">
                                <For each={proc.ports}>
                                  {(port) => (
                                    <Badge
                                      variant="outline"
                                      class="h-4 px-1 text-[9px] font-mono font-bold border-primary/30 text-primary/80"
                                    >
                                      :{port}
                                    </Badge>
                                  )}
                                </For>
                              </span>
                            </Show>
                          </div>
                        </div>

                        <Tooltip>
                          <TooltipTrigger
                            as={Button}
                            variant="ghost"
                            size="icon"
                            class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
                            onClick={() => void handleKill(proc)}
                          >
                            <span class="iconify mdi--close-octagon-outline size-4" />
                          </TooltipTrigger>
                          <TooltipContent>{t("processes.kill") as string}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
