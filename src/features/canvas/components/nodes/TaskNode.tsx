import { For, Show, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import type { TaskDto } from "~/types/dto";
import { listActiveSessions } from "~/services/tauri/sessions";
import { spawnProjectTask, stopProjectTask } from "~/services/tauri/tasks";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";

export const TaskNode: Component<CanvasNodeComponentProps> = (props) => {
  const qc = useQueryClient();

  const sessionsQ = createQuery(() => ({
    queryKey: ["sessions", "active", props.project().id],
    queryFn: async () => {
      const res = await listActiveSessions(props.project().id);
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 2000,
  }));

  const activeSessions = () => sessionsQ.data ?? [];
  const isRunning = () => activeSessions().length > 0;

  const handleStartTask = async (task: TaskDto) => {
    await spawnProjectTask({
      projectId: props.project().id,
      argv: task.argv,
      acknowledgeRisk: true,
      cwd: task.cwd ?? undefined,
    });
    qc.invalidateQueries({ queryKey: ["sessions", "active", props.project().id] });
  };

  const handleStopSession = async (sessionId: string) => {
    await stopProjectTask(sessionId);
    qc.invalidateQueries({ queryKey: ["sessions", "active", props.project().id] });
  };

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--play-circle-outline"
      badge={isRunning() ? `${activeSessions().length} Running` : "Idle"}
      badgeVariant={isRunning() ? "nominal" : undefined}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable={false}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex flex-col gap-2.5">
        {/* Active Sessions */}
        <Show when={isRunning()}>
          <div class="flex flex-col gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2 text-xs">
            <span class="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
              Active Processes
            </span>
            <For each={activeSessions()}>
              {(session) => (
                <div class="flex items-center justify-between text-[11px]">
                  <div class="flex items-center gap-1.5 font-mono truncate max-w-[180px]">
                    <span class="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span class="truncate">{session.command ?? "Process"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStopSession(session.id)}
                    class="rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/20 transition-colors"
                  >
                    Stop
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Task presets */}
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Available Tasks
          </span>
          <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
            <For each={props.project().tasks.slice(0, 6)}>
              {(task) => (
                <button
                  type="button"
                  onClick={() => handleStartTask(task)}
                  class="flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium hover:bg-muted active:scale-95 transition-all"
                >
                  <span class="iconify mdi--play size-3 text-primary" />
                  <span class="truncate max-w-[100px]">{task.label}</span>
                </button>
              )}
            </For>
            <Show when={props.project().tasks.length === 0}>
              <span class="text-[11px] text-muted-foreground italic">No tasks detected</span>
            </Show>
          </div>
        </div>
      </div>
    </CanvasNodeContainer>
  );
};
