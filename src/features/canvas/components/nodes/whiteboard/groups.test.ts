import { describe, it, expect } from "vitest";
import {
  groupOf,
  groupMembers,
  groupBounds,
  groupSelection,
  ungroupSelection,
  scaleElementsToUnion,
} from "./groups";
import { baseElement, type WhiteboardElement } from "./types";

function label(id: string, containerId: string | null): WhiteboardElement {
  return {
    ...baseElement(id, "#e5e5e5", 2),
    kind: "text",
    position: { x: 0, y: 0 },
    text: "hi",
    fontSize: 16,
    fontFamily: "normal",
    bold: false,
    italic: false,
    containerId,
    labelGroupId: null,
    offset: { x: 4, y: 6 },
    width: null,
    textAlign: "center",
  };
}

const rect = (
  id: string,
  x1 = 0,
  y1 = 0,
  x2 = 10,
  y2 = 10,
  groupIds: string[] = [],
): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  groupIds,
  kind: "rectangle",
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

describe("groupOf / groupMembers", () => {
  it("returns null for ungrouped elements", () => {
    expect(groupOf(rect("a"))).toBeNull();
    expect(groupMembers([rect("a")], "a")).toEqual(["a"]);
  });

  it("lists all members of a group", () => {
    const els = [rect("a", 0, 0, 10, 10, ["g"]), rect("b", 0, 0, 10, 10, ["g"]), rect("c")];
    expect(groupMembers(els, "a").sort()).toEqual(["a", "b"]);
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

  it("refuses single-element groups and nested grouping", () => {
    const els = [rect("a"), rect("b", 0, 0, 10, 10, ["g0"])];
    expect(groupSelection(els, ["a"], "g1").groupId).toBeNull();
    const { elements } = groupSelection(els, ["a", "b"], "g1");
    // b keeps its existing group; a alone can't form one.
    expect(groupOf(elements.find((e) => e.id === "b")!)).toBe("g0");
    expect(groupOf(elements.find((e) => e.id === "a")!)).toBeNull();
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
});

describe("groupBounds", () => {
  it("unions member bounds", () => {
    const els = [rect("a", 0, 0, 10, 10, ["g"]), rect("b", 20, 30, 40, 50, ["g"])];
    expect(groupBounds(els, "g")).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 50 });
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
    expect(out[0]).toMatchObject({ end: { x: 20, y: 20 } });
  });

  it("detaches scaled arrows (bindings cleared)", () => {
    const els: WhiteboardElement[] = [
      {
        ...baseElement("a", "#e5e5e5", 2),
        kind: "arrow",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        startBinding: { elementId: "s", gap: 4 },
        endBinding: null,
        startArrow: "none",
        endArrow: "arrow",
        waypoints: [],
      },
    ];
    const out = scaleElementsToUnion(
      els,
      new Set(["a"]),
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    );
    expect(out[0]).toMatchObject({ startBinding: null, end: { x: 20, y: 20 } });
  });

  it("never resizes bound labels: only their offset follows the union", () => {
    const els = [rect("a", 0, 0, 10, 10), label("t", "a")];
    const out = scaleElementsToUnion(
      els,
      new Set(["a", "t"]),
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    );
    const t = out.find((el) => el.id === "t");
    expect(t).toMatchObject({ fontSize: 16, offset: { x: 8, y: 12 } });
  });
});
