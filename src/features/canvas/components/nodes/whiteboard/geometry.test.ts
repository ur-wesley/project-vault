import { describe, it, expect } from "vitest";
import {
  distanceToSegment,
  distanceToPolyline,
  pathBounds,
  getElementBounds,
  hitTestElement,
  pickElement,
  decimatePoints,
  diamondVertices,
  flattenSmoothPath,
  boxesOverlap,
  unionBounds,
  splitPathAtBox,
  connectorAbsolutePoints,
  withRelativePoints,
  normalizeElementOrigin,
} from "./geometry";
import {
  moveElement,
  moveElements,
  getResizeHandles,
  hitTestHandle,
  resizeElement,
  insertWaypointAt,
  removeWaypointAt,
  resolveConnectorWaypoints,
  resolvedToStored,
  storedToResolved,
  dragBoxHandle,
} from "./geometryEdit";
import { newElement } from "./excalidrawDefaults";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawFreedrawElement,
} from "./excalidrawTypes";

/** Relative-points literal helper (keeps `[x, y]` tuple typing). */
const P = (...ps: Array<[number, number]>): Array<[number, number]> => ps;

const rect = (x: number, y: number, w: number, h: number, id = "r"): ExcalidrawElement =>
  newElement("rectangle", { id, x, y, width: w, height: h });

const arrow = (id = "a"): ExcalidrawArrowElement =>
  newElement("arrow", {
    id,
    x: 0,
    y: 0,
    points: P([0, 0], [100, 0]),
    startBinding: null,
    endBinding: null,
  }) as ExcalidrawArrowElement;

const freehand = (id = "f"): ExcalidrawFreedrawElement =>
  newElement("freedraw", {
    id,
    x: 0,
    y: 0,
    points: P([0, 0], [50, 0], [100, 0]),
  }) as ExcalidrawFreedrawElement;

describe("distanceToSegment", () => {
  it("measures perpendicular distance", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });

  it("clamps to endpoints", () => {
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
  });

  it("handles degenerate segments", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("getElementBounds", () => {
  it("normalizes negative width/height", () => {
    expect(getElementBounds(rect(10, 20, -10, -15))).toEqual({
      minX: 0,
      minY: 5,
      maxX: 10,
      maxY: 20,
    });
  });

  it("bounds freedraw by origin + relative points", () => {
    expect(
      getElementBounds(
        newElement("freedraw", { id: "f", x: 1, y: 2, points: P([0, 7], [3, 0]) }),
      ),
    ).toEqual({ minX: 1, minY: 2, maxX: 4, maxY: 9 });
  });

  it("bounds arrows by absolute x/y + points", () => {
    expect(getElementBounds(arrow())).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 0 });
  });

  it("bounds text by stored x/y/width/height, measuring when unset", () => {
    const fixed = newElement("text", {
      id: "t",
      x: 5,
      y: 7,
      width: 120,
      height: 40,
      text: "hi",
    });
    expect(getElementBounds(fixed)).toEqual({ minX: 5, minY: 7, maxX: 125, maxY: 47 });
    const auto = newElement("text", { id: "t2", x: 5, y: 7, text: "hi", fontSize: 14 });
    const b = getElementBounds(auto);
    expect(b.minX).toBe(5);
    expect(b.minY).toBe(7);
    expect(b.maxX).toBeGreaterThan(5);
    expect(b.maxY).toBeGreaterThan(7);
  });

  it("ignores angle in v1 (axis-aligned bounds)", () => {
    const rotated = { ...rect(10, 20, 100, 50), angle: 0.6 };
    expect(getElementBounds(rotated)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });
});

describe("hitTestElement", () => {
  it("hits rectangle interior and borders", () => {
    const r = rect(0, 0, 100, 50);
    expect(hitTestElement(r, { x: 50, y: 25 })).toBe(true);
    expect(hitTestElement(r, { x: 200, y: 200 })).toBe(false);
  });

  it("hits negative-size rectangles via normalized bounds", () => {
    const r = rect(100, 100, -100, -100);
    expect(hitTestElement(r, { x: 50, y: 50 })).toBe(true);
  });

  it("hits ellipse interior, rejects far points", () => {
    const e: ExcalidrawElement = newElement("ellipse", { id: "e", x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestElement(e, { x: 50, y: 50 })).toBe(true);
    expect(hitTestElement(e, { x: 200, y: 200 })).toBe(false);
  });

  it("hits diamond interior via polygon test", () => {
    const d: ExcalidrawElement = newElement("diamond", { id: "d", x: 0, y: 0, width: 100, height: 100 });
    expect(hitTestElement(d, { x: 50, y: 50 })).toBe(true);
    // Corner of the bounding box is outside the diamond (with margin for threshold).
    expect(hitTestElement(d, { x: 2, y: 2 })).toBe(false);
  });

  it("hits arrows near the segment only", () => {
    const a = arrow();
    expect(hitTestElement(a, { x: 50, y: 2 })).toBe(true);
    expect(hitTestElement(a, { x: 50, y: 60 })).toBe(false);
  });

  it("hits freedraw strokes near their path", () => {
    const f = freehand();
    expect(hitTestElement(f, { x: 50, y: 3 })).toBe(true);
    expect(hitTestElement(f, { x: 50, y: 80 })).toBe(false);
  });
});

describe("diamondVertices", () => {
  it("returns top/right/bottom/left order", () => {
    expect(diamondVertices({ minX: 0, minY: 0, maxX: 100, maxY: 50 })).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 25 },
      { x: 50, y: 50 },
      { x: 0, y: 25 },
    ]);
  });
});

