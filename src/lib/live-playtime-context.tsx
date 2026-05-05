import { createQuery } from "@tanstack/solid-query";
import {
  type Accessor,
  type ParentComponent,
  createContext,
  createEffect,
  createMemo,
  onCleanup,
  useContext,
  createSignal,
} from "solid-js";
import { listAllActiveSessions } from "~/services/tauri";
import type { SessionDto } from "~/types/dto";

type LivePlaytimeContextValue = {
  getLivePlaytimeMs: (projectId: string, storedMs: number) => Accessor<number>;
  activeSessions: Accessor<SessionDto[]>;
};

const LivePlaytimeContext = createContext<LivePlaytimeContextValue>();

export const LivePlaytimeProvider: ParentComponent = (props) => {
  const activeSessionsQ = createQuery(() => ({
    queryKey: ["sessions", "all-active"],
    queryFn: async () => {
      const r = await listAllActiveSessions();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 10_000,
  }));

  const [nowMs, setNowMs] = createSignal(Date.now());

  createEffect(() => {
    const hasSessions = (activeSessionsQ.data?.length ?? 0) > 0;
    if (!hasSessions) {
      setNowMs(Date.now());
      return;
    }
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    onCleanup(() => clearInterval(id));
  });

  const activeSessions = createMemo(() => activeSessionsQ.data ?? []);

  const getLivePlaytimeMs = (projectId: string, storedMs: number): Accessor<number> => {
    return createMemo(() => {
      const now = nowMs();
      const sessions = activeSessions();
      let extra = 0;
      for (const s of sessions) {
        if (s.projectId === projectId) {
          extra += Math.max(0, now - s.startedAtMs);
        }
      }
      return storedMs + extra;
    });
  };

  return (
    <LivePlaytimeContext.Provider
      value={{
        getLivePlaytimeMs,
        activeSessions,
      }}
    >
      {props.children}
    </LivePlaytimeContext.Provider>
  );
};

export function useLivePlaytime(): LivePlaytimeContextValue {
  const ctx = useContext(LivePlaytimeContext);
  if (!ctx) {
    throw new Error("useLivePlaytime must be used within a LivePlaytimeProvider");
  }
  return ctx;
}
