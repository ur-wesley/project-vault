import { describe, expect, it } from "vitest";
import type { CanvasNodeDto } from "~/types/dto";
import {
  getWirePorts,
  resolveAnchoredGeometry,
  resolveWireGeometry,
  wirePathSamples,
  wirePreviewPath,
  type WireObstacle,
} from "./wireGeometry";

const node = (overrides: Partial<CanvasNodeDto> & { id: string }): CanvasNodeDto => ({
  nodeType: "task",
  title: overrides.id,
  x: 0,
  y: 0,
  width: 320,
  height: 220,
  ...overrides,
});

describe("wireGeometry", () => {
  it("exposes 4 ports per node", () => {
    expect(getWirePorts(node({ id: "a", x: 10, y: 20 }))).toHaveLength(4);
  });

  it("routes side-by-side nodes E -> W", () => {
    const g = resolveWireGeometry(node({ id: "s", x: 0, y: 0 }), node({ id: "t", x: 500, y: 0 }))!;
    expect(g.sourceSide).toBe("e");
    expect(g.targetSide).toBe("w");
    expect(g.x1).toBe(320);
    expect(g.x2).toBe(500);
  });

  it("flips to W -> E when target moves left of source", () => {
    const s = node({ id: "s", x: 500, y: 0 });
    const g = resolveWireGeometry(s, node({ id: "t", x: 0, y: 0 }))!;
    expect(g.sourceSide).toBe("w");
    expect(g.targetSide).toBe("e");
    expect(g.x1).toBe(500);
    expect(g.x2).toBe(320);
  });

  it("routes stacked nodes S -> N with vertical controls", () => {
    const g = resolveWireGeometry(node({ id: "s", x: 0, y: 0 }), node({ id: "t", x: 0, y: 500 }))!;
    expect(g.sourceSide).toBe("s");
    expect(g.targetSide).toBe("n");
    // Vertical tangents: controls share x with endpoints.
    expect(g.pathD).toContain(`C ${g.x1},`);
  });

  it("picks the true shortest pair on diagonal layouts", () => {
    const s = node({ id: "s", x: 0, y: 0 });
    const t = node({ id: "t", x: 400, y: 400 });
    const g = resolveWireGeometry(s, t)!;
    // S(port)->N(port) distance must equal the reported endpoint distance
    // and be shorter than the naive E->W distance.
    const naiveDx = 400 - 320;
    const naiveDy = 400 + 110 - 110;
    const naiveD2 = naiveDx * naiveDx + naiveDy * naiveDy;
    const dx = g.x2 - g.x1;
    const dy = g.y2 - g.y1;
    expect(dx * dx + dy * dy).toBeLessThan(naiveD2);
  });

  it("updates when a node moves (shortest side flips)", () => {
    const s = node({ id: "s", x: 0, y: 0 });
    const before = resolveWireGeometry(s, node({ id: "t", x: 500, y: 0 }))!;
    const after = resolveWireGeometry(s, node({ id: "t", x: 0, y: 500 }))!;
    expect(before.sourceSide).toBe("e");
    expect(after.sourceSide).toBe("s");
  });

  it("keeps pinned sides when a node grows (loader -> content)", () => {
    // Dokploy-style growth: target height 90 -> 500, diagonal layout where
    // a fresh contest would migrate E->W to E->N.
    const s = node({ id: "s", x: 100, y: 50, width: 300, height: 220 });
    const small = node({ id: "t", x: 600, y: 300, width: 300, height: 90 });
    const first = resolveWireGeometry(s, small)!;
    expect(first.sourceSide).toBe("e");
    expect(first.targetSide).toBe("w");
    const grown = node({ id: "t", x: 600, y: 300, width: 300, height: 500 });
    const unpinned = resolveWireGeometry(s, grown)!;
    // Sanity: without the pin this growth actually flips sides.
    expect([unpinned.sourceSide, unpinned.targetSide].join(">")).not.toBe("e>w");
    const pinned = resolveWireGeometry(s, grown, [], {
      sourceSide: first.sourceSide,
      targetSide: first.targetSide,
    })!;
    expect(pinned.sourceSide).toBe("e");
    expect(pinned.targetSide).toBe("w");
    // Endpoints ride the grown box edges.
    expect(pinned.x1).toBe(400);
    expect(pinned.x2).toBe(600);
    expect(pinned.y2).toBe(300 + 250);
  });

  it("flips pinned sides on genuine topology change", () => {
    const s = node({ id: "s", x: 500, y: 0 });
    const t = node({ id: "t", x: 0, y: 0 });
    const g = resolveWireGeometry(s, t, [], { sourceSide: "e", targetSide: "w" })!;
    expect(g.sourceSide).toBe("w");
    expect(g.targetSide).toBe("e");
  });

  it("builds a drag-preview curve without NaN", () => {
    const d = wirePreviewPath(100, 100, 300, 250);
    expect(d).toMatch(/^M 100,100 C/);
    expect(d).not.toMatch(/NaN/);
    expect(wirePreviewPath(50, 50, 50, 50)).toBe("M 50,50 L 50,50");
  });

  it("handles self-wires without NaN", () => {
    const s = node({ id: "s", x: 100, y: 100 });
    const g = resolveWireGeometry(s, s)!;
    expect(g.pathD).not.toMatch(/NaN/);
    expect(g.midX).toBeGreaterThan(g.x1);
  });

  it("ignores obstacles when none are passed (byte-identical path)", () => {
    const s = node({ id: "s", x: 0, y: 0 });
    const t = node({ id: "t", x: 500, y: 0 });
    const g = resolveWireGeometry(s, t)!;
    expect(g.pathD).toBe("M 320,110 C 383,110 437,110 500,110");
  });
});

