import { describe, it, expect } from "vitest";
import {
  sanitizeRoughness,
  hashSeed,
  mulberry32,
  roughnessAmplitude,
  roundnessRadius,
  jitterPoints,
  subdividePoints,
  roughPasses,
  strokeRoughPolyline,
} from "./rough";
import { roundnessForToggle, isRoundRoundnessFor } from "./excalidrawDefaults";

function stubCtx() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          calls.push(String(prop));
          void args;
          return undefined;
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("sanitizeRoughness", () => {
  it("keeps 0/1/2 and defaults to 1", () => {
    expect(sanitizeRoughness(0)).toBe(0);
    expect(sanitizeRoughness(1)).toBe(1);
    expect(sanitizeRoughness(2)).toBe(2);
    expect(sanitizeRoughness(9)).toBe(1);
    expect(sanitizeRoughness("x")).toBe(1);
  });
});

describe("seeded rng", () => {
  it("replays the same stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(hashSeed(7)).toBe(hashSeed(7));
    expect(hashSeed(7)).not.toBe(hashSeed(8));
  });
});

describe("roughnessAmplitude", () => {
  it("is zero for Architect and grows with level", () => {
    expect(roughnessAmplitude(0, 2)).toBe(0);
    expect(roughnessAmplitude(1, 2)).toBeGreaterThan(0);
    expect(roughnessAmplitude(2, 2)).toBeGreaterThan(roughnessAmplitude(1, 2));
  });
});

describe("roundnessRadius", () => {
  it("maps type 0 to sharp and type 3 to min(32, min(w,h)/4)", () => {
    expect(roundnessRadius(100, 100, { type: 0 })).toBe(0);
    expect(roundnessRadius(100, 100, null)).toBe(0);
    expect(roundnessRadius(100, 80, { type: 3 })).toBe(20);
    expect(roundnessRadius(400, 400, { type: 3 })).toBe(32);
    expect(roundnessForToggle("rectangle", true)).toEqual({ type: 3 });
    expect(roundnessForToggle("ellipse", true)).toEqual({ type: 2 });
    expect(roundnessForToggle("rectangle", false)).toEqual({ type: 0 });
    expect(isRoundRoundnessFor({ type: 3 })).toBe(true);
    expect(isRoundRoundnessFor({ type: 0 })).toBe(false);
    expect(isRoundRoundnessFor(null)).toBe(false);
  });
});

describe("jitterPoints", () => {
  it("keeps endpoints fixed and is deterministic", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const a = jitterPoints(pts, { roughness: 1, seed: 5, strokeWidth: 2 });
    const b = jitterPoints(pts, { roughness: 1, seed: 5, strokeWidth: 2 });
    expect(a).toEqual(b);
    expect(a[0]).toEqual({ x: 0, y: 0 });
    expect(a[2]).toEqual({ x: 100, y: 0 });
    expect(jitterPoints(pts, { roughness: 0, seed: 5 })).toEqual(pts);
  });
});

describe("subdividePoints", () => {
  it("inserts midpoints on long runs", () => {
    const out = subdividePoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      24,
    );
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
  });
});

describe("strokeRoughPolyline", () => {
  it("strokes once for Artist and twice for Cartoonist", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 60, y: 10 },
      { x: 120, y: 0 },
    ];
    const one = stubCtx();
    strokeRoughPolyline(one.ctx, pts, { roughness: 1, seed: 1, strokeWidth: 2 });
    const two = stubCtx();
    strokeRoughPolyline(two.ctx, pts, { roughness: 2, seed: 1, strokeWidth: 2 });
    expect(roughPasses(1)).toBe(1);
    expect(roughPasses(2)).toBe(2);
    const strokes = (c: string[]) => c.filter((k) => k === "stroke").length;
    expect(strokes(two.calls)).toBe(strokes(one.calls) * 2);
  });

  it("closes the loop for shape outlines and skips empty paths", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 60, y: 10 },
      { x: 120, y: 0 },
    ];
    const closed = stubCtx();
    strokeRoughPolyline(closed.ctx, pts, { roughness: 1, seed: 1, strokeWidth: 2 }, true);
    expect(closed.calls).toContain("closePath");
    const empty = stubCtx();
    strokeRoughPolyline(empty.ctx, [], { roughness: 1, seed: 1, strokeWidth: 2 });
    expect(empty.calls).not.toContain("stroke");
  });
});

describe("jitter bounds", () => {
  it("offsets stay within the amplitude envelope", () => {
    const pts = Array.from({ length: 9 }, (_, i) => ({ x: i * 10, y: 0 }));
    const amp = roughnessAmplitude(2, 2);
    const out = jitterPoints(pts, { roughness: 2, seed: 99, strokeWidth: 2 });
    for (const [i, p] of out.entries()) {
      if (i === 0 || i === out.length - 1) continue;
      expect(Math.abs(p.y - pts[i].y)).toBeLessThanOrEqual(amp + 1e-9);
    }
  });

  it("different passes draw different strokes for Cartoonist", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const pass0 = jitterPoints(pts, { roughness: 2, seed: 7, strokeWidth: 2, pass: 0 });
    const pass1 = jitterPoints(pts, { roughness: 2, seed: 7, strokeWidth: 2, pass: 1 });
    expect(pass1).not.toEqual(pass0);
  });
});
