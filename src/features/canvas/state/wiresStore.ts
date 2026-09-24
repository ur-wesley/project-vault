import { createStore, reconcile } from "solid-js/store";
import type { CanvasWireDto } from "~/types/dto";

export function createWiresStore() {
  const [wires, setWires] = createStore<CanvasWireDto[]>([]);

  const replaceAll = (next: CanvasWireDto[]) => setWires(reconcile(next, { key: "id" }));
  const addWire = (wire: CanvasWireDto) => setWires(wires.length, wire);
  const hasWire = (sourceId: string, targetId: string) =>
    wires.some((w) => w.sourceId === sourceId && w.targetId === targetId);
  const findWire = (id: string) => wires.find((w) => w.id === id);
  const removeWire = (id: string) => setWires(wires.filter((w) => w.id !== id));
  const updateWire = (id: string, patch: Partial<CanvasWireDto>) =>
    setWires((w) => w.id === id, patch);
  const removeTouching = (ids: ReadonlySet<string>) =>
    setWires(wires.filter((w) => !ids.has(w.sourceId) && !ids.has(w.targetId)));

  return {
    wires: () => wires,
    setWires,
    replaceAll,
    addWire,
    hasWire,
    findWire,
    removeWire,
    updateWire,
    removeTouching,
  };
}

export type WiresStore = ReturnType<typeof createWiresStore>;
