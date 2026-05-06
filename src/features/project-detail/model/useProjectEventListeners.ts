import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { queryKeys } from "~/services/query-keys";
import type { SessionDto } from "~/types/dto";

export interface TerminalInstance {
  id: string;
  attachSessionId?: string;
  sessionId?: string;
}

export function useProjectEventListeners(props: {
  projectId: string;
  activeSessionsQ: { data?: SessionDto[] | null };
  terminalInstances: () => TerminalInstance[];
  attachToTask: (sessionId: string, label: string, focus?: boolean) => void;
}) {
  const qc = useQueryClient();
  const [sessionPorts, setSessionPorts] = createSignal<Record<string, number[]>>({});

  const refreshTaskQueries = () => {
    void qc.invalidateQueries({ queryKey: ["projects", props.projectId, "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

  createEffect(() => {
    let unIde: (() => void) | undefined;
    let unTaskStarted: (() => void) | undefined;
    let unTaskState: (() => void) | undefined;
    let unTaskTree: (() => void) | undefined;
    let unSession: (() => void) | undefined;
    let unTaskPorts: (() => void) | undefined;

    void (async () => {
      unIde = await listen<{ projectId: string; running: boolean }>(
        "ide-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            void qc.setQueryData(
              ["projects", props.projectId, "ide-running"],
              ev.payload.running,
            );
            void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
            void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
          }
        },
      );
      unTaskStarted = await listen<{ projectId: string; sessionId: string }>(
        "session:started",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskState = await listen<{ projectId: string; sessionId: string; state: string }>(
        "task-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskTree = await listen<{ projectId: string; sessionId: string }>(
        "task-tree-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unSession = await listen<{ projectId: string; sessionId: string }>(
        "session:ended",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskPorts = await listen<{ sessionId: string; projectId: string; ports: number[] }>(
        "task-ports-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            setSessionPorts((prev) => ({
              ...prev,
              [ev.payload.sessionId]: ev.payload.ports,
            }));
          }
        },
      );
    })();

    onCleanup(() => {
      unIde?.();
      unTaskStarted?.();
      unTaskState?.();
      unTaskTree?.();
      unSession?.();
      unTaskPorts?.();
    });
  });

  // Auto-attach active sessions to terminal tabs whenever the query updates
  createEffect(() => {
    const sessions = props.activeSessionsQ.data;
    if (!sessions) return;
    const instances = untrack(props.terminalInstances);
    for (const session of sessions) {
      const alreadyAttached = instances.some(
        (inst) => inst.attachSessionId === session.id || inst.sessionId === session.id,
      );
      if (!alreadyAttached) {
        props.attachToTask(session.id, session.command ?? "Task", false);
      }
    }
  });

  return { sessionPorts };
}
