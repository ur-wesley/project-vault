import { describe, it, expect } from "vitest";
import {
  intersectBoundary,
  resolveEndpoints,
  findBindCandidate,
  findBindAnchor,
  findBindHover,
  createBinding,
  sideFocusForPoint,
  anchorToPoint,
  arrowPath,
  polylineMidpoint,
  BIND_SNAP_DISTANCE,
  BIND_HOVER_DISTANCE,
} from "./bindings";
import { resolveConnectorWaypoints } from "./geometry";
import { baseElement, type ElementBinding, type WhiteboardElement } from "./types";

const rect = (id: string, x1: number, y1: number, x2: number, y2: number): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "rectangle",
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

const ellipse = (id: string): WhiteboardElement => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "ellipse",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 100 },
});

const arrow = (
  id: string,
  startBinding: ElementBinding | null,
  endBinding: ElementBinding | null,
): Extract<WhiteboardElement, { kind: "arrow" }> => ({
  ...baseElement(id, "#e5e5e5", 2),
  kind: "arrow",
  start: { x: 0, y: 0 },
  end: { x: 300, y: 50 },
  startBinding,
  endBinding,
  startArrow: "none",
  endArrow: "arrow",
  waypoints: [],
});

describe("intersectBoundary", () => {
  it("hits the right edge of a rectangle for a horizontal ray", () => {
    const r = rect("r", 0, 0, 100, 100);
    expect(intersectBoundary(r, { x: 50, y: 50 }, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it("hits the ellipse boundary along the ray", () => {
    const e = ellipse("e");
    const p = intersectBoundary(e, { x: 50, y: 50 }, { x: 500, y: 50 });
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });
});

describe("resolveEndpoints", () => {
  it("derives bound ends from live target bounds plus gap", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = arrow("a", { elementId: "s", gap: 4 }, null);
    const { start, end } = resolveEndpoints(
      [s, a],
      a as Extract<WhiteboardElement, { kind: "arrow" }>,
    );
    // Ray from center (50,50) toward the free end (300,50) exits the right
    // edge x=100, pushed out by the gap.
    expect(start.x).toBeCloseTo(104, 5);
    expect(start.y).toBeCloseTo(50, 5);
    expect(end).toEqual({ x: 300, y: 50 });
  });

  it("follows the target when it moves", () => {
    const s1 = rect("s", 0, 0, 100, 100);
    const moved = {
      ...s1,
      kind: "rectangle" as const,
      start: { x: 200, y: 0 },
      end: { x: 300, y: 100 },
    };
    const a = arrow("a", { elementId: "s", gap: 0 }, null);
    const before = resolveEndpoints([s1, a], a as Extract<WhiteboardElement, { kind: "arrow" }>);
    const after = resolveEndpoints([moved, a], a as Extract<WhiteboardElement, { kind: "arrow" }>);
    expect(after.start.x).toBeGreaterThan(before.start.x + 100);
  });

  it("falls back to stored coords for missing targets", () => {
    const a = arrow("a", { elementId: "ghost", gap: 4 }, null);
    const { start } = resolveEndpoints([a], a as Extract<WhiteboardElement, { kind: "arrow" }>);
    expect(start).toEqual({ x: 0, y: 0 });
  });
});

describe("findBindCandidate", () => {
  it("finds shapes within the attach zone, nearest wins", () => {
    const els = [rect("a", 0, 0, 100, 100), rect("b", 200, 200, 300, 300)];
    expect(findBindCandidate(els, { x: 105, y: 50 })?.id).toBe("a");
    expect(findBindCandidate(els, { x: 500, y: 500 })).toBeNull();
  });

  it("ignores excluded ids and non-shapes", () => {
    const els = [
      rect("a", 0, 0, 100, 100),
      {
        ...baseElement("t", "#e5e5e5", 2),
        kind: "text",
        position: { x: 0, y: 0 },
        text: "hi",
        fontSize: 14,
        fontFamily: "normal",
        bold: false,
        italic: false,
        containerId: null,
        labelGroupId: null,
        offset: { x: 0, y: 0 },
        width: null,
        textAlign: "left",
      } as WhiteboardElement,
    ];
    expect(findBindCandidate(els, { x: 50, y: 50 }, new Set(["a"]))).toBeNull();
  });
});

describe("arrowPath / polylineMidpoint", () => {
  const bent = { ...arrow("bent", null, null), waypoints: [{ x: 150, y: 100 }] };

  it("returns two points for straight connectors", () => {
    const a = arrow("a", null, null);
    expect(arrowPath([a], a)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 50 },
    ]);
  });

  it("inserts the stored waypoints between resolved ends", () => {
    const path = arrowPath([bent], bent);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 100 },
      { x: 300, y: 50 },
    ]);
  });

  it("chains multiple waypoints in order", () => {
    const multi = {
      ...arrow("m", null, null),
      waypoints: [
        { x: 100, y: 0 },
        { x: 200, y: 100 },
      ],
    };
    expect(arrowPath([multi], multi)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 300, y: 50 },
    ]);
  });

  it("midpoints straight segments and bent paths by arc length", () => {
    expect(
      polylineMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual({ x: 50, y: 0 });
    // L-shape: total length 200, midpoint is the corner.
    expect(
      polylineMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual({ x: 100, y: 0 });
    expect(polylineMidpoint([])).toEqual({ x: 0, y: 0 });
  });
});

