import type { WhiteboardElement, WhiteboardPoint } from "./types";
import { MAX_WAYPOINTS } from "./serialize";
import { measureTextBlock } from "./textMeasure";

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function distanceToSegment(
  p: WhiteboardPoint,
  a: WhiteboardPoint,
  b: WhiteboardPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function normalizeBox(start: WhiteboardPoint, end: WhiteboardPoint): BoundingBox {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

/** Diamond vertices for a normalized box: top, right, bottom, left. */
export function diamondVertices(box: BoundingBox): WhiteboardPoint[] {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return [
    { x: cx, y: box.minY },
    { x: box.maxX, y: cy },
    { x: cx, y: box.maxY },
    { x: box.minX, y: cy },
  ];
}

function pointInPolygon(pt: WhiteboardPoint, poly: WhiteboardPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygon(pt: WhiteboardPoint, poly: WhiteboardPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

export function getElementBounds(el: WhiteboardElement): BoundingBox {
  switch (el.kind) {
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "arrow":
    case "line":
      return normalizeBox(el.start, el.end);
    case "freehand": {
      if (el.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      let minX = el.points[0].x;
      let minY = el.points[0].y;
      let maxX = el.points[0].x;
      let maxY = el.points[0].y;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case "text": {
      const wrap = el.width ?? null;
      const block = measureTextBlock(el.text, el.fontSize, wrap);
      const w = Math.max(block.width, el.width ?? block.width);
      return {
        minX: el.position.x,
        minY: el.position.y,
        maxX: el.position.x + w,
        maxY: el.position.y + block.height,
      };
    }
  }
}

/** Minimum distance from a point to a polyline. */
export function distanceToPolyline(pt: WhiteboardPoint, pts: WhiteboardPoint[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(pt.x - pts[0].x, pt.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pt, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Max corner-rounding radius (px) for smooth connectors. */
export const CORNER_RADIUS = 10;
/** Samples per rounded corner when flattening. */
export const FILLET_STEPS = 8;

export interface FlattenedPath {
  /** Dense painted polyline (endpoints exact, corners rounded). */
  points: WhiteboardPoint[];
  /** Sparse span index for each dense segment (for waypoint insertion). */
  spans: number[];
}

/**
 * Flatten a connector control path into a dense polyline: straight runs
 * stay perfectly straight, corners are rounded with a bounded radius, so
 * bend handles always sit visibly on the painted line (max ~4px inside
 * sharp corners, exact everywhere else). Paint, hit-test, selection and
 * label anchors all use this. Paths with ≤2 points are returned as-is.
 */
export function flattenSmoothPathDetailed(
  pts: WhiteboardPoint[],
  cornerRadius: number = CORNER_RADIUS,
): FlattenedPath {
  if (pts.length <= 2)
    return { points: pts.map((p) => ({ ...p })), spans: pts.length < 2 ? [] : [0] };
  // Per-joint cut radius: capped so adjacent fillets never overlap.
  const radii: number[] = Array.from({ length: pts.length }, () => 0);
  for (let i = 1; i < pts.length - 1; i++) {
    const lPrev = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const lNext = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    radii[i] = Math.min(cornerRadius, 0.25 * lPrev, 0.25 * lNext);
  }
  const points: WhiteboardPoint[] = [{ ...pts[0] }];
  const spans: number[] = [];
  const push = (p: WhiteboardPoint, span: number) => {
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) return;
    points.push({ ...p });
    spans.push(span);
  };
  // Walk span by span: fillet around the start joint, then a straight run
  // to the next joint's cut point (or the span end).
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // 1. Quadratic fillet around joint a (i > 0 with a cut radius).
    if (i > 0 && radii[i] > 1e-9) {
      const pa = pts[i - 1];
      const lIn = Math.hypot(a.x - pa.x, a.y - pa.y);
      const cIn = {
        x: a.x - ((a.x - pa.x) / lIn) * radii[i],
        y: a.y - ((a.y - pa.y) / lIn) * radii[i],
      };
      const cOut = {
        x: a.x + ((b.x - a.x) / len) * radii[i],
        y: a.y + ((b.y - a.y) / len) * radii[i],
      };
      push(cIn, i - 1);
      for (let j = 1; j <= FILLET_STEPS; j++) {
        const t = j / FILLET_STEPS;
        const u = 1 - t;
        // First half of the fillet belongs to the incoming span, the
        // second half to the outgoing one (insertion keeps path order).
        push(
          {
            x: u * u * cIn.x + 2 * u * t * a.x + t * t * cOut.x,
            y: u * u * cIn.y + 2 * u * t * a.y + t * t * cOut.y,
          },
          j * 2 <= FILLET_STEPS ? i - 1 : i,
        );
      }
    }
    // 2. Straight run to the next joint's cut point (or the span end).
    // The cut retreats along THIS span's direction (ux, uy).
    let exit = b;
    if (i + 1 < pts.length - 1 && radii[i + 1] > 1e-9) {
      exit = {
        x: b.x - ux * radii[i + 1],
        y: b.y - uy * radii[i + 1],
      };
    }
    push(exit, i);
  }
  return { points, spans };
}

/** Dense painted polyline for a connector control path (see detailed). */
export function flattenSmoothPath(pts: WhiteboardPoint[]): WhiteboardPoint[] {
  return flattenSmoothPathDetailed(pts).points;
}

/** Liang-Barsky interval of a segment inside an axis-aligned box, or null. */
function clipSegmentT(
  a: WhiteboardPoint,
  b: WhiteboardPoint,
  box: BoundingBox,
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges = [
    { p: -dx, q: a.x - box.minX },
    { p: dx, q: box.maxX - a.x },
    { p: -dy, q: a.y - box.minY },
    { p: dy, q: box.maxY - a.y },
  ];
  for (const { p, q } of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}

function lerpPt(a: WhiteboardPoint, b: WhiteboardPoint, t: number): WhiteboardPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function samePt(a: WhiteboardPoint, b: WhiteboardPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
}

/**
 * Split a painted polyline into the runs outside a box (expanded by pad),
 * so connector strokes can leave a gap behind a label. Runs with fewer
 * than 2 points are dropped. No overlap → single run; fully covered → none.
 */
export function splitPathAtBox(
  pts: WhiteboardPoint[],
  box: BoundingBox,
  pad = 4,
): WhiteboardPoint[][] {
  if (pts.length < 2) return [];
  const expanded: BoundingBox = {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
  const runs: WhiteboardPoint[][] = [];
  let cur: WhiteboardPoint[] = [];
  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (samePt(a, b)) continue;
    const clip = clipSegmentT(a, b, expanded);
    if (!clip) {
      if (cur.length === 0 || !samePt(cur[cur.length - 1], a)) cur.push({ ...a });
      cur.push({ ...b });
      continue;
    }
    const [t0, t1] = clip;
    if (t0 > 1e-9) {
      const entry = lerpPt(a, b, t0);
      if (cur.length === 0) cur.push({ ...a });
      if (!samePt(cur[cur.length - 1], entry)) cur.push(entry);
    }
    flush();
    if (t1 < 1 - 1e-9) {
      const exit = lerpPt(a, b, t1);
      cur.push(exit);
      if (!samePt(exit, b)) cur.push({ ...b });
    }
  }
  flush();
  return runs;
}

/** Bounding box of a point path, expanded by padding on all sides. */
export function pathBounds(pts: WhiteboardPoint[], padding = 0): BoundingBox {
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

/** Hit threshold scales with stroke width so thick strokes are easy to grab. */
export function hitThreshold(el: WhiteboardElement): number {
  return Math.max(8, el.strokeWidth + 4);
}

export function hitTestElement(el: WhiteboardElement, pt: WhiteboardPoint): boolean {
  const t = hitThreshold(el);
  switch (el.kind) {
    case "arrow":
    case "line": {
      // Painted geometry is the flattened smooth curve (bend points lie
      // exactly on it), so hit-testing uses the same dense path.
      const sparse =
        el.waypoints.length > 0 ? [el.start, ...el.waypoints, el.end] : [el.start, el.end];
      return distanceToPolyline(pt, flattenSmoothPath(sparse)) <= t;
    }
    case "rectangle": {
      const b = normalizeBox(el.start, el.end);
      return pt.x >= b.minX - 4 && pt.x <= b.maxX + 4 && pt.y >= b.minY - 4 && pt.y <= b.maxY + 4;
    }
    case "ellipse": {
      const b = normalizeBox(el.start, el.end);
      const rx = Math.max((b.maxX - b.minX) / 2, 1);
      const ry = Math.max((b.maxY - b.minY) / 2, 1);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      // Normalized ellipse distance: 1 = on border. Accept border band + interior.
      const v = ((pt.x - cx) / rx) ** 2 + ((pt.y - cy) / ry) ** 2;
      if (v <= 1) return true;
      const approx = (Math.sqrt(v) - 1) * Math.min(rx, ry);
      return approx <= t;
    }
    case "diamond": {
      const b = normalizeBox(el.start, el.end);
      const poly = diamondVertices(b);
      if (pointInPolygon(pt, poly)) return true;
      return distanceToPolygon(pt, poly) <= t;
    }
    case "freehand": {
      for (let i = 0; i < el.points.length - 1; i++) {
        if (distanceToSegment(pt, el.points[i], el.points[i + 1]) <= t) return true;
      }
      return false;
    }
    case "text": {
      const b = getElementBounds(el);
      return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
    }
  }
}

/** Topmost (last-drawn) element under the point, or null. */
export function pickElement(
  elements: WhiteboardElement[],
  pt: WhiteboardPoint,
): WhiteboardElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(elements[i], pt)) return elements[i];
  }
  return null;
}

export function moveElement(el: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  switch (el.kind) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return {
        ...el,
        start: { x: el.start.x + dx, y: el.start.y + dy },
        end: { x: el.end.x + dx, y: el.end.y + dy },
      };
    case "arrow":
    case "line":
      return {
        ...el,
        start: { x: el.start.x + dx, y: el.start.y + dy },
        end: { x: el.end.x + dx, y: el.end.y + dy },
        waypoints: el.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case "freehand":
      return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "text":
      return { ...el, position: { x: el.position.x + dx, y: el.position.y + dy } };
  }
}

/** Drop intermediate points closer than minDist to keep dataJson small. */
export function decimatePoints(points: WhiteboardPoint[], minDist = 2): WhiteboardPoint[] {
  if (points.length < 3) return points;
  const out: WhiteboardPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export type ResizeHandleId =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w"
  | "start"
  | "end"
  | "bend"
  | `wp-${number}`;

export interface ResizeHandle {
  id: ResizeHandleId;
  x: number;
  y: number;
  cursor: string;
}

const HANDLE_CURSORS: Record<string, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  start: "move",
  end: "move",
  bend: "move",
};

/** Minimum box dimension after resize so shapes can't collapse to zero. */
export const MIN_BOX_SIZE = 8;

/**
 * Resize handles for an element. Arrows/lines expose their two endpoints
 * plus one handle per waypoint (`wp-0`, `wp-1`, …). With no waypoints a
 * single `bend` handle at the midpoint creates the first waypoint on drag.
 * Pass resolved binding-aware ends via `arrowEnds`; waypoint positions are
 * replayed relative to the resolved chord (see resolveConnectorWaypoints).
 */
export function getResizeHandles(
  el: WhiteboardElement,
  bounds?: BoundingBox,
  arrowEnds?: { start: WhiteboardPoint; end: WhiteboardPoint },
): ResizeHandle[] {
  if (el.kind === "arrow" || el.kind === "line") {
    const s = arrowEnds?.start ?? el.start;
    const e = arrowEnds?.end ?? el.end;
    const handles: ResizeHandle[] = [
      { id: "start", x: s.x, y: s.y, cursor: HANDLE_CURSORS.start },
      { id: "end", x: e.x, y: e.y, cursor: HANDLE_CURSORS.end },
    ];
    const resolved = resolveConnectorWaypoints(el, { start: s, end: e });
    if (resolved.length === 0) {
      handles.push({
        id: "bend",
        x: (s.x + e.x) / 2,
        y: (s.y + e.y) / 2,
        cursor: HANDLE_CURSORS.bend,
      });
    } else {
      resolved.forEach((p, i) => {
        handles.push({ id: `wp-${i}`, x: p.x, y: p.y, cursor: "move" });
      });
    }
    return handles;
  }
  const box = bounds ?? getElementBounds(el);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const pts: [ResizeHandleId, number, number][] = [
    ["nw", box.minX, box.minY],
    ["ne", box.maxX, box.minY],
    ["sw", box.minX, box.maxY],
    ["se", box.maxX, box.maxY],
    ["n", cx, box.minY],
    ["s", cx, box.maxY],
    ["w", box.minX, cy],
    ["e", box.maxX, cy],
  ];
  return pts.map(([id, x, y]) => ({ id, x, y, cursor: HANDLE_CURSORS[id] }));
}

export function hitTestHandle(
  el: WhiteboardElement,
  pt: WhiteboardPoint,
  bounds?: BoundingBox,
  arrowEnds?: { start: WhiteboardPoint; end: WhiteboardPoint },
  threshold = 9,
): ResizeHandle | null {
  for (const h of getResizeHandles(el, bounds, arrowEnds)) {
    if (Math.hypot(pt.x - h.x, pt.y - h.y) <= threshold) return h;
  }
  return null;
}

function clampBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (maxX - minX < MIN_BOX_SIZE) {
    // Keep the dragged edge, push the anchored one.
    maxX = minX + MIN_BOX_SIZE;
  }
  if (maxY - minY < MIN_BOX_SIZE) {
    maxY = minY + MIN_BOX_SIZE;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Drag one edge/corner of an arbitrary box to the pointer. The opposite
 * edge anchors; result is clamped to MIN_BOX_SIZE. Shared by single
 * resize, union (multi-select) resize, and marquee normalization callers.
 */
export function dragBoxHandle(
  box: BoundingBox,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
): BoundingBox {
  let { minX, minY, maxX, maxY } = box;
  if (handleId.includes("n")) minY = Math.min(pt.y, maxY - MIN_BOX_SIZE);
  if (handleId.includes("s")) maxY = Math.max(pt.y, minY + MIN_BOX_SIZE);
  if (handleId.includes("w")) minX = Math.min(pt.x, maxX - MIN_BOX_SIZE);
  if (handleId.includes("e")) maxX = Math.max(pt.x, minX + MIN_BOX_SIZE);
  return clampBox(minX, minY, maxX, maxY);
}

/** 8 box handles for an arbitrary bounding box (union/multi-select). */
export function boxHandles(box: BoundingBox): ResizeHandle[] {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const pts: [ResizeHandleId, number, number][] = [
    ["nw", box.minX, box.minY],
    ["ne", box.maxX, box.minY],
    ["sw", box.minX, box.maxY],
    ["se", box.maxX, box.maxY],
    ["n", cx, box.minY],
    ["s", cx, box.maxY],
    ["w", box.minX, cy],
    ["e", box.maxX, cy],
  ];
  return pts.map(([id, x, y]) => ({ id, x, y, cursor: HANDLE_CURSORS[id] }));
}

export function hitTestBoxHandles(
  box: BoundingBox,
  pt: WhiteboardPoint,
  threshold = 9,
): ResizeHandle | null {
  for (const h of boxHandles(box)) {
    if (Math.hypot(pt.x - h.x, pt.y - h.y) <= threshold) return h;
  }
  return null;
}

/**
 * Apply a resize drag to an element. Returns the updated element.
 * For arrows/lines the moved endpoint detaches (binding cleared) — the
 * caller rebinds on pointer-up if the release lands on a shape
 * (see WhiteboardNode endpoint rebind flow).
 * For bend/wp drags `resolved` is the binding-aware chord the pointer
 * lives in; the point is converted back to stored coords so bound arrows
 * don't double-offset (the jumpy-bend bug).
 */
export function resizeElement(
  el: WhiteboardElement,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
  resolved?: { start: WhiteboardPoint; end: WhiteboardPoint },
): WhiteboardElement {
  if (el.kind === "arrow" || el.kind === "line") {
    // Dragging the bend handle creates the first waypoint; dragging a
    // `wp-i` handle moves that waypoint; dragging an endpoint detaches
    // that binding (manual placement wins, rebind happens on pointer-up).
    if (handleId === "bend") return { ...el, waypoints: [resolvedToStored(el, resolved, pt)] };
    if (handleId.startsWith("wp-")) {
      const i = Number(handleId.slice(3));
      if (!Number.isInteger(i) || i < 0 || i >= el.waypoints.length) return el;
      const stored = resolvedToStored(el, resolved, pt);
      return { ...el, waypoints: el.waypoints.map((p, j) => (j === i ? stored : p)) };
    }
    if (handleId === "start") return { ...el, start: pt, startBinding: null };
    if (handleId === "end") return { ...el, end: pt, endBinding: null };
    return el;
  }
  if (el.kind === "text" && !el.containerId && !el.labelGroupId) {
    return resizeStandaloneText(el, handleId, pt);
  }
  const box = getElementBounds(el);
  const { minX, minY, maxX, maxY } = dragBoxHandle(box, handleId, pt);

  switch (el.kind) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return { ...el, start: { x: minX, y: minY }, end: { x: maxX, y: maxY } };
    case "freehand": {
      const sx = (maxX - minX) / Math.max(box.maxX - box.minX, 1);
      const sy = (maxY - minY) / Math.max(box.maxY - box.minY, 1);
      return {
        ...el,
        points: el.points.map((p) => ({
          x: minX + (p.x - box.minX) * sx,
          y: minY + (p.y - box.minY) * sy,
        })),
      };
    }
    case "text": {
      // Bound/group-label text reflows via its container; only the manual
      // offset box changes here — treat as a move of the offset.
      const dx = (minX + maxX) / 2 - (box.minX + box.maxX) / 2;
      const dy = (minY + maxY) / 2 - (box.minY + box.maxY) / 2;
      return { ...el, offset: { x: el.offset.x + dx, y: el.offset.y + dy } };
    }
  }
}

function resizeStandaloneText(
  el: Extract<WhiteboardElement, { kind: "text" }>,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
) {
  const box = getElementBounds(el);
  const oldH = Math.max(box.maxY - box.minY, 1);
  const { minX, minY, maxY } = dragBoxHandle(box, handleId, pt);
  const ratio = (maxY - minY) / oldH;
  return {
    ...el,
    position: { x: minX, y: minY },
    fontSize: Math.min(96, Math.max(8, Math.round(el.fontSize * ratio))),
  };
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function unionBounds(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;
  let out = { ...boxes[0] };
  for (const b of boxes.slice(1)) {
    out = {
      minX: Math.min(out.minX, b.minX),
      minY: Math.min(out.minY, b.minY),
      maxX: Math.max(out.maxX, b.maxX),
      maxY: Math.max(out.maxY, b.maxY),
    };
  }
  return out;
}

/** Translate every element in the list by the same delta (group/marquee move). */
export function moveElements(
  elements: WhiteboardElement[],
  ids: Set<string>,
  dx: number,
  dy: number,
): WhiteboardElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) => (ids.has(el.id) ? moveElement(el, dx, dy) : el));
}

// ---------------------------------------------------------------------------
// Connector waypoints (multi-point bends)
// ---------------------------------------------------------------------------

/** Stored midpoint of a connector's fallback coords (pre-resolve). */
export function storedConnectorMid(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
): WhiteboardPoint {
  return { x: (el.start.x + el.end.x) / 2, y: (el.start.y + el.end.y) / 2 };
}

/**
 * Waypoints replayed relative to the resolved chord: each stored waypoint's
 * offset from the stored midpoint is applied on top of the resolved
 * midpoint. Bound shapes can move (stretching the chord) without distorting
 * the bends — the same delta that moves the chord moves every waypoint.
 */
export function resolveConnectorWaypoints(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint },
): WhiteboardPoint[] {
  if (el.waypoints.length === 0) return [];
  const sm = storedConnectorMid(el);
  const rm = {
    x: (resolved.start.x + resolved.end.x) / 2,
    y: (resolved.start.y + resolved.end.y) / 2,
  };
  const dx = rm.x - sm.x;
  const dy = rm.y - sm.y;
  return el.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Chord delta between stored and resolved spaces. */
function chordDelta(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  resolved?: { start: WhiteboardPoint; end: WhiteboardPoint },
): WhiteboardPoint {
  if (!resolved) return { x: 0, y: 0 };
  const sm = storedConnectorMid(el);
  const rm = {
    x: (resolved.start.x + resolved.end.x) / 2,
    y: (resolved.start.y + resolved.end.y) / 2,
  };
  return { x: rm.x - sm.x, y: rm.y - sm.y };
}

/**
 * Convert a pointer in resolved (on-screen) coords back to stored coords.
 * Identity for unbound connectors; subtracts the chord delta for bound ones.
 */
export function resolvedToStored(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint } | undefined,
  pt: WhiteboardPoint,
): WhiteboardPoint {
  const d = chordDelta(el, resolved);
  return { x: pt.x - d.x, y: pt.y - d.y };
}

/** Convert stored coords to resolved (on-screen) coords. */
export function storedToResolved(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint } | undefined,
  pt: WhiteboardPoint,
): WhiteboardPoint {
  const d = chordDelta(el, resolved);
  return { x: pt.x + d.x, y: pt.y + d.y };
}

/**
 * Insert a waypoint at the click point (resolved coords). The nearest
 * segment of the *painted* (flattened smooth) curve decides the index, so
 * clicks on the visible line land between the right neighbors; the point
 * is converted back to stored coords so it re-resolves to the click
 * position. Returns the updated element, or the original when capped.
 */
export function insertWaypointAt(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  clickPt: WhiteboardPoint,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint },
): Extract<WhiteboardElement, { kind: "arrow" | "line" }> {
  if (el.waypoints.length >= MAX_WAYPOINTS) return el;
  const rps = resolveConnectorWaypoints(el, resolved);
  const sparse = [resolved.start, ...rps, resolved.end];
  const { points: flat, spans } = flattenSmoothPathDetailed(sparse);
  let bestFlat = 0;
  let bestDist = Infinity;
  for (let i = 0; i < flat.length - 1; i++) {
    const d = distanceToSegment(clickPt, flat[i], flat[i + 1]);
    // Strict < keeps the earliest span on ties -> stable path order.
    if (d < bestDist - 1e-9) {
      bestDist = d;
      bestFlat = i;
    }
  }
  // inserts between sparse[bestIdx] and sparse[bestIdx+1].
  const bestIdx = Math.min(spans[bestFlat] ?? 0, sparse.length - 2);
  // Convert click (resolved space) back to stored space.
  const stored = resolvedToStored(el, resolved, clickPt);
  const next = [...el.waypoints];
  next.splice(bestIdx, 0, stored);
  return { ...el, waypoints: next };
}

/** Remove the waypoint at `index` (no-op when out of range). */
export function removeWaypointAt(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  index: number,
): Extract<WhiteboardElement, { kind: "arrow" | "line" }> {
  if (index < 0 || index >= el.waypoints.length) return el;
  return { ...el, waypoints: el.waypoints.filter((_, j) => j !== index) };
}
