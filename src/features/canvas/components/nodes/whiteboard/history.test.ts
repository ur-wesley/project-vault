import { describe, it, expect } from "vitest";
import {
  emptyHistory,
  historyPush,
  historyUndo,
  historyRedo,
  canUndo,
  canRedo,
  HISTORY_LIMIT,
} from "./history";
import { baseElement, type WhiteboardElement } from "./types";

const el = (id: string): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "line",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 10 },
  startBinding: null,
  endBinding: null,
  startArrow: "none",
  endArrow: "none",
  waypoints: [],
});

describe("whiteboard history", () => {
  it("starts empty with no undo/redo", () => {
    const h = emptyHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("undo restores the pushed snapshot and enables redo", () => {
    const before: WhiteboardElement[] = [];
    const after = [el("a")];
    const h = historyPush(emptyHistory(), before);
    expect(canUndo(h)).toBe(true);
    const undone = historyUndo(h, after);
    expect(undone.elements).toEqual(before);
    expect(canRedo(undone.history)).toBe(true);
    const redone = historyRedo(undone.history, undone.elements);
    expect(redone.elements).toEqual(after);
  });

  it("push clears the redo stack", () => {
    const h0 = historyPush(emptyHistory(), []);
    const undone = historyUndo(h0, [el("a")]);
    const h1 = historyPush(undone.history, undone.elements);
    expect(canRedo(h1)).toBe(false);
  });

  it("is a no-op when the stack is empty", () => {
    const current = [el("a")];
    expect(historyUndo(emptyHistory(), current).elements).toBe(current);
    expect(historyRedo(emptyHistory(), current).elements).toBe(current);
  });

  it("caps the undo stack at HISTORY_LIMIT", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = historyPush(h, [el(`e${i}`)]);
    }
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