describe("pickElement", () => {
  it("picks the topmost (last) hit", () => {
    const a = rect(0, 0, 100, 100, "a");
    const b = rect(0, 0, 100, 100, "top");
    expect(pickElement([a, b], { x: 10, y: 10 })?.id).toBe("top");
    expect(pickElement([a, b], { x: 500, y: 500 })).toBeNull();
  });
});

describe("moveElement", () => {
  it("translates shape origins", () => {
    const moved = moveElement(rect(0, 0, 10, 10), 5, -5);
    expect(moved).toMatchObject({ x: 5, y: -5, width: 10, height: 10 });
  });

  it("shifts connector origins, keeping relative points", () => {
    const a = arrow();
    const moved = moveElement(a, 10, 5);
    expect(moved).toMatchObject({ x: 10, y: 5, points: [[0, 0], [100, 0]] });
    expect(a.x).toBe(0);
  });

  it("shifts freedraw origins without mutating the original", () => {
    const f = freehand();
    const moved = moveElement(f, 3, 4);
    expect(moved).toMatchObject({ x: 3, y: 4, points: [[0, 0], [50, 0], [100, 0]] });
    expect(f.x).toBe(0);
  });
});

describe("decimatePoints", () => {
  it("keeps first/last and drops dense intermediates", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i * 0.5, y: 0 }));
    const out = decimatePoints(pts, 2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 5, y: 0 });
    expect(out.length).toBeLessThan(pts.length);
  });

  it("passes through short paths", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(decimatePoints(pts)).toEqual(pts);
  });
});

