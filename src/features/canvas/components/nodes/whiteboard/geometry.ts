import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawFreedrawElement,
  ExcalidrawLineElement,
  ExcalidrawTextElement,
} from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import { measureTextBlock } from "./textMeasure";

/**
 * Geometry on Excalidraw-native `x/y/width/height`. `angle` is ignored —
 * all bounds and hit-tests are axis-aligned. Connector and freedraw
 * `points` are relative to the `x/y` origin; every entry point here works
 * in absolute board coords. Editing ops (move/resize/waypoints/handles)
 * live in `./geometryEdit`.
 */

export type ConnectorElement = ExcalidrawArrowElement | ExcalidrawLineElement;

export type ShapeElement = Extract<
  ExcalidrawElement,
  { type: "rectangle" | "ellipse" | "diamond" }
>;

export type TextEl = ExcalidrawTextElement;

/** True for arrows/lines (narrows for binding/point access). */
export function isConnector(el: ExcalidrawElement): el is ConnectorElement {
  return el.type === "arrow" || el.type === "line";
}

/** True for rectangle/ellipse/diamond. */
export function isShapeElement(el: ExcalidrawElement): el is ShapeElement {
  return el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";
}

/** True for text. */
export function isTextElement(el: ExcalidrawElement): el is ExcalidrawTextElement {
  return el.type === "text";
}

/** True for elements an arrow endpoint can bind to: shapes only. */
export function isArrowBindTarget(el: ExcalidrawElement): boolean {
  return isShapeElement(el);
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Max bend vertices per connector (intermediate points). */
export const MAX_WAYPOINTS = 24;

/** Map Excalidraw `fontFamily` 1/2/3 (or a legacy name) to a measurement stack name. */
export function fontFamilyName(f: unknown): "hand" | "normal" | "code" {
  if (f === "code" || f === 3) return "code";
  if (f === "hand" || f === 1) return "hand";
  return "normal";
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

/** Normalize native `x/y/width/height` (tolerates negative `width`/`height`). */
export function normalizeXYWH(x: number, y: number, w: number, h: number): BoundingBox {
  return {
    minX: Math.min(x, x + w),
    minY: Math.min(y, y + h),
    maxX: Math.max(x, x + w),
    maxY: Math.max(y, y + h),
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

/** Absolute points of a connector (`x/y` origin + relative `points`). */
export function connectorAbsolutePoints(el: ConnectorElement): WhiteboardPoint[] {
  return el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
}

/** Absolute points of a freedraw (`x/y` origin + relative `points`). */
export function freedrawAbsolutePoints(el: ExcalidrawFreedrawElement): WhiteboardPoint[] {
  return el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
}

/**
 * Replace a connector's relative points, recomputing `width`/`height`
 * from the absolute bounds (Excalidraw invariant). Origin `x/y` is fixed.
 */
export function withRelativePoints(
  el: ConnectorElement,
  rel: [number, number][],
): ConnectorElement {
  const abs = rel.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  const b = pathBounds(abs);
  return { ...el, points: rel, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/** Replace a freedraw's relative points, recomputing `width`/`height`. */
export function withFreedrawPoints(
  el: ExcalidrawFreedrawElement,
  rel: [number, number][],
): ExcalidrawFreedrawElement {
  const abs = rel.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  const b = pathBounds(abs);
  return { ...el, points: rel, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/**
 * Rebase a connector/freedraw so `x/y` is the top-left of its absolute
 * points (negative relative offsets become non-negative). Shapes/text
 * with negative `width`/`height` are normalized in place. Returns the
 * input when already normalized.
 */
export function normalizeElementOrigin(el: ExcalidrawElement): ExcalidrawElement {
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
    const abs =
      el.type === "freedraw" ? freedrawAbsolutePoints(el) : connectorAbsolutePoints(el);
    if (abs.length === 0) return el;
    const b = pathBounds(abs);
    const rel = abs.map((p): [number, number] => [p.x - b.minX, p.y - b.minY]);
    return {
      ...el,
      x: b.minX,
      y: b.minY,
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
      points: rel,
    };
  }
  if (el.width < 0 || el.height < 0) {
    const b = normalizeXYWH(el.x, el.y, el.width, el.height);
    return { ...el, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
  }
  return el;
}

function textBounds(el: ExcalidrawTextElement): BoundingBox {
  const wrap = !el.autoResize && el.width > 0 ? el.width : null;
  const block = measureTextBlock(el.text, el.fontSize, wrap, {
    fontFamily: fontFamilyName(el.fontFamily),
  });
  const w = el.width > 0 ? el.width : block.width;
  const h = el.height > 0 ? el.height : block.height;
  const finalW = el.autoResize ? Math.max(w, block.width) : w;
  const finalH = el.autoResize ? Math.max(h, block.height) : h;
  return { minX: el.x, minY: el.y, maxX: el.x + finalW, maxY: el.y + finalH };
}

export function getElementBounds(el: ExcalidrawElement): BoundingBox {
  switch (el.type) {
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "image":
    case "frame":
      return normalizeXYWH(el.x, el.y, el.width, el.height);
    case "arrow":
    case "line": {
      const abs = connectorAbsolutePoints(el);
      if (abs.length === 0) return normalizeXYWH(el.x, el.y, el.width, el.height);
      return pathBounds(abs);
    }
    case "freedraw": {
      const abs = freedrawAbsolutePoints(el);
      if (abs.length === 0) return { minX: el.x, minY: el.y, maxX: el.x, maxY: el.y };
      return pathBounds(abs);
    }
    case "text":
      return textBounds(el);
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
export function hitThreshold(el: ExcalidrawElement): number {
  return Math.max(8, el.strokeWidth + 4);
}

export function hitTestElement(el: ExcalidrawElement, pt: WhiteboardPoint): boolean {
  const t = hitThreshold(el);
  switch (el.type) {
    case "arrow":
    case "line":
      return distanceToPolyline(pt, flattenSmoothPath(connectorAbsolutePoints(el))) <= t;
    case "rectangle": {
      const b = normalizeXYWH(el.x, el.y, el.width, el.height);
      return pt.x >= b.minX - 4 && pt.x <= b.maxX + 4 && pt.y >= b.minY - 4 && pt.y <= b.maxY + 4;
    }
    case "ellipse": {
      const b = normalizeXYWH(el.x, el.y, el.width, el.height);
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
      const b = normalizeXYWH(el.x, el.y, el.width, el.height);
      const poly = diamondVertices(b);
      if (pointInPolygon(pt, poly)) return true;
      return distanceToPolygon(pt, poly) <= t;
    }
    case "freedraw": {
      const abs = freedrawAbsolutePoints(el);
      for (let i = 0; i < abs.length - 1; i++) {
        if (distanceToSegment(pt, abs[i], abs[i + 1]) <= t) return true;
      }
      return false;
    }
    case "text":
    case "image":
    case "frame": {
      const b = getElementBounds(el);
      return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
    }
  }
}

/** Topmost (last-drawn) element under the point, or null. */
export function pickElement(
  elements: ExcalidrawElement[],
  pt: WhiteboardPoint,
): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(elements[i], pt)) return elements[i];
  }
  return null;
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
