import { createRoot, createSignal } from "solid-js";

export type PluginLog = {
  pluginId: string;
  level: "info" | "error";
  message: string;
  timestamp: string;
};

export type PluginLogPayload = Pick<PluginLog, "pluginId" | "level" | "message">;

const MAX_LOGS = 300;

function createStore() {
  const [logs, setLogs] = createSignal<PluginLog[]>([]);

  function append(payload: PluginLogPayload) {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { ...payload, timestamp }].slice(-MAX_LOGS));
  }

  function clear() {
    setLogs([]);
  }

  return { logs, append, clear };
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
