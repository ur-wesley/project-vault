import { createRoot, createSignal, type Accessor, type Setter } from "solid-js";
import type { EmbeddedTerminalInstance } from "../EmbeddedTerminal";

export type ProjectTerminalStore = {
  instances: Accessor<readonly EmbeddedTerminalInstance[]>;
  setInstances: Setter<EmbeddedTerminalInstance[]>;
  activeId: Accessor<string | null>;
  setActiveId: Setter<string | null>;
};

const stores = new Map<string, ProjectTerminalStore>();

export function getProjectTerminalStore(projectId: string): ProjectTerminalStore {
  if (!stores.has(projectId)) {
    createRoot(() => {
      const [instances, setInstances] = createSignal<EmbeddedTerminalInstance[]>([]);
      const [activeId, setActiveId] = createSignal<string | null>(null);
      stores.set(projectId, { instances, setInstances, activeId, setActiveId });
    });
  }
  return stores.get(projectId)!;
}
