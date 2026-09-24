import { createEffect } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import type { CanvasNodeDto, CanvasWireDto, ProjectDto, SessionDto, TaskDto } from "~/types/dto";
import { listSessionsForProject } from "~/services/tauri/sessions";
import { spawnProjectTask } from "~/services/tauri/tasks";
import { appendNoteLine, parseTaskStepData, planStepCompletion } from "../state/pipeline";
import type { WirePatch } from "../state/manualWires";

interface PipelineRuntimeOpts {
  project: () => ProjectDto;
  nodes: () => CanvasNodeDto[];
  wires: () => CanvasWireDto[];
  onNodeDataChange: (id: string, dataJson: string | null) => void;
  onUpdateWire: (id: string, patch: Partial<WirePatch>) => boolean;
}

const HISTORY_LIMIT = 30;
const POLL_MS = 2500;

/**
 * Executes `taskStep` data wires. Each step records the session it spawned
 * in its dataJson; this hook polls recent sessions, detects completions, and
 * fans out exactly once per run:
 *
 * - exit 0 → `done` edges: auto steps spawn, notes/zettel append a ✓ line
 * - exit != 0 → `failed` edges likewise (✗ line)
 * - manual steps never auto-fire (pause gate); edge wire status records the
 *   last result (nominal / red).
 */
export function usePipelineRuntime(opts: PipelineRuntimeOpts): void {
  const qc = useQueryClient();
  // In-memory fire-once guard for the await gap (persisted
  // lastFiredSessionId covers remounts/reloads).
  const firing = new Set<string>();
  const fireKey = (nodeId: string, sessionId: string) => `${nodeId}::${sessionId}`;

  const tracked = () =>
    opts.nodes().filter((n) => {
      if (n.nodeType !== "taskStep") return false;
      const d = parseTaskStepData(n.dataJson);
      return !!d.runSessionId && d.lastFiredSessionId !== d.runSessionId;
    });

  const sessionsQ = createQuery(() => ({
    queryKey: ["pipeline", "sessions", opts.project().id],
    queryFn: async () => {
      const res = await listSessionsForProject(opts.project().id, HISTORY_LIMIT, 0);
      return res.isOk() ? res.value : [];
    },
    refetchInterval: POLL_MS,
    enabled: !!opts.project().id && tracked().length > 0,
  }));

  const byId = (sessions: SessionDto[]) => {
    const m = new Map<string, SessionDto>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  };

  createEffect(() => {
    const sessions = sessionsQ.data;
    if (!sessions || sessions.length === 0) return;
    const lookup = byId(sessions);
    const nodes = opts.nodes();
    const wires = opts.wires();
    const tasks = opts.project().tasks;

    for (const node of tracked()) {
      const data = parseTaskStepData(node.dataJson);
      const sessionId = data.runSessionId;
      if (!sessionId || firing.has(fireKey(node.id, sessionId))) continue;
      const session = lookup.get(sessionId);
      // Not in the recent window (yet, or rotated out) — wait / skip.
      if (!session || session.endedAtMs == null) continue;

      firing.add(fireKey(node.id, sessionId));
      void fireCompletion(node, session, nodes, wires, tasks);
    }
  });

  async function fireCompletion(
    node: CanvasNodeDto,
    session: SessionDto,
    nodes: readonly CanvasNodeDto[],
    wires: readonly CanvasWireDto[],
    tasks: readonly TaskDto[],
  ): Promise<void> {
    const data = parseTaskStepData(node.dataJson);
    const exitCode = session.exitCode ?? 1;
    const label =
      tasks.find((t) => t.id === data.taskId)?.label ??
      tasks.find((t) => t.label === data.taskId)?.label ??
      node.title;

    // Mark fired first so a concurrent poll can't double-fire.
    opts.onNodeDataChange(
      node.id,
      JSON.stringify({ ...data, lastExit: exitCode, lastFiredSessionId: data.runSessionId }),
    );

    const actions = planStepCompletion({
      sourceNode: node,
      sourceLabel: label,
      exitCode,
      wires,
      nodes,
      tasks,
      atMs: session.endedAtMs ?? Date.now(),
    });

    for (const action of actions) {
      opts.onUpdateWire(action.wireId, { status: exitCode === 0 ? "nominal" : "red" });
      if (action.kind === "append-note") {
        const target = nodes.find((n) => n.id === action.targetNodeId);
        if (target && action.line) {
          opts.onNodeDataChange(target.id, appendNoteLine(target.dataJson, action.line));
        }
      } else if (action.kind === "spawn-step" && action.task) {
        const target = nodes.find((n) => n.id === action.targetNodeId);
        if (!target) continue;
        const res = await spawnProjectTask({
          projectId: opts.project().id,
          argv: action.task.argv,
          acknowledgeRisk: true,
          cwd: action.task.cwd ?? undefined,
        });
        if (res.isErr()) {
          toast.error(`Pipeline couldn't start "${action.task.label}".`);
          continue;
        }
        const targetData = parseTaskStepData(target.dataJson);
        opts.onNodeDataChange(
          target.id,
          JSON.stringify({ ...targetData, runSessionId: res.value.sessionId, lastExit: null }),
        );
        opts.onUpdateWire(action.wireId, { status: "amber" });
      }
    }

    qc.invalidateQueries({ queryKey: ["sessions", "active", opts.project().id] });
    qc.invalidateQueries({ queryKey: ["pipeline", "sessions", opts.project().id] });
  }
}
