import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "~/lib/utils";
import { fetchTabDecorations, getElementDecorations, decorationsVersion } from "~/lib/plugin-decorations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { toast } from "solid-sonner";
import { notify } from "~/lib/notification-center";
import { isLiveSessionState } from "~/lib/session-state";
import { deleteProjectTask } from "~/services/tauri/tasks";
import { enableTunnel, disableTunnel, getTunnelStatus } from "~/services/tauri/tunnel";
import type { ProjectDto, TaskDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { MiseToolsSuggestion } from "./MiseToolsSuggestion";

async function openUrl(url: string) {
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function TasksTabPanel(props: {
  project: () => ProjectDto;
  model: ProjectDetailModel;
}) {
  const { t } = useI18n();
  const m = () => props.model;

  const activeSessions = createMemo(() =>
    (m().activeSessionsQ.data ?? []).filter(
      (s) => !s.command?.startsWith("IDE: ") && isLiveSessionState(s.state),
    ),
  );
  const activeCount = createMemo(() => activeSessions().length);
  const [runningTaskKey, setRunningTaskKey] = createSignal<string | null>(null);
  const [taskEditorOpen, setTaskEditorOpen] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<TaskDto | null>(null);
  const [deletingTask, setDeletingTask] = createSignal<TaskDto | null>(null);
  const [deleteBusy, setDeleteBusy] = createSignal(false);
  const [tunnelRoutes, setTunnelRoutes] = createSignal<Record<string, string>>({});

  const loadTunnelStatus = async () => {
    const r = await getTunnelStatus();
    if (r.isOk()) {
      const routes: Record<string, string> = {};
      for (const route of r.value.routes) {
        routes[route.sessionId] = route.url;
      }
      setTunnelRoutes(routes);
    }
  };

  const handleToggleTunnel = async (sessionId: string, port: number, taskLabel?: string) => {
    const existingUrl = tunnelRoutes()[sessionId];
    if (existingUrl) {
      const r = await disableTunnel(sessionId, props.project().id);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      setTunnelRoutes((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      notify({
        severity: "success",
        title: "Tunnel disabled",
        source: "Tunnel",
        system: "auto",
      });
    } else {
      const projectName = props.project().path.split(/[\\/]/).pop() ?? "app";
      const label = taskLabel?.split(": ").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "-") ?? "dev";
      const subdomain = `${projectName}-${label}`;
      const r = await enableTunnel({
        sessionId,
        projectId: props.project().id,
        port,
        subdomain,
      });
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      setTunnelRoutes((prev) => ({ ...prev, [sessionId]: r.value }));
      notify({
        severity: "success",
        title: `Mapped to ${r.value}`,
        source: "Tunnel",
        system: "auto",
      });
    }
  };

  const normalizeCommand = (value: string) => value.replace(/\s+/g, " ").trim();

  const findTaskForSession = (command: string | null | undefined) => {
    if (!command) return null;
    const normalized = normalizeCommand(command);
    return props.project().tasks.find((t) => normalizeCommand(t.argv.join(" ")) === normalized) ?? null;
  };

  createEffect(() => {
    if (activeSessions().length > 0) {
      void loadTunnelStatus();
    }
  });

  createEffect(() => {
    decorationsVersion();
    const projectId = props.project().id;
    const taskLabels = props.project().tasks.map((t) => t.label);
    if (taskLabels.length > 0) {
      void fetchTabDecorations(projectId, "tasks", taskLabels);
    }
  });

  const decs = (label: string) => getElementDecorations(props.project().id, "tasks", label);

  const taskGroups = createMemo(() => {
    const g: Record<string, any[]> = {};
    for (const task of props.project().tasks) {
      const parts = task.label.split(": ");
      const groupName = parts.length > 1 ? parts[0]! : (t("projectDetail.taskGroupRoot") as string);
      const label = parts.length > 1 ? parts.slice(1).join(": ") : task.label;
      if (!g[groupName]) g[groupName] = [];
      g[groupName]!.push({ ...task, label, originalLabel: task.label });
    }
    return Object.entries(g);
  });

  return (
    <div class="space-y-6 pb-4">
      <div class="flex items-center justify-between">
        <Show when={activeCount() > 0}>
          <div class="flex items-center gap-2">
            <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
              {activeCount()}
            </Badge>
            <span class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {activeCount() === 1
                ? (t("projectDetail.taskRunningSingular") as string)
                : (t("projectDetail.taskRunningPlural") as string)}
            </span>
          </div>
        </Show>
        <div class="flex items-center gap-2">
          <Show when={m().miseSuggestionsDismissed() && (m().miseSuggestionsQ.data?.length ?? 0) > 0}>
            <Popover gutter={8}>
              <PopoverTrigger
                as={Button}
                type="button"
                variant="outline"
                size="sm"
                class="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
              >
                <span class="iconify mdi--tools size-3.5" />
                {t("projectDetail.misePinSelected") as string}
              </PopoverTrigger>
              <PopoverContent class="w-80 p-3">
                <MiseToolsSuggestion
                  suggestions={m().miseSuggestionsQ.data ?? []}
                  isLoading={m().miseSuggestionsQ.isLoading}
                  isPending={m().pinMiseToolsMu.isPending}
                  onPin={(tools) => m().pinMiseToolsMu.mutate(tools)}
                  onDismiss={m().dismissMiseSuggestions}
                />
              </PopoverContent>
            </Popover>
          </Show>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs"
            onClick={() => {
              setEditingTask(null);
              setTaskEditorOpen(true);
            }}
          >
            <span class="iconify mdi--plus size-3.5" />
            {t("projectDetail.newTask") as string}
          </Button>
        </div>
      </div>

      <Show when={props.project().tasks.length === 0}>
        <p class="text-sm text-muted-foreground">{t("projectDetail.noTasks") as string}</p>
      </Show>

      <Show when={activeSessions().length > 0}>
        <div class="rounded-lg border border-border/60 bg-card/80 p-3 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("projectDetail.taskOutputTitle") as string}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                {t("projectDetail.taskOutputHint") as string}
              </p>
            </div>
            <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
              {activeSessions().length}
            </Badge>
          </div>
          <div class="mt-3 space-y-2">
            <For each={activeSessions()}>
              {(session) => (
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge
                        variant={session.state === "running" || session.state === "starting" ? "default" : "secondary"}
                        round
                        class="h-5 px-2 text-[10px] font-black uppercase tracking-wider"
                      >
                        {session.state}
                      </Badge>
                      <span class="min-w-0 truncate font-mono text-xs text-foreground/90">
                        {session.command ?? "—"}
                      </span>
                    </div>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {session.rootPid != null
                        ? `PID ${session.rootPid}`
                        : (t("projectDetail.taskOutputHint") as string)}
                    </p>
                    <Show when={m().sessionPorts()[session.id]?.length > 0}>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <span class="text-[10px] text-muted-foreground/70">{t("projectDetail.ports") as string}:</span>
                        <For each={m().sessionPorts()[session.id]}>
                          {(port) => (
                            <Badge variant="outline" round class="h-4 px-1.5 text-[9px] font-mono font-bold border-primary/30 text-primary/80">
                              :{port}
                            </Badge>
                          )}
                        </For>
                        <button
                          type="button"
                          class={`inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition-colors ${
                            tunnelRoutes()[session.id]
                              ? 'border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/20'
                              : 'border-border bg-muted/50 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary'
                          }`}
                          onClick={() => {
                            const task = findTaskForSession(session.command);
                            void handleToggleTunnel(session.id, m().sessionPorts()[session.id]![0], task?.label);
                          }}
                        >
                          {tunnelRoutes()[session.id]
                            ? (t("projectDetail.tunnelActive") as string)
                            : (t("projectDetail.tunnelEnable") as string)}
                        </button>
                        <Show when={tunnelRoutes()[session.id]}>
                          <button
                            type="button"
                            class="text-[9px] font-mono text-green-600 hover:underline cursor-pointer"
                            onClick={() => void openUrl(tunnelRoutes()[session.id]!)}
                          >
                            {tunnelRoutes()[session.id]}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger as={Button}
                        type="button"
                        size="icon"
                        variant="ghost"
                        class="size-7 text-muted-foreground hover:text-foreground hover:bg-background/50"
                        onClick={() => m().attachToTask(session.id, session.command ?? (t("projectDetail.tabTerminal") as string))}
                      >
                        <span class="iconify mdi--terminal size-4" />
                      </TooltipTrigger>
                      <TooltipContent>{t("projectDetail.taskViewOutput") as string}</TooltipContent>
                    </Tooltip>
                    <Show when={findTaskForSession(session.command)}>
                      {(task) => (
                        <Tooltip>
                          <TooltipTrigger as={Button}
                            type="button"
                            size="icon"
                            variant="ghost"
                            class="size-7 text-muted-foreground hover:text-orange-500 hover:bg-orange-500/5"
                            onClick={() => void m().restartArgv(props.project(), task().argv, task().cwd, task().concurrent, session.id)}
                          >
                            <span class="iconify mdi--refresh size-4" />
                          </TooltipTrigger>
                          <TooltipContent>{t("projectDetail.taskRestart") as string}</TooltipContent>
                        </Tooltip>
                      )}
                    </Show>
                    <Tooltip>
                      <TooltipTrigger as={Button}
                        type="button"
                        size="icon"
                        variant="ghost"
                        class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                        onClick={() => void m().onStopTask(session.id)}
                      >
                        <span class="iconify mdi--stop size-4" />
                      </TooltipTrigger>
                      <TooltipContent>{t("projectDetail.taskStop") as string}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <For each={taskGroups()}>
        {([name, tasks]) => {
          return (
            <div class="space-y-2.5">
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {name}
                </span>
                <div class="h-px flex-1 bg-border/40" />
              </div>
              <div class="flex flex-wrap gap-2">
                <For each={tasks}>
                  {(task) => {
                    const taskKey = `${name}::${task.label}::${task.argv.join("\u0000")}`;
                    const busy = () => runningTaskKey() === taskKey;

                    const handleRun = async () => {
                      setRunningTaskKey(taskKey);
                      try {
                        await m().runArgv(props.project(), task.argv, false, task.cwd, task.concurrent);
                      } finally {
                        setRunningTaskKey((current) => (current === taskKey ? null : current));
                      }
                    };
                    return (
                      <div class="flex items-center gap-1 rounded-md border border-border/40 bg-muted/10 p-1 transition-colors hover:bg-muted/20">
                        {/* Before Task Decorations */}
                        <For each={decs(task.originalLabel).before}>
                          {(dec) => (
                            <Tooltip>
                              <TooltipTrigger>
                                <span 
                                  class={cn("iconify size-3.5 shrink-0 cursor-pointer mx-0.5", dec.icon)} 
                                  style={{ color: dec.color }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (dec.command) {
                                      void invoke("execute_plugin_command", {
                                        pluginId: dec.pluginId,
                                        commandId: dec.command,
                                        context: { projectId: props.project().id, elementId: task.originalLabel }
                                      });
                                    }
                                  }}
                                />
                              </TooltipTrigger>
                              <Show when={dec.tooltip}>
                                <TooltipContent>{dec.tooltip}</TooltipContent>
                              </Show>
                            </Tooltip>
                          )}
                        </For>

                        <Button
                          type="button"
                          size="sm"
                          variant={name === (t("projectDetail.taskGroupRoot") as string) ? "default" : "secondary"}
                          class="h-7 gap-1.5 px-3 transition-all"
                          disabled={busy()}
                          onClick={handleRun}
                        >
                          <Show when={busy()} fallback={<span class="iconify mdi--play size-3.5 opacity-50" />}>
                            <span class="iconify mdi--loading animate-spin size-3.5" />
                          </Show>
                          <span class="font-bold tracking-tight">{task.label}</span>
                        </Button>

                        <Show when={task.kind === "mise" || task.kind === "justfile"}>
                          <Badge variant="outline" round class="h-5 px-1.5 text-[9px] font-black uppercase tracking-wider border-primary/30 text-primary/70">
                            {task.kind === "mise" ? "mise" : "just"}
                          </Badge>
                        </Show>

                        <Show when={task.concurrent && task.concurrent.length > 0}>
                          <Badge variant="outline" round class="h-5 px-1.5 text-[9px] font-black uppercase tracking-wider border-orange-400/30 text-orange-500/80">
                            concurrent
                          </Badge>
                        </Show>

                        {/* After Task Decorations */}
                        <For each={decs(task.originalLabel).after}>
                          {(dec) => (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge 
                                  class={cn("h-4 px-1 text-[8px] font-bold cursor-pointer ml-1", dec.color?.startsWith("bg-") ? dec.color : "bg-primary/10 text-primary border-primary/20")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (dec.command) {
                                      void invoke("execute_plugin_command", {
                                        pluginId: dec.pluginId,
                                        commandId: dec.command,
                                        context: { projectId: props.project().id, elementId: task.originalLabel }
                                      });
                                    }
                                  }}
                                >
                                  <Show when={dec.icon}>
                                    <span class={cn("iconify mr-0.5 size-2.5", dec.icon)} />
                                  </Show>
                                  {dec.label}
                                </Badge>
                              </TooltipTrigger>
                              <Show when={dec.tooltip}>
                                <TooltipContent>{dec.tooltip}</TooltipContent>
                              </Show>
                            </Tooltip>
                          )}
                        </For>

                        <Show when={task.kind === "mise" || task.kind === "justfile"}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="size-6 text-muted-foreground hover:text-foreground hover:bg-background/50"
                              >
                                <span class="iconify mdi--dots-vertical size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent class="w-40">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditingTask(task as TaskDto);
                                  setTaskEditorOpen(true);
                                }}
                                class="gap-2 text-xs"
                              >
                                <span class="iconify mdi--pencil size-3.5" />
                                {t("projectDetail.editTask") as string}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setDeletingTask(task as TaskDto)}
                                class="gap-2 text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <span class="iconify mdi--delete-outline size-3.5" />
                                {t("projectDetail.deleteTask") as string}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>

      <TaskEditorDialog
        open={taskEditorOpen()}
        onOpenChange={setTaskEditorOpen}
        projectId={props.project().id}
        projectPath={props.project().path}
        existingTask={editingTask()}
        availableKinds={["mise", "justfile"]}
        onSaved={(tasks) => {
          m().syncProjectTasks(tasks);
        }}
      />

      <AlertDialog open={deletingTask() != null} onOpenChange={(open) => !open && setDeletingTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projectDetail.deleteTask") as string}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectDetail.deleteTaskConfirm") as string}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingTask(null)}>
              {t("common.cancel") as string}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const task = deletingTask();
                if (!task) return;
                setDeleteBusy(true);
                try {
                  const r = await deleteProjectTask(props.project().id, task);
                  if (r.isErr()) {
                    toast.error(r.error.message);
                    return;
                  }
                  notify({
                    severity: "success",
                    title: t("projectDetail.taskEditor.deleted") as string,
                    source: "Tasks",
                    system: "auto",
                  });
                  m().syncProjectTasks(r.value);
                } finally {
                  setDeleteBusy(false);
                  setDeletingTask(null);
                }
              }}
              disabled={deleteBusy()}
              class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy() && <span class="iconify mdi--loading animate-spin mr-1.5 size-4" />}
              {t("projectDetail.deleteTask") as string}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
