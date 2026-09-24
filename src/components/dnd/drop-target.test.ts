import { describe, expect, it } from "vitest";

import { getBoardDropTarget, getColumnDisplacements } from "./drop-target";

const columns = [
  { id: "todo", left: 0, top: 0, right: 200, bottom: 600 },
  { id: "doing", left: 210, top: 0, right: 410, bottom: 600 },
  { id: "done", left: 420, top: 0, right: 620, bottom: 600 },
];

const cards = [
  { id: "a", columnId: "todo", top: 40, bottom: 100 },
  { id: "b", columnId: "todo", top: 110, bottom: 170 },
  { id: "c", columnId: "doing", top: 40, bottom: 100 },
];

describe("getBoardDropTarget", () => {
  it("finds the column and insertion index by midpoint rule", () => {
    expect(getBoardDropTarget(columns, cards, { x: 100, y: 50 })).toEqual({
      columnId: "todo",
      index: 0,
    });
    expect(getBoardDropTarget(columns, cards, { x: 100, y: 80 })).toEqual({
      columnId: "todo",
      index: 1,
    });
    expect(getBoardDropTarget(columns, cards, { x: 300, y: 200 })).toEqual({
      columnId: "doing",
      index: 1,
    });
  });

  it("targets empty columns at index 0", () => {
    expect(getBoardDropTarget(columns, cards, { x: 500, y: 300 })).toEqual({
      columnId: "done",
      index: 0,
    });
  });

  it("returns null outside every column", () => {
    expect(getBoardDropTarget(columns, cards, { x: 700, y: 300 })).toBeNull();
    expect(getBoardDropTarget(columns, cards, { x: 100, y: 700 })).toBeNull();
    expect(getBoardDropTarget([], [], { x: 100, y: 100 })).toBeNull();
  });
});

describe("getColumnDisplacements", () => {
  it("shifts items between drag origin and target (same column, move down)", () => {
    // [a*, b, c, d], a dragged from 0 to index 2 → b,c shift up.
    const d = getColumnDisplacements(["b", "c", "d"], 0, 2, 50);
    expect(Object.fromEntries(d)).toEqual({ b: -50, c: -50 });
  });

  it("shifts items up when moving up", () => {
    // [a, b, c*, d], c dragged from 2 to index 0 → a,b shift down.
    const d = getColumnDisplacements(["a", "b", "d"], 2, 0, 50);
    expect(Object.fromEntries(d)).toEqual({ a: 50, b: 50 });
  });

  it("opens a gap in foreign columns", () => {
    const d = getColumnDisplacements(["x", "y"], -1, 1, 40);
    expect(Object.fromEntries(d)).toEqual({ y: 40 });
  });

  it("closes the gap in the source column when hovering elsewhere", () => {
    const d = getColumnDisplacements(["b", "c"], 0, null, 40);
    expect(Object.fromEntries(d)).toEqual({ b: -40, c: -40 });
  });

  it("returns empty when nothing moves", () => {
    expect(getColumnDisplacements(["b"], 0, 0, 40).size).toBe(0);
    expect(getColumnDisplacements(["b"], -1, null, 40).size).toBe(0);
    expect(getColumnDisplacements(["b"], 0, 1, 0).size).toBe(0);
  });
});
