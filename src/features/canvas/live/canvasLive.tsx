import { createContext, useContext, type Component, type ParentProps } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import type { SessionDto } from "~/types/dto";
import {
  listAllProcesses,
  listSessionsForProject,
  type ProcessDto,
} from "~/services/tauri/sessions";

interface CanvasLiveApi {
  /** All processes, polled every 3s (port detection for previews). */
  processes: () => ProcessDto[];
  /** Recent dev sessions for the viewed project, polled every 8s. */
  sessions: () => SessionDto[];
}

const CanvasLiveContext = createContext<CanvasLiveApi | null>(null);

/**
 * Single shared polling scope for canvas liveness data. Previously every
 * webPreview node mounted its own `["processes","list"]` observer (3s) and
 * every webTools node its own copy (5s) plus a sessions observer (8s) — N
 * nodes meant N staggered timers and N IPC fetches per interval for the same
 * data. One provider per CanvasView collapses that to exactly one fetch per
 * interval no matter how many nodes are on the canvas.
 */
export const CanvasLiveProvider: Component<ParentProps<{ projectId: string }>> = (props) => {
  const processesQ = createQuery(() => ({
    queryKey: ["processes", "list"],
    queryFn: async () => {
      const res = await listAllProcesses();
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 3000,
  }));

  const sessionsQ = createQuery(() => ({
    queryKey: ["webtools", "sessions", props.projectId],
    queryFn: async () => {
      const res = await listSessionsForProject(props.projectId, 5, 0);
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 8000,
    enabled: !!props.projectId,
  }));

  const api: CanvasLiveApi = {
    processes: () => processesQ.data ?? [],
    sessions: () => sessionsQ.data ?? [],
  };

  return <CanvasLiveContext.Provider value={api}>{props.children}</CanvasLiveContext.Provider>;
};

/** Shared liveness data, or null when rendered outside a CanvasLiveProvider. */
export function useCanvasLive(): CanvasLiveApi | null {
  return useContext(CanvasLiveContext);
}