describe("wireGeometry obstacle avoidance", () => {
  const rectOf = (n: CanvasNodeDto): WireObstacle => ({
    x: n.x,
    y: n.y,
    width: n.width ?? 320,
    height: n.height ?? 220,
  });

  const hitsRect = (pathD: string, o: WireObstacle, pad = 14): boolean =>
    wirePathSamples(pathD).some(
      (p) =>
        p.x > o.x - pad &&
        p.x < o.x + o.width + pad &&
        p.y > o.y - pad &&
        p.y < o.y + o.height + pad,
    );

  it("prefers a clean port pair over a shorter crossing one", () => {
    // Stacked nodes: S->N is shortest but the blocker sits on that corridor.
    const s = node({ id: "s", x: 0, y: 0 });
    const t = node({ id: "t", x: 0, y: 500 });
    const blocker = node({ id: "b", x: 100, y: 280, width: 120, height: 120 });
    const g = resolveWireGeometry(s, t, [rectOf(blocker)])!;
    expect(g.sourceSide).not.toBe("s");
    expect(hitsRect(g.pathD, rectOf(blocker))).toBe(false);
    // Single cubic is enough here — no detour segments needed.
    expect(g.pathD.match(/C /g)).toHaveLength(1);
  });

  it("bows around a node sitting directly between endpoints", () => {
    const s = node({ id: "s", x: 0, y: 0 });
    const t = node({ id: "t", x: 900, y: 0 });
    // Tall blocker covering every straight port-to-port corridor.
    const blocker = node({ id: "b", x: 350, y: -100, width: 400, height: 420 });
    const g = resolveWireGeometry(s, t, [rectOf(blocker)])!;
    expect(g.pathD).not.toMatch(/NaN/);
    expect(hitsRect(g.pathD, rectOf(blocker))).toBe(false);
    // Endpoints still dock on the node borders.
    expect(g.x1).toBeGreaterThanOrEqual(0);
    expect(g.x2).toBeLessThanOrEqual(900 + 320);
    // Badge anchor sits on the visible path, outside the blocker.
    const b = rectOf(blocker);
    const midInside =
      g.midX > b.x - 14 &&
      g.midX < b.x + b.width + 14 &&
      g.midY > b.y - 14 &&
      g.midY < b.y + b.height + 14;
    expect(midInside).toBe(false);
  });

  it("falls back to best effort when boxed in completely", () => {
    const s = node({ id: "s", x: 0, y: 0 });
    const t = node({ id: "t", x: 900, y: 0 });
    // Wall covering the whole middle plus far above/below — no detour fits.
    const wall = node({ id: "b", x: 300, y: -500, width: 650, height: 1200 });
    const g = resolveWireGeometry(s, t, [rectOf(wall)])!;
    expect(g.pathD).not.toMatch(/NaN/);
    expect(Number.isFinite(g.midX)).toBe(true);
    // Best effort: classic single cubic, never a broken chain.
    expect(g.pathD.match(/C /g)).toHaveLength(1);
  });

  it("preview bows around obstacles but still starts at the port", () => {
    const blocker = { x: 200, y: 50, width: 200, height: 120 };
    const d = wirePreviewPath(100, 110, 500, 110, [blocker]);
    expect(d).toMatch(/^M 100,110 C/);
    expect(d).not.toMatch(/NaN/);
    expect(hitsRect(d, blocker)).toBe(false);
  });

  it("preview ignores the node containing the cursor (drop target)", () => {
    // Cursor hovers the target node: no panicked swerve, plain curve.
    const target = { x: 400, y: 50, width: 200, height: 120 };
    const d = wirePreviewPath(100, 110, 500, 110, [target]);
    expect(d).toBe(wirePreviewPath(100, 110, 500, 110));
  });

  it("anchored data wires bow around blockers too", () => {
    const blocker = { x: 200, y: 50, width: 200, height: 120 };
    const g = resolveAnchoredGeometry(
      { x1: 100, y1: 110, nx1: 1, ny1: 0, x2: 500, y2: 110, nx2: -1, ny2: 0 },
      [blocker],
    );
    expect(g.pathD).not.toMatch(/NaN/);
    expect(hitsRect(g.pathD, blocker)).toBe(false);
  });

  it("anchored geometry without obstacles stays a plain cubic", () => {
    const g = resolveAnchoredGeometry({
      x1: 420,
      y1: 100,
      nx1: 1,
      ny1: 0,
      x2: 600,
      y2: 100,
      nx2: -1,
      ny2: 0,
    });
    expect(g.pathD).toMatch(/^M 420,100 C/);
  });
});
