import type { WhiteboardPoint } from "./types";

/**
 * Phase 2 rough rendering (whiteboard-excalidraw-parity steps 10-13).
 *
 * Local seeded jitter — no heavy `rough.js` dependency. `seed` drives a
 * `mulberry32` stream so the same element paints identically every frame.
 * `roughness`: 0 Architect (clean), 1 Artist (single jitter pass),
 * 2 Cartoonist (double stroke, larger amplitude).
 */

export type Roughness = 0 | 1 | 2;

/** Normalize unknown input to a valid roughness level (default 1). */
export function sanitizeRoughness(raw: unknown): Roughness {
  if (raw === 0 || raw === 1 || raw === 2) return raw;
  return 1;
}

/** Deterministic 32-bit hash of a seed (keeps tiny seeds from correlating). */
export function hashSeed(seed: number): number {
  let h = Math.floor(Number.isFinite(seed) ? seed : 0) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). Pure — same seed replays the same stream. */
export function mulberry32(seed: number): () => number {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter amplitude in px for a roughness level + stroke width. */
export function roughnessAmplitude(roughness: Roughness, strokeWidth: number): number {
  const w = Number.isFinite(strokeWidth) ? strokeWidth : 2;
  if (roughness === 0) return 0;
  if (roughness === 1) return Math.max(0.8, w * 0.35);
  return Math.max(1.6, w * 0.7);
}

/**
 * Corner radius for `roundness`: type 0 (sharp) = 0, type 3 (round) =
 * `min(32, min(w,h)/4)`. Types 1/2 (legacy Excalidraw intermediates) map to
 * a small radius so diamonds/ellipses stay smooth without popping.
 */
export function roundnessRadius(
  w: number,
  h: number,
  roundness: { type: 0 | 1 | 2 | 3; value?: number } | null | undefined,
): number {
  if (!roundness || roundness.type === 0) return 0;
  const m = Math.min(Math.abs(w), Math.abs(h));
  if (!Number.isFinite(m) || m <= 0) return 0;
  if (roundness.type === 3) return Math.min(32, m / 4);
  return Math.min(8, m / 8);
}

export interface JitterOpts {
  roughness: Roughness;
  seed: number;
  strokeWidth?: number;
  /** Extra pass for Cartoonist (roughness 2 draws twice). */
  pass?: number;
}

/**
 * Jitter a polyline deterministically: each interior point is offset
 * perpendicular by `(rand-0.5)*2*amplitude`. Endpoints stay fixed so
 * connectors keep glued endpoints. Pure — returns new points.
 */
export function jitterPoints(
  pts: WhiteboardPoint[],
  opts: JitterOpts,
): WhiteboardPoint[] {
  if (pts.length < 2 || opts.roughness === 0) return pts.slice();
  const amp = roughnessAmplitude(opts.roughness, opts.strokeWidth ?? 2);
  if (amp <= 0) return pts.slice();
  const rand = mulberry32(opts.seed + (opts.pass ?? 0) * 1013904223);
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return { ...p };
    const prev = pts[i - 1];
    const next = pts[i + 1] ?? p;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const off = (rand() - 0.5) * 2 * amp;
    return { x: p.x + nx * off, y: p.y + ny * off };
  });
}

/**
 * Subdivide long straight runs so hand jitter reads at any zoom:
 * inserts midpoints every ~24px. Pure.
 */
export function subdividePoints(pts: WhiteboardPoint[], step = 24): WhiteboardPoint[] {
  if (pts.length < 2) return pts.slice();
  const out: WhiteboardPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(dist / step);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    out.push(b);
  }
  return out;
}

/** How many stroke passes a roughness level needs (1 clean, 2 cartoon). */
export function roughPasses(roughness: Roughness): number {
  if (roughness === 2) return 2;
  return 1;
}

/**
 * Stroke a jittered polyline (open or closed). Applies the canvas dash
 * beforehand via the caller's `setLineDash` — jitter only moves points.
 */
export function strokeRoughPolyline(
  ctx: CanvasRenderingContext2D,
  pts: WhiteboardPoint[],
  opts: JitterOpts,
  close = false,
): void {
  const passes = roughPasses(opts.roughness);
  for (let pass = 0; pass < passes; pass++) {
    const dense = subdividePoints(pts);
    const jittered = jitterPoints(dense, { ...opts, pass });
    if (jittered.length === 0) return;
    const head = jittered[0];
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    for (let i = 1; i < jittered.length; i++) ctx.lineTo(jittered[i].x, jittered[i].y);
    if (close) ctx.closePath();
    ctx.stroke();
  }
}
