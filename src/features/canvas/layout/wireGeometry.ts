import type { CanvasNodeDto } from "~/types/dto";
import { DEFAULT_NODE_SIZE } from "../geometry/measuredSizes";

export type WireSide = "n" | "e" | "s" | "w";

export interface WirePort {
  side: WireSide;
  x: number;
  y: number;
  /** Outward unit normal for the side. */
  nx: number;
  ny: number;
}

export interface WireGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sourceSide: WireSide;
  targetSide: WireSide;
  pathD: string;
  midX: number;
  midY: number;
}

/** Third-party node box (world coords) a wire must route around. */
export interface WireObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pt {
  x: number;
  y: number;
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const DEFAULT_W = DEFAULT_NODE_SIZE.width;
const DEFAULT_H = DEFAULT_NODE_SIZE.height;

/** Clearance kept between a wire and any node it doesn't connect to. */
const OBSTACLE_PAD = 14;
/** How far outside a blocker's padded box a detour waypoint sits. */
const WAYPOINT_CLEAR = 32;
/** Samples near an endpoint are ignored by hit-testing (ports sit on borders). */
const END_CLEAR = 4;
/** Samples per cubic when testing / flattening. */
const TEST_SAMPLES = 24;
/** Extra score added per intersected obstacle when picking a port pair. */
const CROSSING_PENALTY = 5000;

function dims(node: CanvasNodeDto): { w: number; h: number } {
  return { w: node.width || DEFAULT_W, h: node.height || DEFAULT_H };
}

/** Four edge-midpoint ports (N/E/S/W) with outward normals. */
export function getWirePorts(node: CanvasNodeDto): WirePort[] {
  const { w, h } = dims(node);
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;
  return [
    { side: "e", x: node.x + w, y: cy, nx: 1, ny: 0 },
    { side: "w", x: node.x, y: cy, nx: -1, ny: 0 },
    { side: "s", x: cx, y: node.y + h, nx: 0, ny: 1 },
    { side: "n", x: cx, y: node.y, nx: 0, ny: -1 },
  ];
}

// ---------------------------------------------------------------------------
// Obstacle geometry helpers
// ---------------------------------------------------------------------------

function inflate(o: WireObstacle, pad: number): Rect {
  return {
    minX: o.x - pad,
    minY: o.y - pad,
    maxX: o.x + o.width + pad,
    maxY: o.y + o.height + pad,
  };
}

function pointInRect(p: Pt, r: Rect): boolean {
  return p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
}

function pointInObstacle(p: Pt, o: WireObstacle): boolean {
  return p.x > o.x && p.x < o.x + o.width && p.y > o.y && p.y < o.y + o.height;
}

function segSegInt(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return false;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const corners: Pt[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    if (segSegInt(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

function cubicAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

function flattenCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(cubicAt(p0, c1, c2, p3, i / n));
  return pts;
}

function nearEndpoint(p: Pt, start: Pt, end: Pt): boolean {
  const dxs = p.x - start.x;
  const dys = p.y - start.y;
  if (dxs * dxs + dys * dys < END_CLEAR * END_CLEAR) return true;
  const dxe = p.x - end.x;
  const dye = p.y - end.y;
  return dxe * dxe + dye * dye < END_CLEAR * END_CLEAR;
}

/**
 * Count how many obstacle rects a flattened path touches. Samples within
 * END_CLEAR of either endpoint are ignored so ports docking on borders
 * don't self-report as hits.
 */
function countHits(samples: Pt[], rects: Rect[]): { hits: number; blockers: number[] } {
  if (samples.length === 0 || rects.length === 0) return { hits: 0, blockers: [] };
  const start = samples[0];
  const end = samples[samples.length - 1];
  const blockers: number[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    let hit = false;
    let prev: Pt | null = null;
    for (const p of samples) {
      if (nearEndpoint(p, start, end)) {
        prev = p;
        continue;
      }
      if (pointInRect(p, r)) {
        hit = true;
        break;
      }
      if (prev && !nearEndpoint(prev, start, end) && segHitsRect(prev, p, r)) {
        hit = true;
        break;
      }
      prev = p;
    }
    if (hit) blockers.push(i);
  }
  return { hits: blockers.length, blockers };
}

function unionRect(rects: Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function clampArm(len: number, scale: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, len * scale));
}

// ---------------------------------------------------------------------------
// Smooth multi-segment chains
// ---------------------------------------------------------------------------

interface Chain {
  pathD: string;
  samples: Pt[];
  length: number;
}

function fmt(n: number): number {
  // Round to 2 decimals so path strings stay stable/diffable.
  return Math.round(n * 100) / 100;
}

function ptLen(a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a smooth chained cubic through `points`. When `dockEnds` is true,
 * end tangents follow the port normals (so wires dock cleanly); detours
 * pass false so end arms follow the travel direction instead — a
 * port-normal arm would shove the curve sideways into the very blocker
 * being avoided when the port sits close to it.
 */
function buildChain(points: Pt[], sN: Pt, tN: Pt, armScale: number, dockEnds = true): Chain {
  const segs: { p0: Pt; c1: Pt; c2: Pt; p3: Pt }[] = [];
  const dirs: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const len = ptLen(points[i], points[i + 1]);
    if (len < 0.5) dirs.push({ x: 1, y: 0 });
    else
      dirs.push({
        x: (points[i + 1].x - points[i].x) / len,
        y: (points[i + 1].y - points[i].y) / len,
      });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p3 = points[i + 1];
    const len = ptLen(p0, p3);
    const last = i === points.length - 2;
    const c1 =
      i === 0 && dockEnds
        ? {
            x: p0.x + sN.x * clampArm(len, armScale, 30, 160),
            y: p0.y + sN.y * clampArm(len, armScale, 30, 160),
          }
        : {
            x: p0.x + (i === 0 ? dirs[0].x : dirs[i - 1].x) * clampArm(len, 0.3, 12, 120),
            y: p0.y + (i === 0 ? dirs[0].y : dirs[i - 1].y) * clampArm(len, 0.3, 12, 120),
          };
    const c2 =
      last && dockEnds
        ? {
            x: p3.x + tN.x * clampArm(len, armScale, 30, 160),
            y: p3.y + tN.y * clampArm(len, armScale, 30, 160),
          }
        : {
            x: p3.x - dirs[i].x * clampArm(len, 0.3, 12, 120),
            y: p3.y - dirs[i].y * clampArm(len, 0.3, 12, 120),
          };
    segs.push({ p0, c1, c2, p3 });
  }

  let pathD = `M ${fmt(segs[0].p0.x)},${fmt(segs[0].p0.y)}`;
  const samples: Pt[] = [];
  let length = 0;
  for (const s of segs) {
    pathD += ` C ${fmt(s.c1.x)},${fmt(s.c1.y)} ${fmt(s.c2.x)},${fmt(s.c2.y)} ${fmt(s.p3.x)},${fmt(s.p3.y)}`;
    const flat = flattenCubic(s.p0, s.c1, s.c2, s.p3, 16);
    // Skip the joint duplicate (first sample == previous segment's last).
    for (let i = 0; i < flat.length; i++) {
      if (samples.length > 0 && i === 0) continue;
      if (samples.length > 0) length += ptLen(samples[samples.length - 1], flat[i]);
      samples.push(flat[i]);
    }
  }
  return { pathD, samples, length };
}

/** Candidate detour waypoints: side bypasses per blocker + union-box corners. */
function bypassPoints(blockerRects: Rect[]): Pt[] {
  const pts: Pt[] = [];
  for (const r of blockerRects) {
    const cx = (r.minX + r.maxX) / 2;
    const cy = (r.minY + r.maxY) / 2;
    pts.push(
      { x: cx, y: r.minY - WAYPOINT_CLEAR },
      { x: cx, y: r.maxY + WAYPOINT_CLEAR },
      { x: r.minX - WAYPOINT_CLEAR, y: cy },
      { x: r.maxX + WAYPOINT_CLEAR, y: cy },
    );
  }
  const u = unionRect(blockerRects);
  pts.push(
    { x: u.minX - WAYPOINT_CLEAR, y: u.minY - WAYPOINT_CLEAR },
    { x: u.maxX + WAYPOINT_CLEAR, y: u.minY - WAYPOINT_CLEAR },
    { x: u.minX - WAYPOINT_CLEAR, y: u.maxY + WAYPOINT_CLEAR },
    { x: u.maxX + WAYPOINT_CLEAR, y: u.maxY + WAYPOINT_CLEAR },
  );
  return pts;
}

/** Two-point corridors running past the union box on each side. */
function corridorPairs(u: Rect, start: Pt, end: Pt): Pt[][] {
  const above = u.minY - WAYPOINT_CLEAR;
  const below = u.maxY + WAYPOINT_CLEAR;
  const left = u.minX - WAYPOINT_CLEAR;
  const right = u.maxX + WAYPOINT_CLEAR;
  return [
    [
      { x: start.x, y: above },
      { x: end.x, y: above },
    ],
    [
      { x: start.x, y: below },
      { x: end.x, y: below },
    ],
    [
      { x: left, y: start.y },
      { x: left, y: end.y },
    ],
    [
      { x: right, y: start.y },
      { x: right, y: end.y },
    ],
  ];
}

interface RoutedPath {
  pathD: string;
  samples: Pt[];
}

/**
 * Route start→end as a smooth curve that avoids `rects`. Tries the direct
 * cubic first (fast path — identical output to the old code when clean),
 * then single-waypoint bypasses, then two-point corridors. Falls back to
 * the least-bad candidate so the result is never worse than the direct
 * curve by (hits, length).
 */
function routeAvoiding(
  start: Pt,
  end: Pt,
  sN: Pt,
  tN: Pt,
  rects: Rect[],
  armScale: number,
): RoutedPath {
  const direct = buildChain([start, end], sN, tN, armScale);
  const dTest = countHits(direct.samples, rects);
  if (dTest.hits === 0 || rects.length === 0) {
    return { pathD: direct.pathD, samples: direct.samples };
  }

  let best = { hits: dTest.hits, len: direct.length, pathD: direct.pathD, samples: direct.samples };
  const consider = (via: Pt[]) => {
    const pts = [start, ...via, end].filter(
      (p, i, arr) => i === 0 || ptLen(arr[i - 1], p) > END_CLEAR * 2,
    );
    if (pts.length < 2) return;
    const chain = buildChain(pts, sN, tN, armScale, false);
    const t = countHits(chain.samples, rects);
    if (t.hits < best.hits || (t.hits === best.hits && chain.length < best.len)) {
      best = { hits: t.hits, len: chain.length, pathD: chain.pathD, samples: chain.samples };
    }
  };

  const blockers = dTest.blockers.map((i) => rects[i]);
  for (const w of bypassPoints(blockers)) consider([w]);
  if (best.hits > 0) {
    const u = unionRect(blockers);
    for (const pair of corridorPairs(u, start, end)) consider(pair);
  }
  return { pathD: best.pathD, samples: best.samples };
}

function cubicMid(
  x1: number,
  y1: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  // Cubic Bezier at t=0.5: (P0 + 3*C1 + 3*C2 + P3) / 8
  return {
    x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    y: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
  };
}

export interface AnchoredWireInput {
  x1: number;
  y1: number;
  /** Outward unit normal at the source port. */
  nx1: number;
  ny1: number;
  x2: number;
  y2: number;
  /** Outward unit normal at the target port. */
  nx2: number;
  ny2: number;
}

export interface AnchoredGeometry {
  pathD: string;
  midX: number;
  midY: number;
}

/**
 * Cubic between two fixed ports (named dataflow ports anchor to exact
 * points, not edge midpoints). When obstacles are passed and the direct
 * curve would cut through a node, a smooth detour is routed around the
 * blockers instead. Pure + deterministic.
 */
export function resolveAnchoredGeometry(
  a: AnchoredWireInput,
  obstacles: WireObstacle[] = [],
): AnchoredGeometry {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const k = Number.isFinite(dist) ? Math.min(160, Math.max(30, dist * 0.35)) : 30;
  const c1x = a.x1 + a.nx1 * k;
  const c1y = a.y1 + a.ny1 * k;
  const c2x = a.x2 + a.nx2 * k;
  const c2y = a.y2 + a.ny2 * k;
  const mid = cubicMid(a.x1, a.y1, c1x, c1y, c2x, c2y, a.x2, a.y2);
  const directD = `M ${a.x1},${a.y1} C ${c1x},${c1y} ${c2x},${c2y} ${a.x2},${a.y2}`;
  const classic = { pathD: directD, midX: mid.x, midY: mid.y };

  const rects = obstacles.map((o) => inflate(o, OBSTACLE_PAD));
  if (rects.length === 0) return classic;
  const directFlat = flattenCubic(
    { x: a.x1, y: a.y1 },
    { x: c1x, y: c1y },
    { x: c2x, y: c2y },
    { x: a.x2, y: a.y2 },
    TEST_SAMPLES,
  );
  if (countHits(directFlat, rects).hits === 0) return classic;

  const routed = routeAvoiding(
    { x: a.x1, y: a.y1 },
    { x: a.x2, y: a.y2 },
    { x: a.nx1, y: a.ny1 },
    { x: a.nx2, y: a.ny2 },
    rects,
    0.35,
  );
  if (countHits(routed.samples, rects).hits > 0) return classic;
  const midPt = routed.samples[Math.floor(routed.samples.length / 2)];
  return { pathD: routed.pathD, midX: midPt.x, midY: midPt.y };
}

/**
 * Flatten one of our `M … C …` wire paths back into samples. Exported for
 * tests and for hit-testing rendered wires.
 */
export function wirePathSamples(pathD: string, perSeg = 16): Pt[] {
  const nums = pathD.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 2) return [];
  const pairs: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pairs.push({ x: nums[i], y: nums[i + 1] });
  const start = pairs[0];
  const segs: Pt[][] = [];
  for (let i = 1; i + 2 < pairs.length; i += 3) {
    segs.push([pairs[i], pairs[i + 1], pairs[i + 2]]);
  }
  if (segs.length === 0) return pairs;
  const out: Pt[] = [];
  let cursor = start;
  for (const [c1, c2, p3] of segs) {
    const flat = flattenCubic(cursor, c1, c2, p3, perSeg);
    for (let i = 0; i < flat.length; i++) {
      if (out.length > 0 && i === 0) continue;
      out.push(flat[i]);
    }
    cursor = p3;
  }
  return out;
}

/**
 * Drag-preview curve from a fixed source port to the live cursor point.
 * Direction-agnostic: control arms point along the start→cursor axis, so
 * the preview never S-curves no matter which side the drag started from.
 * When obstacles are passed, the preview bows around nodes instead of
 * cutting through them. Pure — safe to call on every pointermove.
 */
export function wirePreviewPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: WireObstacle[] = [],
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(dist) || dist < 0.5) return `M ${x1},${y1} L ${x2},${y2}`;
  const ux = dx / dist;
  const uy = dy / dist;
  const k = Math.min(160, Math.max(30, dist * 0.25));
  const c1x = x1 + ux * k;
  const c1y = y1 + uy * k;
  const c2x = x2 - ux * k;
  const c2y = y2 - uy * k;
  // Fast path: no obstacles, or the direct curve is already clean.
  const rects = obstacles.map((o) => inflate(o, OBSTACLE_PAD));
  if (rects.length === 0) return `M ${x1},${y1} C ${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  const start = { x: x1, y: y1 };
  const end = { x: x2, y: y2 };
  // The source node and a hovered drop-target node contain the endpoints —
  // they must not count as blockers, or the preview would swerve away from
  // the very node being connected.
  const relevant = rects.filter((_, i) => {
    const o = obstacles[i];
    return !pointInObstacle(start, o) && !pointInObstacle(end, o);
  });
  if (relevant.length === 0) return `M ${x1},${y1} C ${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  const straight = flattenCubic(start, { x: c1x, y: c1y }, { x: c2x, y: c2y }, end, TEST_SAMPLES);
  if (countHits(straight, relevant).hits === 0) {
    return `M ${x1},${y1} C ${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  }
  const routed = routeAvoiding(start, end, { x: ux, y: uy }, { x: -ux, y: -uy }, relevant, 0.25);
  return routed.pathD;
}

/**
 * Contest score for one N/E/S/W pair. Legacy: pure distance-squared. With
 * obstacles, linear distance plus a per-crossing penalty, so a slightly
 * longer clean pair always beats a short one cutting through nodes
 * (d2 gaps would dwarf any penalty). Shared by the fresh pick and the
 * sticky comparison so both speak the same metric.
 */
function pairScore(s: WirePort, t: WirePort, rects: Rect[]): number {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const d2 = dx * dx + dy * dy;
  if (rects.length === 0) return d2;
  const dist = Math.sqrt(d2);
  if (!Number.isFinite(dist)) return d2;
  const k = Math.min(160, Math.max(30, dist * 0.35));
  const flat = flattenCubic(
    { x: s.x, y: s.y },
    { x: s.x + s.nx * k, y: s.y + s.ny * k },
    { x: t.x + t.nx * k, y: t.y + t.ny * k },
    { x: t.x, y: t.y },
    TEST_SAMPLES,
  );
  return dist + countHits(flat, rects).hits * CROSSING_PENALTY;
}

/**
 * Pin for a previously chosen N/E/S/W pair. Recomputed wires stay on their
 * current sides unless another pair wins by a clear margin — without this,
 * every node resize (e.g. a loader swapping to content) re-runs the
 * 16-pair contest and endpoints visibly migrate between sides.
 */
export interface WireSidePin {
  sourceSide: WireSide;
  targetSide: WireSide;
}

/**
 * A challenger pair must beat the pinned pair by this ratio to take over.
 * Direction reversals (scores differ by orders of magnitude) still flip;
 * resize jitter (scores within a factor of two) sticks.
 */
const STICKY_FLIP_RATIO = 0.5;

/**
 * Pick the best of the 16 N/E/S/W port pairs and build an
 * orientation-aware smooth curve. Pairs whose curve would cut through an
 * obstacle node are penalized, so a slightly longer clean pair wins over a
 * short crossing one; when every pair crosses, a detour is routed around
 * the blockers. Pure + deterministic (first-pair-wins ties), so callers
 * re-running it on every position change get live updates.
 *
 * `obstacles` are third-party node boxes in world coords — pass every node
 * except source/target (their own boxes are excluded by the caller).
 *
 * `stickTo` pins the previously chosen pair: it wins unless another pair
 * beats it by STICKY_FLIP_RATIO, so endpoints ride the box edges on resize
 * instead of migrating between sides. Omit it for a fresh pick (creation,
 * tests) — output is then identical to the unpinned contest.
 */
export function resolveWireGeometry(
  source: CanvasNodeDto,
  target: CanvasNodeDto,
  obstacles: WireObstacle[] = [],
  stickTo?: WireSidePin | null,
): WireGeometry | null {
  if (!source || !target) return null;

  // Self-wire: small loop off the east side so it never collapses to NaN.
  if (source.id === target.id) {
    const { w, h } = dims(source);
    const x1 = source.x + w;
    const y1 = source.y + h / 2;
    const loop = Math.max(40, Math.min(80, w * 0.2));
    return {
      x1,
      y1,
      x2: x1,
      y2: y1,
      sourceSide: "e",
      targetSide: "e",
      pathD: `M ${x1},${y1} ` + `C ${x1 + loop},${y1 - loop} ${x1 + loop},${y1 + loop} ${x1},${y1}`,
      midX: x1 + loop,
      midY: y1,
    };
  }

  const rects = obstacles.map((o) => inflate(o, OBSTACLE_PAD));
  const sPorts = getWirePorts(source);
  const tPorts = getWirePorts(target);

  let best: { s: WirePort; t: WirePort; score: number } | null = null;
  for (const s of sPorts) {
    for (const t of tPorts) {
      const score = pairScore(s, t, rects);
      if (!best || score < best.score) best = { s, t, score };
    }
  }
  if (!best) return null;

  // Sticky sides: keep the pinned pair unless a challenger wins clearly.
  // Resize jitter changes scores by tens of percent (sticks); genuine
  // topology changes differ by orders of magnitude (flips).
  let chosen = best;
  if (stickTo) {
    const ss = sPorts.find((p) => p.side === stickTo.sourceSide);
    const tt = tPorts.find((p) => p.side === stickTo.targetSide);
    if (ss && tt) {
      const stickyScore = pairScore(ss, tt, rects);
      if (Number.isFinite(stickyScore) && !(best.score < stickyScore * STICKY_FLIP_RATIO)) {
        chosen = { s: ss, t: tt, score: stickyScore };
      }
    }
  }

  const { s, t } = chosen;
  const dist = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2);
  if (!Number.isFinite(dist)) return null;

  // Control-arm length scales with endpoint distance, clamped so near
  // nodes stay tight and far nodes don't overshoot into S-curves.
  const k = Math.min(160, Math.max(30, dist * 0.35));
  const c1x = s.x + s.nx * k;
  const c1y = s.y + s.ny * k;
  const c2x = t.x + t.nx * k;
  const c2y = t.y + t.ny * k;
  const mid = cubicMid(s.x, s.y, c1x, c1y, c2x, c2y, t.x, t.y);
  const directD = `M ${s.x},${s.y} C ${c1x},${c1y} ${c2x},${c2y} ${t.x},${t.y}`;

  const classic = {
    x1: s.x,
    y1: s.y,
    x2: t.x,
    y2: t.y,
    sourceSide: s.side,
    targetSide: t.side,
    pathD: directD,
    midX: mid.x,
    midY: mid.y,
  };

  if (rects.length === 0) return classic;

  // Fast path: the direct curve is already clean — keep the classic output
  // byte-identical so unaffected wires never shift.
  const directFlat = flattenCubic(
    { x: s.x, y: s.y },
    { x: c1x, y: c1y },
    { x: c2x, y: c2y },
    { x: t.x, y: t.y },
    TEST_SAMPLES,
  );
  if (countHits(directFlat, rects).hits === 0) return classic;

  const routed = routeAvoiding(
    { x: s.x, y: s.y },
    { x: t.x, y: t.y },
    { x: s.nx, y: s.ny },
    { x: t.nx, y: t.ny },
    rects,
    0.35,
  );
  if (countHits(routed.samples, rects).hits > 0) {
    // No clean detour exists (dense cluster) — best effort, keep classic.
    return classic;
  }
  const samples = routed.samples;
  const midPt = samples[Math.floor(samples.length / 2)];
  return {
    x1: s.x,
    y1: s.y,
    x2: t.x,
    y2: t.y,
    sourceSide: s.side,
    targetSide: t.side,
    pathD: routed.pathD,
    midX: midPt.x,
    midY: midPt.y,
  };
}
