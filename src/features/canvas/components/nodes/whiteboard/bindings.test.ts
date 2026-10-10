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
  attachArrowBinding,
  detachArrowBinding,
  BIND_SNAP_DISTANCE,
  BIND_HOVER_DISTANCE,
} from "./bindings";
import { resolveConnectorWaypoints } from "./geometryEdit";
import { newElement } from "./excalidrawDefaults";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "./excalidrawTypes";

type NativeBinding = NonNullable<ExcalidrawArrowElement["startBinding"]>;

/** Relative-points literal helper (keeps `[x, y]` tuple typing). */
const P = (...ps: Array<[number, number]>): Array<[number, number]> => ps;

const rect = (id: string, x: number, y: number, w: number, h: number): ExcalidrawElement =>
  newElement("rectangle", { id, x, y, width: w, height: h });

const ellipse = (id: string): ExcalidrawElement =>
  newElement("ellipse", { id, x: 0, y: 0, width: 100, height: 100 });

const arrow = (
  id: string,
  startBinding: NativeBinding | null,
  endBinding: NativeBinding | null,
): ExcalidrawArrowElement =>
  newElement("arrow", {
    id,
    x: 0,
    y: 0,
    points: P([0, 0], [300, 50]),
    startBinding,
    endBinding,
  }) as ExcalidrawArrowElement;

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
  it("derives bound ends from live target bounds plus gap (ray fallback)", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = arrow("a", { elementId: "s", gap: 4, focus: 0 }, null);
    const { start, end } = resolveEndpoints([s, a], a);
    // Ray from center (50,50) toward the free end (300,50) exits the right
    // edge x=100, pushed out by the gap.
    expect(start.x).toBeCloseTo(104, 5);
    expect(start.y).toBeCloseTo(50, 5);
    expect(end).toEqual({ x: 300, y: 50 });
  });

  it("follows the target when it moves", () => {
    const s1 = rect("s", 0, 0, 100, 100);
    const moved = rect("s", 200, 0, 100, 100);
    const a = arrow("a", { elementId: "s", gap: 0, focus: 0 }, null);
    const before = resolveEndpoints([s1, a], a);
    const after = resolveEndpoints([moved, a], a);
    expect(after.start.x).toBeGreaterThan(before.start.x + 100);
  });

  it("falls back to stored coords for missing targets", () => {
    const a = arrow("a", { elementId: "ghost", gap: 4, focus: 0 }, null);
    const { start } = resolveEndpoints([a], a);
    expect(start).toEqual({ x: 0, y: 0 });
  });
});

describe("findBindCandidate", () => {
  it("finds shapes within the attach zone, nearest wins", () => {
    const els = [rect("a", 0, 0, 100, 100), rect("b", 200, 200, 100, 100)];
    expect(findBindCandidate(els, { x: 105, y: 50 })?.id).toBe("a");
    expect(findBindCandidate(els, { x: 500, y: 500 })).toBeNull();
  });

  it("ignores excluded ids and non-shapes", () => {
    const els: ExcalidrawElement[] = [
      rect("a", 0, 0, 100, 100),
      newElement("text", { id: "t", x: 0, y: 0, text: "hi" }),
    ];
    expect(findBindCandidate(els, { x: 50, y: 50 }, new Set(["a"]))).toBeNull();
  });
});

