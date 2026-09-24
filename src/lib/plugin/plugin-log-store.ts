import { createRoot, createSignal } from "solid-js";

export type PluginLog = {
  pluginId: string;
  level: "info" | "error";
  message: string;
  timestamp: string;
  /** Unix millis when provided by the backend; used for hydrate dedup. */
  timestampMs?: number;
};

export type PluginLogPayload = Pick<PluginLog, "pluginId" | "level" | "message"> & {
  /** Backend-provided unix millis (`get_plugin_logs` / live events). */
  timestampMs?: number;
};

/** Backend shape (`PluginLogEntry`, camelCase) returned by `get_plugin_logs`. */
export type BackendPluginLog = {
  pluginId: string;
  level: "info" | "error";
  message: string;
  timestampMs: number;
};

const MAX_LOGS = 300;

function toTimestamp(timestampMs?: number): string {
  if (typeof timestampMs === "number" && Number.isFinite(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs).toLocaleTimeString();
  }
  return new Date().toLocaleTimeString();
}

function logKey(log: Pick<PluginLog, "pluginId" | "level" | "message">, timestampMs?: number) {
  return [log.pluginId, log.level, String(timestampMs ?? ""), log.message].join("|");
}

function createStore() {
  const [logs, setLogs] = createSignal<PluginLog[]>([]);

  function append(payload: PluginLogPayload) {
    const timestamp = toTimestamp(payload.timestampMs);
    setLogs((prev) =>
      [...prev, { ...payload, timestamp, timestampMs: payload.timestampMs }].slice(-MAX_LOGS),
    );
  }

  /**
   * Merge a backend snapshot (e.g. from `get_plugin_logs`) in front of the
   * entries already collected via live events. Entries already present
   * (same plugin/level/timestamp/message) are skipped so no duplicates
   * appear when hydration races with live events.
   */
  function hydrate(entries: BackendPluginLog[]) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    setLogs((prev) => {
      const seen = new Set(prev.map((l) => logKey(l, l.timestampMs)));
      const missing: PluginLog[] = [];
      for (const e of entries) {
        if (typeof e?.message !== "string" || typeof e?.pluginId !== "string") continue;
        const level = e.level === "error" ? "error" : "info";
        const key = logKey({ pluginId: e.pluginId, level, message: e.message }, e.timestampMs);
        if (seen.has(key)) continue;
        seen.add(key);
        missing.push({
          pluginId: e.pluginId,
          level,
          message: e.message,
          timestamp: toTimestamp(e.timestampMs),
          timestampMs: e.timestampMs,
        });
      }
      if (missing.length === 0) return prev;
      return [...missing, ...prev].slice(-MAX_LOGS);
    });
  }

  function clear() {
    setLogs([]);
  }

  return { logs, append, hydrate, clear };
}

export type PluginLogStore = ReturnType<typeof createStore>;

let store: PluginLogStore | null = null;

export function getPluginLogStore(): PluginLogStore {
  if (!store) {
    createRoot(() => {
      store = createStore();
    });
  }
  return store!;
}
