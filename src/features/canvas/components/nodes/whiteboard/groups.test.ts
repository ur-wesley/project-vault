import { describe, it, expect } from "vitest";
import {
  groupOf,
  groupChain,
  groupMembers,
  groupBounds,
  groupSelection,
  ungroupSelection,
  scaleElementsToUnion,
  frameMembers,
  frameBounds,
} from "./groups";
import { newElement } from "./excalidrawDefaults";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "./excalidrawTypes";

/** Relative-points literal helper (keeps `[x, y]` tuple typing). */
const P = (...ps: Array<[number, number]>): Array<[number, number]> => ps;

const rect = (
  id: string,
  x = 0,
  y = 0,
  w = 10,
  h = 10,
  groupIds: string[] = [],
): ExcalidrawElement =>
  newElement("rectangle", { id, x, y, width: w, height: h, groupIds });

const label = (id: string, containerId: string | null): ExcalidrawTextElement =>
  newElement("text", {
    id,
    x: 4,
    y: 6,
    text: "hi",
    fontSize: 16,
    containerId,
    textAlign: "center",
  }) as ExcalidrawTextElement;

describe("groupOf / groupMembers", () => {
  it("returns null for ungrouped elements", () => {
    expect(groupOf(rect("a"))).toBeNull();
    expect(groupMembers([rect("a")], "a")).toEqual(["a"]);
  });

  it("lists all members of a group", () => {
    const els = [rect("a", 0, 0, 10, 10, ["g"]), rect("b", 0, 0, 10, 10, ["g"]), rect("c")];
    expect(groupMembers(els, "a").sort()).toEqual(["a", "b"]);
  });

  it("supports nesting: direct group is the last entry", () => {
    const el = rect("a", 0, 0, 10, 10, ["g0", "g1"]);
    expect(groupOf(el)).toBe("g1");
    expect(groupChain(el)).toEqual(["g0", "g1"]);
    const els = [el, rect("b", 0, 0, 10, 10, ["g0", "g1"]), rect("c", 0, 0, 10, 10, ["g0"])];
    // Direct members of g1: a + b (c only shares the outer group).
    expect(groupMembers(els, "a").sort()).toEqual(["a", "b"]);
    // Bounds for the outer group include nested members.
    expect(groupBounds(els, "g0")).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe("groupSelection", () => {
  it("groups 2+ ungrouped elements with a fresh id", () => {
    const els = [rect("a"), rect("b"), rect("c")];
    const { elements, groupId } = groupSelection(els, ["a", "b"], "g1");
    expect(groupId).toBe("g1");
    expect(groupOf(elements.find((e) => e.id === "a")!)).toBe("g1");
    expect(groupOf(elements.find((e) => e.id === "c")!)).toBeNull();
  });

  it("nests instead of refusing grouped elements", () => {
    const els = [rect("a"), rect("b", 0, 0, 10, 10, ["g0"])];
    const { elements } = groupSelection(els, ["a", "b"], "g1");
    // b keeps its existing chain and gains the new parent; a joins fresh.
    expect(elements.find((e) => e.id === "b")?.groupIds).toEqual(["g0", "g1"]);
    expect(elements.find((e) => e.id === "a")?.groupIds).toEqual(["g1"]);
  });

  it("refuses single-element groups", () => {
    const els = [rect("a"), rect("b", 0, 0, 10, 10, ["g0"])];
    expect(groupSelection(els, ["a"], "g1").groupId).toBeNull();
  });
});

describe("ungroupSelection", () => {
  it("clears membership for touched groups only", () => {
    const els = [
      rect("a", 0, 0, 10, 10, ["g1"]),
      rect("b", 0, 0, 10, 10, ["g1"]),
      rect("c", 0, 0, 10, 10, ["g2"]),
    ];
    const out = ungroupSelection(els, ["a"]);
    expect(groupOf(out.find((e) => e.id === "a")!)).toBeNull();
    expect(groupOf(out.find((e) => e.id === "b")!)).toBeNull();
    expect(groupOf(out.find((e) => e.id === "c")!)).toBe("g2");
  });

  it("unpeels one nesting level, keeping outer parents", () => {
    const els = [
      rect("a", 0, 0, 10, 10, ["g0", "g1"]),
      rect("b", 0, 0, 10, 10, ["g1"]),
    ];
    const out = ungroupSelection(els, ["a"]);
    expect(out.find((e) => e.id === "a")?.groupIds).toEqual(["g0"]);
    expect(out.find((e) => e.id === "b")?.groupIds).toEqual([]);
  });
});

describe("groupBounds", () => {
  it("unions member bounds", () => {
    const els = [rect("a", 0, 0, 10, 10, ["g"]), rect("b", 20, 30, 20, 20, ["g"])];
    expect(groupBounds(els, "g")).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 50 });
  });
});

describe("frames", () => {
  it("tracks frameId membership and bounds", () => {
    const frame = newElement("frame", { id: "f", x: 0, y: 0, width: 100, height: 100, name: "F" });
    const els: ExcalidrawElement[] = [
      frame,
      { ...rect("a", 10, 10), frameId: "f" },
      rect("b", 200, 200),
    ];
    expect(frameMembers(els, "f")).toEqual(["a"]);
    expect(frameBounds(els, "f")).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(frameBounds(els, "ghost")).toBeNull();
  });
});

describe("scaleElementsToUnion", () => {
  it("scales member geometry into the new union", () => {
    const els = [rect("a", 0, 0, 10, 10), rect("b", 0, 0, 10, 10)];
    const out = scaleElementsToUnion(
      els,
      new Set(["a", "b"]),
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    );
    expect(out[0]).toMatchObject({ width: 20, height: 20 });
  });

  it("detaches scaled arrows (bindings cleared)", () => {
    const els: ExcalidrawElement[] = [
      {
        ...newElement("arrow", {
          id: "a",
          x: 0,
          y: 0,
          points: P([0, 0], [10, 10]),
          startBinding: { elementId: "s", gap: 4, focus: 0 },
          endBinding: null,
        }),
      } as ExcalidrawArrowElement,
    ];
    const out = scaleElementsToUnion(
      els,
      new Set(["a"]),
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    );
    expect(out[0]).toMatchObject({ startBinding: null, points: [[0, 0], [20, 20]] });
  });

  it("never resizes bound labels: only their position follows the union", () => {
    const els: ExcalidrawElement[] = [rect("a", 0, 0, 10, 10), label("t", "a")];
    const out = scaleElementsToUnion(
      els,
      new Set(["a", "t"]),
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    );
    const t = out.find((el) => el.id === "t");
    expect(t).toMatchObject({ fontSize: 16, x: 8, y: 12 });
  });
});
