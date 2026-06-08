import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { queryKeys } from "~/services/query-keys";
import { disableTunnel } from "~/services/tauri/tunnel";
import { listAllProcesses } from "~/services/tauri/sessions";
import type { SessionDto } from "~/types/dto";

export interface TerminalInstance {
  id: string;
  attachSessionId?: string;
  sessionId?: string;
}

export interface TunnelInfo {
  url: string;
  active: boolean;
}

export function useProjectEventListeners(props: {
  projectId: Accessor<string>;
  activeSessionsQ: { data?: SessionDto[] | null };
  terminalInstances: () => readonly TerminalInstance[];
  attachToTask: (sessionId: string, label: string, focus?: boolean) => void;
}) {
  const qc = useQueryClient();
  const [sessionPorts, setSessionPorts] = createSignal<Record<string, number[]>>({});
  const [sessionTunnels, setSessionTunnels] = createSignal<Record<string, TunnelInfo>>({});

  const refreshTaskQueries = () => {
    void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId()) });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
  };

  createEffect(() => {
    let unIde: (() => void) | undefined;
    let unTaskStarted: (() => void) | undefined;
    let unTaskState: (() => void) | undefined;
    let unTaskTree: (() => void) | undefined;
    let unSession: (() => void) | undefined;
    let unTaskPorts: (() => void) | undefined;
    let unTaskTunnels: (() => void) | undefined;
    let unTaskExited: (() => void) | undefined;

    void (async () => {
      unIde = await listen<{ projectId: string; running: boolean }>(
        "ide-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            void qc.setQueryData(
              ["projects", props.projectId(), "ide-running"],
              ev.payload.running,
            );
            void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
            void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId()) });
          }
        },
      );
      unTaskStarted = await listen<{ projectId: string; sessionId: string }>(
        "session:started",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            refreshTaskQueries();
          }
        },
      );
      unTaskState = await listen<{ projectId: string; sessionId: string; state: string }>(
        "task-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            refreshTaskQueries();
          }
        },
      );
      unTaskTree = await listen<{ projectId: string; sessionId: string }>(
        "task-tree-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            refreshTaskQueries();
          }
        },
      );
      unSession = await listen<{ projectId: string; sessionId: string }>(
        "session:ended",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            refreshTaskQueries();
          }
        },
      );
      unTaskPorts = await listen<{ sessionId: string; projectId: string; ports: number[] }>(
        "task-ports-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            setSessionPorts((prev) => ({
              ...prev,
              [ev.payload.sessionId]: ev.payload.ports,
            }));
          }
        },
      );
      unTaskTunnels = await listen<{
        sessionId: string;
        projectId: string;
        port: number;
        hostname?: string;
        url?: string;
        active: boolean;
      }>(
        "task-tunnel-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            setSessionTunnels((prev) => {
              const next = { ...prev };
              if (ev.payload.active && ev.payload.url) {
                next[ev.payload.sessionId] = { url: ev.payload.url, active: true };
              } else {
                delete next[ev.payload.sessionId];
              }
              return next;
            });
          }
        },
      );
      unTaskExited = await listen<{ sessionId: string; projectId: string }>(
        "task-exited",
        (ev) => {
          if (ev.payload.projectId === props.projectId()) {
            setSessionTunnels((prev) => {
              const next = { ...prev };
              if (next[ev.payload.sessionId]) {
                void disableTunnel(ev.payload.sessionId, ev.payload.projectId);
                delete next[ev.payload.sessionId];
              }
              return next;
            });
            setSessionPorts((prev) => {
              const next = { ...prev };
              delete next[ev.payload.sessionId];
              return next;
            });
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
      unTaskTunnels?.();
      unTaskExited?.();
    });
  });

  // Seed sessionPorts from listAllProcesses when active sessions change.
  // task-ports-changed events only fire on port changes, not as an initial snapshot,
  // so ports are lost when the model is recreated after navigation.
  createEffect(() => {
    const sessions = props.activeSessionsQ.data;
    if (!sessions || sessions.length === 0) return;
    const sessionIds = new Set(sessions.map((s) => s.id));
    void (async () => {
      const r = await listAllProcesses();
      if (r.isErr()) return;
      const ports: Record<string, number[]> = {};
      for (const proc of r.value) {
        if (sessionIds.has(proc.sessionId) && proc.ports.length > 0) {
          ports[proc.sessionId] = proc.ports;
        }
      }
      if (Object.keys(ports).length > 0) {
        setSessionPorts((prev) => ({ ...prev, ...ports }));
      }
    })();
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
      if (!alreadyAttached && !session.command?.startsWith("IDE: ")) {
        props.attachToTask(session.id, session.command ?? "Task", false);
      }
    }
  });

  return { sessionPorts, sessionTunnels };
}
