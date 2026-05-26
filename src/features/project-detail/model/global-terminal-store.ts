import { createRoot, createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import type { EmbeddedTerminalInstance } from "../EmbeddedTerminal";
import { loadTerminalState, saveTerminalState } from "../lib/terminal-persistence";

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
      const persisted = loadTerminalState(projectId);
      const [instances, setInstances] = createSignal<EmbeddedTerminalInstance[]>(
        persisted?.instances ?? [],
      );
      const [activeId, setActiveId] = createSignal<string | null>(
        persisted?.activeId ?? null,
      );

      createEffect(() => {
        const insts = instances();
        const active = activeId();
        saveTerminalState(projectId, insts, active);
      });

      stores.set(projectId, { instances, setInstances, activeId, setActiveId });
    });
  }
  return stores.get(projectId)!;
}
