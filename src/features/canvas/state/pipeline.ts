import type { CanvasNodeDto, CanvasWireDto, TaskDto } from "~/types/dto";
import { parseNodeData } from "../nodes/base/parseNodeData";

/**
 * Chainable single-task pipeline step.
 *
 * A `taskStep` node binds to exactly one project task (by id, with a label
 * fallback for renamed/regenerated task lists) so steps can be lined up
 * `build -> test -> lint` with data wires:
 *
 *   done (exit 0) / failed (exit != 0)  -->  trigger | markdown sinks
 *
 * `trigger` is intentionally optional: an unconnected step is a manual
 * start-of-chain head (Run button). Connected steps with mode "auto" fire
 * when their upstream completes; "manual" steps ignore triggers (pause gate).
 */
export interface TaskStepData {
  taskId: string | null;
  mode: "auto" | "manual";
  /** Session spawned by this step's last run (tracks completion). */
  runSessionId?: string | null;
  /** Exit code of the last completed run. */
  lastExit?: number | null;
  /** runSessionId already propagated downstream (survives remounts). */
  lastFiredSessionId?: string | null;
}

export const TASK_STEP_FALLBACK: TaskStepData = { taskId: null, mode: "auto" };

const MAX_NOTE_CHARS = 8000;

export function parseTaskStepData(raw: string | null | undefined): TaskStepData {
  const parsed = parseNodeData<TaskStepData>(raw, TASK_STEP_FALLBACK);
  return {
    taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
    mode: parsed.mode === "manual" ? "manual" : "auto",
    runSessionId: typeof parsed.runSessionId === "string" ? parsed.runSessionId : null,
    lastExit: typeof parsed.lastExit === "number" ? parsed.lastExit : null,
    lastFiredSessionId:
      typeof parsed.lastFiredSessionId === "string" ? parsed.lastFiredSessionId : null,
  };
}

/** Match the step's task: stable id first, label fallback for stale lists. */
export function resolveStepTask(tasks: readonly TaskDto[], data: TaskStepData): TaskDto | null {
  if (!data.taskId) return null;
  return (
    tasks.find((t) => t.id === data.taskId) ?? tasks.find((t) => t.label === data.taskId) ?? null
  );
}

/** Data wires leaving a step's port (done/failed). Outputs fan out. */
export function downstreamDataEdges(
  nodeId: string,
  sourcePort: "done" | "failed",
  wires: readonly CanvasWireDto[],
): CanvasWireDto[] {
  return wires.filter(
    (w) => w.kind === "data" && w.sourceId === nodeId && w.sourcePort === sourcePort,
  );
}

export type FireTargetKind = "spawn-step" | "append-note";

export interface FireAction {
  wireId: string;
  targetNodeId: string;
  kind: FireTargetKind;
  /** Resolved task for spawn-step targets. */
  task?: TaskDto;
  /** Pre-formatted result line for append-note targets. */
  line?: string;
}

export function formatTaskResultLine(label: string, exitCode: number, atMs: number): string {
  const mark = exitCode === 0 ? "✓" : "✗";
  return `- [${mark}] ${label} — exit ${exitCode} (${new Date(atMs).toLocaleString()})`;
}

/**
 * Pure fan-out planner: given a completed step run, decide what each
 * downstream data edge should do. No side effects — the runtime hook
 * executes the returned actions.
 */
export function planStepCompletion(args: {
  sourceNode: CanvasNodeDto;
  sourceLabel: string;
  exitCode: number;
  wires: readonly CanvasWireDto[];
  nodes: readonly CanvasNodeDto[];
  tasks: readonly TaskDto[];
  atMs: number;
}): FireAction[] {
  const { sourceNode, sourceLabel, exitCode, wires, nodes, tasks, atMs } = args;
  const port = exitCode === 0 ? "done" : "failed";
  const actions: FireAction[] = [];
  for (const edge of downstreamDataEdges(sourceNode.id, port, wires)) {
    const target = nodes.find((n) => n.id === edge.targetId);
    if (!target) continue;
    if (target.nodeType === "taskStep" && edge.targetPort === "trigger") {
      const data = parseTaskStepData(target.dataJson);
      if (data.mode !== "auto") continue; // manual = pause gate
      const task = resolveStepTask(tasks, data);
      if (!task) continue; // unconfigured step: skip, don't stall the chain
      actions.push({ wireId: edge.id, targetNodeId: target.id, kind: "spawn-step", task });
    } else if (
      (target.nodeType === "notes" || target.nodeType === "zettel") &&
      (edge.targetPort === "text" || edge.targetPort === "markdown")
    ) {
      actions.push({
        wireId: edge.id,
        targetNodeId: target.id,
        kind: "append-note",
        line: formatTaskResultLine(sourceLabel, exitCode, atMs),
      });
    }
  }
  return actions;
}

/** Append a result line to a notes/zettel payload, keeping the tail. */
export function appendNoteLine(existing: string | null | undefined, line: string): string {
  const base = (existing ?? "").trimEnd();
  const next = base.length > 0 ? `${base}\n${line}` : line;
  return next.length > MAX_NOTE_CHARS ? next.slice(next.length - MAX_NOTE_CHARS) : next;
}
