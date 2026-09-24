import type { WhiteboardElement } from "./types";

/**
 * Bounded undo/redo over immutable element snapshots.
 * Pure functions — the component owns the live state, history only stores it.
 */
export interface WhiteboardHistory {
  past: WhiteboardElement[][];
  future: WhiteboardElement[][];
}

export const HISTORY_LIMIT = 50;

export function emptyHistory(): WhiteboardHistory {
  return { past: [], future: [] };
}

/** Push the state *before* a mutation. Clears the redo stack. */
export function historyPush(h: WhiteboardHistory, before: WhiteboardElement[]): WhiteboardHistory {
  const past = [...h.past, before].slice(-HISTORY_LIMIT);
  return { past, future: [] };
}

export function historyUndo(
  h: WhiteboardHistory,
  current: WhiteboardElement[],
): { history: WhiteboardHistory; elements: WhiteboardElement[] } {
  const prev = h.past[h.past.length - 1];
  if (!prev) return { history: h, elements: current };
  return {
    history: { past: h.past.slice(0, -1), future: [current, ...h.future].slice(0, HISTORY_LIMIT) },
    elements: prev,
  };
}

export function historyRedo(
  h: WhiteboardHistory,
  current: WhiteboardElement[],
): { history: WhiteboardHistory; elements: WhiteboardElement[] } {
  const next = h.future[0];
  if (!next) return { history: h, elements: current };
  return {
    history: {
      past: [...h.past, current].slice(-HISTORY_LIMIT),
      future: h.future.slice(1),
    },
    elements: next,
  };
}

export function canUndo(h: WhiteboardHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: WhiteboardHistory): boolean {
  return h.future.length > 0;
}
