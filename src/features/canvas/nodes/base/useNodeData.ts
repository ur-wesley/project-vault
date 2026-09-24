import { createMemo } from "solid-js";
import type { CanvasNodeDto } from "~/types/dto";
import { parseNodeData, encodeNodeData } from "./parseNodeData";

/**
 * Reactive typed access to a node's dataJson payload.
 * Fixes the NotesNode-class bug where local edits never persisted:
 * call `set()` and the canvas store is updated (debounced persist included).
 */
export function useNodeData<T extends object>(
  node: () => CanvasNodeDto,
  fallback: T,
  onDataChange?: (id: string, dataJson: string | null) => void,
) {
  const parsed = createMemo(() => parseNodeData<T>(node().dataJson, fallback));
  const set = (next: T | null) => {
    onDataChange?.(node().id, encodeNodeData(next));
  };
  const patch = (partial: Partial<T>) => {
    set({ ...parsed(), ...partial });
  };
  return { data: parsed, set, patch };
}
