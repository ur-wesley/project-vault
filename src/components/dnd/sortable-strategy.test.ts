import { describe, expect, it } from "vitest";
import { getDisplacements, getOverIndex } from "./sortable-strategy";
import type { SortableSlot } from "./types";

const slots: SortableSlot[] = [
  { id: "a", start: 0, end: 100 },
  { id: "b", start: 102, end: 202 },
  { id: "c", start: 204, end: 304 },
];

describe("getOverIndex", () => {
  it("returns -1 for an empty list", () => {
    expect(getOverIndex([], 50)).toBe(-1);
  });

  it("finds the slot containing the pointer", () => {
    expect(getOverIndex(slots, 10)).toBe(0);
    expect(getOverIndex(slots, 150)).toBe(1);
    expect(getOverIndex(slots, 250)).toBe(2);
  });

  it("snaps to the nearest end outside all slots", () => {
    expect(getOverIndex(slots, -100)).toBe(0);
    expect(getOverIndex(slots, 1000)).toBe(2);
  });

  it("picks the nearer center between two slots", () => {
    // Gap midpoint between a (center 50) and b (center 152) is 101.
    expect(getOverIndex(slots, 90)).toBe(0);
    expect(getOverIndex(slots, 120)).toBe(1);
  });
});

describe("getDisplacements", () => {
  it("returns empty when nothing moves", () => {
    expect(getDisplacements(slots, 1, 1, 2).size).toBe(0);
    expect(getDisplacements(slots, -1, 2, 2).size).toBe(0);
    expect(getDisplacements(slots, 0, -1, 2).size).toBe(0);
    expect(getDisplacements(slots, 0, 5, 2).size).toBe(0);
  });

  it("shifts intermediate items left when dragging forward", () => {
    const d = getDisplacements(slots, 0, 2, 2);
    expect(d.get("a")).toBeUndefined();
    expect(d.get("b")).toBe(-102);
    expect(d.get("c")).toBe(-102);
  });

  it("shifts intermediate items right when dragging backward", () => {
    const d = getDisplacements(slots, 2, 0, 2);
    expect(d.get("a")).toBe(102);
    expect(d.get("b")).toBe(102);
    expect(d.get("c")).toBeUndefined();
  });

  it("only moves items between drag source and target", () => {
    const d = getDisplacements(
      [
        { id: "a", start: 0, end: 50 },
        { id: "b", start: 52, end: 152 },
        { id: "c", start: 154, end: 204 },
        { id: "d", start: 206, end: 256 },
      ],
      1,
      2,
      2,
    );
    expect([...d.keys()]).toEqual(["c"]);
    expect(d.get("c")).toBe(-102);
  });
});
