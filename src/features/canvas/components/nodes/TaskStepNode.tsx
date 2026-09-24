import { For, Show, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import type { TaskDto } from "~/types/dto";
import { listActiveSessions } from "~/services/tauri/sessions";
import { spawnProjectTask, stopProjectTask } from "~/services/tauri/tasks";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";
import { useNodeData } from "../../nodes/base/useNodeData";
import {
  TASK_STEP_FALLBACK,
  parseTaskStepData,
  resolveStepTask,
  type TaskStepData,
} from "../../state/pipeline";

async function spawnStepTask(projectId: string, task: TaskDto): Promise<string | null> {
  const res = await spawnProjectTask({
    projectId,
    argv: task.argv,
    acknowledgeRisk: true,
    cwd: task.cwd ?? undefined,
  });
  if (res.isErr()) {
    toast.error(`Couldn't start "${task.label}".`);
    return null;
  }
  return res.value.sessionId;
}

export const TaskStepNode: Component<CanvasNodeComponentProps> = (props) => {
  const qc = useQueryClient();
  const { data, set } = useNodeData<TaskStepData>(
    () => props.node,
    TASK_STEP_FALLBACK,
    props.onDataChange,
  );

  const tasks = () => props.project().tasks;
  const selected = () => resolveStepTask(tasks(), parseTaskStepData(props.node.dataJson));

  const sessionsQ = createQuery(() => ({
    queryKey: ["sessions", "active", props.project().id],
    queryFn: async () => {
      const res = await listActiveSessions(props.project().id);
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 2000,
  }));

  const runSessionId = () => data().runSessionId ?? null;
  const isRunning = () => {
    const sid = runSessionId();
    return !!sid && (sessionsQ.data ?? []).some((s) => s.id === sid);
  };
  const lastExit = () => data().lastExit ?? null;

  const badge = () => {
    if (isRunning()) return "Running";
    if (lastExit() !== null) return lastExit() === 0 ? "✓ exit 0" : `✗ exit ${lastExit()}`;
    return selected() ? "Idle" : "Pick task";
  };
  const badgeVariant = () => {
    if (isRunning()) return "amber" as const;
    if (lastExit() !== null) return lastExit() === 0 ? ("nominal" as const) : ("red" as const);
    return undefined;
  };

  const handlePick = (taskId: string) => {
    const current = data();
    set({
      ...current,
      taskId: taskId || null,
      // A new binding invalidates the previous run's status.
      runSessionId: null,
      lastExit: null,
    });
    const task = tasks().find((t) => t.id === taskId);
    if (task && props.node.title === "Task Step") {
      props.onTitleChange?.(props.node.id, task.label);
    }
  };

  const handleToggleMode = () => {
    const current = data();
    set({ ...current, mode: current.mode === "auto" ? "manual" : "auto" });
  };

  const handleRun = async () => {
    const task = selected();
    if (!task || isRunning()) return;
    const sessionId = await spawnStepTask(props.project().id, task);
    if (!sessionId) return;
    set({ ...data(), runSessionId: sessionId, lastExit: null });
    qc.invalidateQueries({ queryKey: ["sessions", "active", props.project().id] });
  };

  const handleStop = async () => {
    const sid = runSessionId();
    if (!sid) return;
    await stopProjectTask(sid);
    qc.invalidateQueries({ queryKey: ["sessions", "active", props.project().id] });
  };

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--play-box-outline"
      badge={badge()}
      badgeVariant={badgeVariant()}
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
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Task
          <select
            class="rounded border border-border/60 bg-muted/40 px-1.5 py-1 text-[11px] font-medium normal-case tracking-normal text-foreground"
            value={data().taskId ?? ""}
            onChange={(e) => handlePick(e.currentTarget.value)}
          >
            <option value="">Pick a task…</option>
            <For each={tasks()}>{(t) => <option value={t.id}>{t.label}</option>}</For>
          </select>
        </label>

        <Show when={selected()}>
          {(task) => (
            <div
              class="truncate font-mono text-[10px] text-muted-foreground"
              title={task().argv.join(" ")}
            >
              {task().argv.join(" ")}
            </div>
          )}
        </Show>

        <div class="flex items-center gap-1.5">
          <Show
            when={!isRunning()}
            fallback={
              <button
                type="button"
                onClick={() => void handleStop()}
                class="flex flex-1 items-center justify-center gap-1 rounded border border-destructive/40 bg-destructive/15 py-1 text-[11px] font-medium text-destructive transition-all hover:bg-destructive/25 active:scale-95"
              >
                <span class="iconify mdi--stop size-3.5" />
                Stop
              </button>
            }
          >
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={!selected()}
              class="flex flex-1 items-center justify-center gap-1 rounded border border-primary/40 bg-primary/15 py-1 text-[11px] font-medium text-primary transition-all hover:bg-primary/25 active:scale-95 disabled:opacity-40"
            >
              <span class="iconify mdi--play size-3.5" />
              Run
            </button>
          </Show>
          <button
            type="button"
            onClick={handleToggleMode}
            title={
              data().mode === "auto"
                ? "Auto: fires when an upstream step completes"
                : "Manual: ignores upstream triggers (pause gate)"
            }
            class="flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium transition-all hover:bg-muted active:scale-95"
            classList={{ "text-primary": data().mode === "auto" }}
          >
            <span
              class="iconify size-3.5"
              classList={{
                "mdi--lightning-bolt": data().mode === "auto",
                "mdi--pause": data().mode !== "auto",
              }}
            />
            {data().mode === "auto" ? "Auto" : "Manual"}
          </button>
        </div>

        <Show when={tasks().length === 0}>
          <span class="text-[11px] italic text-muted-foreground">No tasks detected</span>
        </Show>
      </div>
    </CanvasNodeContainer>
  );
};