describe("arrowPath / polylineMidpoint", () => {
  const bent = {
    ...arrow("bent", null, null),
    points: P([0, 0], [150, 100], [300, 50]),
  } as ExcalidrawArrowElement;

  it("returns two points for straight connectors", () => {
    const a = arrow("a", null, null);
    expect(arrowPath([a], a)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 50 },
    ]);
  });

  it("resolves absolute coords from x/y + relative points", () => {
    const moved = { ...arrow("m", null, null), x: 10, y: 20 } as ExcalidrawArrowElement;
    expect(arrowPath([moved], moved)).toEqual([
      { x: 10, y: 20 },
      { x: 310, y: 70 },
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
      points: P([0, 0], [100, 0], [200, 100], [300, 50]),
    } as ExcalidrawArrowElement;
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
    const a = arrow("a", { elementId: "s", gap: 4, side: "e", focus: 0 }, null);
    const { start } = resolveEndpoints([s, a], a);
    expect(start.x).toBeCloseTo(104, 5);
    expect(start.y).toBeCloseTo(50, 5);
  });

  it("sticky anchor survives the opposite end moving (no slide)", () => {
    const s = rect("s", 0, 0, 100, 100);
    const mk = (points: Array<[number, number]>) =>
      ({
        ...arrow("a", { elementId: "s", gap: 4, side: "e", focus: 0 }, null),
        points,
      }) as ExcalidrawArrowElement;
    const r1 = resolveEndpoints([s, mk(P([0, 0], [300, 50]))], mk(P([0, 0], [300, 50])));
    const r2 = resolveEndpoints([s, mk(P([0, 0], [300, 500]))], mk(P([0, 0], [300, 500])));
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
    const a = arrow("a", { elementId: "s", gap: 0, side: "e", focus: 0 }, null);
    const before = arrowPath([s, a], a);
    const moved = rect("s", 50, 0, 100, 100);
    const after = arrowPath([moved, a], a);
    // Bound end follows the shape (+50); free end stays put — arrow stretches.
    expect(after[0].x).toBeCloseTo(before[0].x + 50, 5);
    expect(after[1]).toEqual(before[1]);
  });

  it("bent waypoints translate with the resolved chord", () => {
    const s = rect("s", 0, 0, 100, 100);
    const bent = {
      ...arrow("bent", { elementId: "s", gap: 0, side: "e", focus: 0 }, null),
      points: P([0, 0], [200, 100], [300, 50]),
    } as ExcalidrawArrowElement;
    const before = arrowPath([s, bent], bent);
    const moved = rect("s", 200, 0, 100, 100);
    const after = arrowPath([moved, bent], bent);
    const midDx = (after[0].x + after[2].x) / 2 - (before[0].x + before[2].x) / 2;
    // Waypoints follow the resolved chord midpoint (translate, never distort).
    expect(after[1].x - before[1].x).toBeCloseTo(midDx, 5);
    expect(resolveConnectorWaypoints(bent, { start: before[0], end: before[2] })).toEqual([
      before[1],
    ]);
  });
});

describe("binding writes with back-refs", () => {
  it("attachArrowBinding sets the binding, snaps the end, and writes back-refs", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = arrow("a", null, null);
    const out = attachArrowBinding([s, a], "a", "start", s, { x: 120, y: 50 }, 4);
    const next = out.find((e) => e.id === "a");
    if (!next || next.type !== "arrow") throw new Error("expected arrow");
    expect(next.startBinding).toMatchObject({ elementId: "s", side: "e", gap: 4 });
    // Snapped to the east anchor plus gap: (104, 50) relative to origin.
    expect(next.points[0]).toEqual([104, 50]);
    const target = out.find((e) => e.id === "s");
    expect(target?.boundElements).toEqual([{ type: "arrow", id: "a" }]);
    // Resolved start lands on the snapped anchor.
    const { start } = resolveEndpoints(out, next);
    expect(start.x).toBeCloseTo(104, 5);
    expect(start.y).toBeCloseTo(50, 5);
  });

  it("rebinding clears the stale back-ref", () => {
    const s1 = rect("s1", 0, 0, 100, 100);
    const s2 = rect("s2", 300, 300, 100, 100);
    const a = arrow("a", null, null);
    const once = attachArrowBinding([s1, s2, a], "a", "start", s1, { x: 120, y: 50 }, 4);
    const arrowOnce = once.find((e) => e.id === "a");
    if (!arrowOnce || arrowOnce.type !== "arrow") throw new Error("expected arrow");
    const twice = attachArrowBinding(once, "a", "start", s2, { x: 290, y: 350 }, 4);
    expect(twice.find((e) => e.id === "s1")?.boundElements ?? []).toEqual([]);
    expect(twice.find((e) => e.id === "s2")?.boundElements).toEqual([{ type: "arrow", id: "a" }]);
    void arrowOnce;
  });

  it("detachArrowBinding clears the binding and the back-ref", () => {
    const s = rect("s", 0, 0, 100, 100);
    const a = arrow("a", null, null);
    const attached = attachArrowBinding([s, a], "a", "end", s, { x: 50, y: 120 }, 4);
    const detached = detachArrowBinding(attached, "a", "end");
    const next = detached.find((e) => e.id === "a");
    if (!next || next.type !== "arrow") throw new Error("expected arrow");
    expect(next.endBinding).toBeNull();
    expect(detached.find((e) => e.id === "s")?.boundElements ?? []).toEqual([]);
  });
});