describe("sticky side+focus anchors", () => {
  it("picks the nearest side with normalized focus", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(sideFocusForPoint(box, { x: 120, y: 50 }).side).toBe("e");
    expect(sideFocusForPoint(box, { x: 50, y: -10 }).side).toBe("n");
    const f = sideFocusForPoint(box, { x: 120, y: 75 });
    expect(f.side).toBe("e");
    expect(f.focus).toBeCloseTo(0.5, 5);
  });

  it("anchorToPoint lands on the requested side", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(anchorToPoint(box, "e", 0)).toEqual({ x: 100, y: 50 });
    expect(anchorToPoint(box, "n", 0)).toEqual({ x: 50, y: 0 });
  });

  it("resolves sticky bindings from side+focus plus gap", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = {
      ...arrow("a", { elementId: "s", gap: 4, side: "e" as const, focus: 0 }, null),
    };
    const { start } = resolveEndpoints([s, a], a);
    expect(start.x).toBeCloseTo(104, 5);
    expect(start.y).toBeCloseTo(50, 5);
  });

  it("sticky anchor survives the opposite end moving (no slide)", () => {
    const s = rect("s", 0, 0, 100, 100);
    const mk = (end: { x: number; y: number }) => ({
      ...arrow("a", { elementId: "s", gap: 4, side: "e" as const, focus: 0 }, null),
      end,
    });
    const r1 = resolveEndpoints([s, mk({ x: 300, y: 50 })], mk({ x: 300, y: 50 }));
    const r2 = resolveEndpoints([s, mk({ x: 300, y: 500 })], mk({ x: 300, y: 500 }));
    // East-side anchor stays put even when the free end swings away.
    expect(r2.start.x).toBeCloseTo(r1.start.x, 5);
    expect(r2.start.y).toBeCloseTo(r1.start.y, 5);
  });

  it("preview zone == commit zone: highlighted drops always attach", () => {
    expect(BIND_HOVER_DISTANCE).toBe(BIND_SNAP_DISTANCE);
    const els = [rect("a", 0, 0, 100, 100)];
    // 20px out: inside the single attach radius — both APIs agree.
    expect(findBindHover(els, { x: 120, y: 50 })?.element.id).toBe("a");
    expect(findBindAnchor(els, { x: 120, y: 50 }, BIND_SNAP_DISTANCE)?.element.id).toBe("a");
    expect(findBindCandidate(els, { x: 120, y: 50 })?.id).toBe("a");
    // Outside the radius: nothing.
    expect(findBindHover(els, { x: 140, y: 50 })).toBeNull();
    expect(findBindCandidate(els, { x: 140, y: 50 })).toBeNull();
  });

  it("createBinding remembers the drop side", () => {
    const s = rect("s", 0, 0, 100, 100);
    const b = createBinding(s, { x: 120, y: 50 }, 4);
    expect(b).toMatchObject({ elementId: "s", gap: 4, side: "e" });
  });

  it("straight bound arrows extend when the target moves", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = {
      ...arrow("a", { elementId: "s", gap: 0, side: "e" as const, focus: 0 }, null),
      end: { x: 300, y: 50 },
    };
    const before = arrowPath([s, a], a);
    const moved = {
      ...s,
      kind: "rectangle" as const,
      start: { x: 50, y: 0 },
      end: { x: 150, y: 100 },
    };
    const after = arrowPath([moved, a], a);
    // Bound end follows the shape (+50); free end stays put — arrow stretches.
    expect(after[0].x).toBeCloseTo(before[0].x + 50, 5);
    expect(after[1]).toEqual(before[1]);
  });

  it("bent waypoints translate with the resolved chord", () => {
    const s = rect("s", 0, 0, 100, 100);
    const bent = {
      ...arrow("bent", { elementId: "s", gap: 0, side: "e" as const, focus: 0 }, null),
      waypoints: [{ x: 200, y: 100 }],
    };
    const before = arrowPath([s, bent], bent);
    const moved = {
      ...s,
      kind: "rectangle" as const,
      start: { x: 200, y: 0 },
      end: { x: 300, y: 100 },
    };
    const after = arrowPath([moved, bent], bent);
    const midDx = (after[0].x + after[2].x) / 2 - (before[0].x + before[2].x) / 2;
    // Waypoints follow the resolved chord midpoint (translate, never distort).
    expect(after[1].x - before[1].x).toBeCloseTo(midDx, 5);
    expect(resolveConnectorWaypoints(bent, { start: before[0], end: before[2] })).toEqual([
      before[1],
    ]);
  });
});
