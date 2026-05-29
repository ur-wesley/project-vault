import { createRoot, createEffect, createSignal } from "solid-js";

export type GlobalTerminalInstance = {
  id: string;
  name: string;
  shell?: string;
  icon?: string;
  sessionId?: string;
  attachSessionId?: string;
};

type PersistedState = {
  instances: GlobalTerminalInstance[];
  activeId: string | null;
  height?: number;
};

const STORAGE_KEY = "project-vault:global-terminal";

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.instances)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedState(instances: readonly GlobalTerminalInstance[], activeId: string | null, height: number) {
  try {
    const state: PersistedState = {
      instances: instances.map((inst) => ({
        id: inst.id,
        name: inst.name,
        shell: inst.shell,
        icon: inst.icon,
        sessionId: inst.sessionId,
        attachSessionId: inst.attachSessionId,
      })),
      activeId,
      height,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function createStore() {
  const persisted = loadPersistedState();
  const [instances, setInstances] = createSignal<GlobalTerminalInstance[]>(
    persisted?.instances ?? [],
  );
  const [activeId, setActiveId] = createSignal<string | null>(persisted?.activeId ?? null);
  const [height, setHeight] = createSignal<number>(persisted?.height ?? 300);
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    savePersistedState(instances(), activeId(), height());
  });

  return { instances, setInstances, activeId, setActiveId, height, setHeight, open, setOpen };
}

export type GlobalTerminalStore = ReturnType<typeof createStore>;

let store: GlobalTerminalStore | null = null;

export function getGlobalTerminalStore(): GlobalTerminalStore {
  if (!store) {
    createRoot(() => {
      store = createStore();
    });
  }
  return store!;
}