describe("resize handles", () => {
  it("exposes 8 handles for shapes", () => {
    expect(getResizeHandles(rect(0, 0, 100, 50))).toHaveLength(8);
  });

  it("exposes start/end/bend handles for arrows, honoring resolved overrides", () => {
    const a = arrow();
    const handles = getResizeHandles(a);
    expect(handles.map((h) => h.id)).toEqual(["start", "end", "bend"]);
    const resolved = getResizeHandles(a, undefined, {
      start: { x: 10, y: 10 },
      end: { x: 90, y: 10 },
    });
    expect(resolved[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("hit-tests handles within grab margin", () => {
    const h = hitTestHandle(rect(0, 0, 100, 100), { x: 2, y: 3 });
    expect(h?.id).toBe("nw");
    expect(hitTestHandle(rect(0, 0, 100, 100), { x: 50, y: 50 })).toBeNull();
  });
});

describe("resizeElement", () => {
  it("drags shape corners", () => {
    const out = resizeElement(rect(0, 0, 100, 100), "se", { x: 150, y: 120 });
    expect(out).toMatchObject({ x: 0, y: 0, width: 150, height: 120 });
  });

  it("normalizes negative sizes before resizing", () => {
    const out = resizeElement(rect(100, 100, -100, -100), "se", { x: 150, y: 120 });
    expect(out).toMatchObject({ x: 0, y: 0, width: 150, height: 120 });
  });

  it("clamps to a minimum box size", () => {
    const out = resizeElement(rect(0, 0, 100, 100), "se", { x: 1, y: 1 });
    expect(out).toMatchObject({ x: 0, y: 0, width: 8, height: 8 });
  });

  it("scales freedraw points about the anchored corner", () => {
    const out = resizeElement(freehand(), "e", { x: 200, y: 0 });
    if (out.type !== "freedraw") throw new Error("expected freedraw");
    expect(out.points[2]).toEqual([200, 0]);
  });

  it("moves arrow endpoints and detaches the dragged binding", () => {
    const bound = {
      ...arrow(),
      endBinding: { elementId: "s", gap: 4, focus: 0 },
    };
    const out = resizeElement(bound, "end", { x: 50, y: 50 });
    expect(out).toMatchObject({ endBinding: null });
    if (out.type !== "arrow") throw new Error("expected arrow");
    expect(out.points[out.points.length - 1]).toEqual([50, 50]);
  });
});

describe("dragBoxHandle", () => {
  it("follows the dragged edge and anchors the opposite", () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(dragBoxHandle(box, "w", { x: 20, y: 50 })).toMatchObject({ minX: 20, maxX: 100 });
    expect(dragBoxHandle(box, "n", { x: 50, y: 10 })).toMatchObject({ minY: 10, maxY: 100 });
  });
});

describe("boxesOverlap / unionBounds", () => {
  it("detects overlap", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boxesOverlap(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
    expect(boxesOverlap(a, { minX: 11, minY: 11, maxX: 20, maxY: 20 })).toBe(false);
  });

  it("unions boxes and returns null for empty", () => {
    expect(unionBounds([])).toBeNull();
    expect(
      unionBounds([
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { minX: 5, minY: -5, maxX: 8, maxY: 4 },
      ]),
    ).toEqual({ minX: 0, minY: -5, maxX: 10, maxY: 10 });
  });
});

describe("moveElements", () => {
  it("translates only the selected ids", () => {
    const els = [rect(0, 0, 10, 10, "a"), rect(50, 50, 10, 10, "b")];
    const out = moveElements(els, new Set(["a"]), 5, 5);
    expect(out[0]).toMatchObject({ x: 5, y: 5 });
    expect(out[1]).toMatchObject({ x: 50, y: 50 });
  });
});

describe("bent arrows", () => {
  const bentArrow = (): ExcalidrawArrowElement =>
    ({
      ...arrow(),
      points: P([0, 0], [50, 60], [100, 0]),
    }) as ExcalidrawArrowElement;

  it("exposes start/end/bend handles, bend defaulting to the midpoint", () => {
    const ids = getResizeHandles(arrow()).map((h) => h.id);
    expect(ids).toEqual(["start", "end", "bend"]);
    const bend = getResizeHandles(arrow()).find((h) => h.id === "bend");
    expect(bend).toMatchObject({ x: 50, y: 0 });
  });

  it("exposes one handle per waypoint once bent", () => {
    const bent = {
      ...arrow(),
      points: P([0, 0], [50, 60], [80, 60], [100, 0]),
    } as ExcalidrawArrowElement;
    expect(getResizeHandles(bent).map((h) => h.id)).toEqual(["start", "end", "wp-0", "wp-1"]);
  });

  it("dragging the bend handle creates the first waypoint without touching bindings", () => {
    const bound: ExcalidrawArrowElement = {
      ...arrow(),
      endBinding: { elementId: "s", gap: 4, focus: 0 },
    };
    const out = resizeElement(bound, "bend", { x: 60, y: 40 });
    if (out.type !== "arrow") throw new Error("expected arrow");
    expect(out.points).toEqual([[0, 0], [60, 40], [100, 0]]);
    expect(out).toMatchObject({ endBinding: { elementId: "s", gap: 4 } });
  });

  it("dragging a wp-i handle moves that waypoint only", () => {
    const bent = bentArrow();
    const twin = {
      ...arrow(),
      points: P([0, 0], [50, 60], [80, 60], [100, 0]),
    } as ExcalidrawArrowElement;
    const out = resizeElement(twin, "wp-1", { x: 80, y: 10 });
    if (out.type !== "arrow") throw new Error("expected arrow");
    expect(out.points).toEqual([[0, 0], [50, 60], [80, 10], [100, 0]]);
    expect(resizeElement(bent, "wp-9", { x: 0, y: 0 })).toBe(bent);
  });

  it("hit-tests the bent path, not the straight chord", () => {
    const bent = bentArrow();
    // Near the waypoint segment, far from the straight start→end line.
    expect(hitTestElement(bent, { x: 50, y: 55 })).toBe(true);
    expect(hitTestElement(bent, { x: 50, y: 30 })).toBe(false);
  });

  it("moves the origin with the arrow, keeping relative points", () => {
    const bent = bentArrow();
    const out = moveElement(bent, 10, 0);
    expect(out).toMatchObject({ x: 10, y: 0, points: [[0, 0], [50, 60], [100, 0]] });
  });

  it("replays waypoints relative to the resolved chord", () => {
    const bent = {
      ...arrow(),
      points: P([0, 0], [60, 60], [100, 0]),
    } as ExcalidrawArrowElement;
    // Stored mid is (50,0); resolved chord shifted by (+10,+5).
    const out = resolveConnectorWaypoints(bent, { start: { x: 10, y: 5 }, end: { x: 110, y: 5 } });
    expect(out).toEqual([{ x: 70, y: 65 }]);
  });

  it("round-trips resolved<->stored without drift for bound arrows", () => {
    const bent = {
      ...arrow(),
      points: P([0, 0], [60, 60], [100, 0]),
    } as ExcalidrawArrowElement;
    const resolved = { start: { x: 10, y: 5 }, end: { x: 110, y: 5 } };
    const onScreen = { x: 70, y: 65 };
    const stored = resolvedToStored(bent, resolved, onScreen);
    expect(stored).toEqual({ x: 60, y: 60 });
    expect(storedToResolved(bent, resolved, stored)).toEqual(onScreen);
  });

  it("drags bend/wp handles in resolved space without double-offset", () => {
    const bound = {
      ...arrow(),
      startBinding: { elementId: "s", gap: 4, focus: 0 },
    };
    // Resolved chord shifted by (+20,0) vs stored (e.g. bound shape moved).
    const resolved = { start: { x: 20, y: 0 }, end: { x: 120, y: 0 } };
    const out = resizeElement(bound, "bend", { x: 70, y: 40 }, resolved);
    // Stored = pointer minus chord delta (+20,0) -> (50,40); re-resolve lands back.
    if (out.type !== "arrow") throw new Error("expected arrow");
    expect(out.points).toEqual([[0, 0], [50, 40], [100, 0]]);
    const bent = bentArrow();
    const moved = resizeElement(
      bent,
      "wp-0",
      { x: 60, y: 10 },
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    );
    if (moved.type !== "arrow") throw new Error("expected arrow");
    expect(moved.points).toEqual([[0, 0], [60, 10], [100, 0]]);
  });

  it("inserts waypoints at the nearest segment and removes by index", () => {
    const a = arrow();
    const resolved = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const one = insertWaypointAt(a, { x: 25, y: 10 }, resolved);
    expect(one.points).toHaveLength(3);
    // Second insert on the later segment keeps path order.
    const two = insertWaypointAt(one, { x: 75, y: -10 }, resolved);
    expect(two.points).toHaveLength(4);
    expect(removeWaypointAt(two, 0).points).toHaveLength(3);
    expect(removeWaypointAt(two, 9)).toBe(two);
  });

  it("inserts on the painted curve between the right neighbors", () => {
    const bent = bentArrow();
    const resolved = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    // Click on the painted curve past the existing bend (second span).
    const flat = flattenSmoothPath([
      resolved.start,
      { x: 50, y: 60 },
      resolved.end,
    ]);
    const click = flat[Math.floor(flat.length * 0.75)];
    const out = insertWaypointAt(bent, click, resolved);
    expect(out.points).toHaveLength(4);
    // New point lands after the existing waypoint (path order kept).
    expect(out.points[1]).toEqual([50, 60]);
    // Re-resolving replays it back onto the click position.
    const rps = resolveConnectorWaypoints(out, resolved);
    const back = flattenSmoothPath([resolved.start, ...rps, resolved.end]);
    expect(distanceToPolyline(click, back)).toBeLessThan(1);
  });
});

describe("flattenSmoothPath", () => {
  it("returns straight paths as-is", () => {
    expect(flattenSmoothPath([])).toEqual([]);
    expect(
      flattenSmoothPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("keeps endpoints exact and bend points visibly on the line", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 0 },
    ];
    const flat = flattenSmoothPath(pts);
    expect(flat.length).toBeGreaterThan(pts.length);
    expect(flat[0]).toEqual(pts[0]);
    expect(flat[flat.length - 1]).toEqual(pts[pts.length - 1]);
    // Straight runs are exact; rounded corners stay within the handle glyph.
    expect(distanceToPolyline({ x: 25, y: 30 }, flat)).toBeLessThan(1e-6);
    for (const p of pts) {
      expect(distanceToPolyline(p, flat)).toBeLessThan(5);
    }
  });

  it("never leaves the control box (no overshoot)", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const flat = flattenSmoothPath(pts);
    const box = pathBounds(pts);
    const fbox = pathBounds(flat);
    expect(fbox.minX).toBeGreaterThanOrEqual(box.minX - 0.5);
    expect(fbox.minY).toBeGreaterThanOrEqual(box.minY - 0.5);
    expect(fbox.maxX).toBeLessThanOrEqual(box.maxX + 0.5);
    expect(fbox.maxY).toBeLessThanOrEqual(box.maxY + 0.5);
  });
});

describe("distanceToPolyline / pathBounds", () => {
  it("measures against the nearest segment", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(distanceToPolyline({ x: 100, y: 50 }, pts)).toBe(0);
    expect(distanceToPolyline({ x: 50, y: 50 }, pts)).toBe(50);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity);
  });

  it("bounds paths with padding", () => {
    expect(
      pathBounds(
        [
          { x: 10, y: 20 },
          { x: 30, y: 5 },
        ],
        2,
      ),
    ).toEqual({ minX: 8, minY: 3, maxX: 32, maxY: 22 });
    expect(pathBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("splitPathAtBox", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const box = { minX: 40, minY: -10, maxX: 60, maxY: 10 };

  it("splits a crossing path into two runs outside the box", () => {
    const runs = splitPathAtBox(line, box, 0);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1].x).toBeCloseTo(40, 6);
    expect(runs[1][0].x).toBeCloseTo(60, 6);
    expect(runs[0][0]).toEqual({ x: 0, y: 0 });
    expect(runs[1][runs[1].length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("expands the gap by pad", () => {
    const runs = splitPathAtBox(line, box, 5);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1].x).toBeCloseTo(35, 6);
    expect(runs[1][0].x).toBeCloseTo(65, 6);
  });

  it("returns a single run when there is no overlap", () => {
    const runs = splitPathAtBox(line, { minX: 200, minY: -10, maxX: 220, maxY: 10 }, 0);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
  });

  it("returns no runs when fully covered", () => {
    expect(splitPathAtBox(line, { minX: -10, minY: -10, maxX: 110, maxY: 10 }, 0)).toEqual([]);
    expect(splitPathAtBox([{ x: 0, y: 0 }], box, 0)).toEqual([]);
  });
});

describe("native accessors", () => {
  it("resolves absolute connector points from the x/y origin", () => {
    expect(connectorAbsolutePoints(arrow())).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("recomputes width/height when replacing relative points", () => {
    const out = withRelativePoints(arrow(), [
      [0, 0],
      [50, 50],
    ]);
    expect(out).toMatchObject({ width: 50, height: 50 });
  });

  it("rebases origins to the top-left and fixes negative sizes", () => {
    const conn = {
      ...arrow(),
      x: 100,
      y: 100,
      points: P([0, 0], [-40, -20]),
    } as ExcalidrawArrowElement;
    const rebased = normalizeElementOrigin(conn);
    expect(rebased).toMatchObject({ x: 60, y: 80, width: 40, height: 20 });
    if (rebased.type !== "arrow") throw new Error("expected arrow");
    expect(rebased.points).toEqual([
      [40, 20],
      [0, 0],
    ]);
    const neg = normalizeElementOrigin(rect(100, 100, -100, -100));
    expect(neg).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });
});
