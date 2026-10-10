import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  getElementBounds,
  isArrowBindTarget,
  withRelativePoints,
  type BoundingBox,
  type ConnectorElement,
} from "./geometry";
import { connectorStoredEnds, resolveConnectorWaypoints } from "./geometryEdit";

/**
 * Bindings on Excalidraw-native elements. The working model stays side+focus
 * sticky anchors, read from / written to the native `startBinding`/`endBinding`
 * (`{ elementId, focus, gap, side? }` — `side` is our extension, ignored by
 * excalidraw.com) plus `boundElements` back-refs (`{ type: "arrow", id }` on
 * bound targets). `arrowPath` resolves to absolute coords from `x/y+points`.
 */

export type BindSide = "n" | "s" | "e" | "w";

/** Native endpoint binding (side absent on imports — falls back to ray resolve). */
export interface ElementBinding {
  elementId: string;
  focus: number;
  gap: number;
  side?: BindSide;
}

/** Gap in px between the target boundary and the arrow endpoint. */
export const DEFAULT_BIND_GAP = 4;

/**
 * Single magnetic binding radius (Excalidraw-lite): the visible highlight
 * zone IS the attach zone — any release inside it binds the endpoint with
 * a sticky side+focus anchor. Releasing outside leaves it detached.
 */
export const BIND_DISTANCE = 28;
/** Back-compat aliases (hover tier == snap tier == attach zone). */
export const BIND_HOVER_DISTANCE = BIND_DISTANCE;
export const BIND_SNAP_DISTANCE = BIND_DISTANCE;
/** Dragging a bound endpoint this far from its anchor previews a detach. */
export const DETACH_DISTANCE = 24;

export interface ResolvedEndpoints {
  start: WhiteboardPoint;
  end: WhiteboardPoint;
}

export interface BindAnchor {
  element: ExcalidrawElement;
  side: BindSide;
  /** Normalized offset along the side (-1..1). 0 = center. */
  focus: number;
  /** Exact point on the target boundary (before gap). */
  point: WhiteboardPoint;
  /** Straight-line distance from pointer to target bounds. */
  distance: number;
}

/**
 * Intersect the ray from `inner` (shape center) through `outer` with the
 * shape boundary. Falls back to the boundary point nearest `outer`.
 */
export function intersectBoundary(
  el: ExcalidrawElement,
  inner: WhiteboardPoint,
  outer: WhiteboardPoint,
): WhiteboardPoint {
  const box = getElementBounds(el);
  if (el.type === "ellipse") {
    return intersectEllipse(box, inner, outer);
  }
  // Rectangle + diamond: intersect with the (axis-aligned) box edges.
  // Diamond uses the box as a close, cheap approximation.
  return intersectBox(box, inner, outer);
}

function intersectBox(
  box: BoundingBox,
  inner: WhiteboardPoint,
  outer: WhiteboardPoint,
): WhiteboardPoint {
  const dx = outer.x - inner.x;
  const dy = outer.y - inner.y;
  if (dx === 0 && dy === 0) return { x: (box.minX + box.maxX) / 2, y: box.minY };
  let best: WhiteboardPoint | null = null;
  let bestT = Infinity;
  const edges: [WhiteboardPoint, WhiteboardPoint][] = [
    [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
    ],
    [
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
    ],
    [
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ],
    [
      { x: box.minX, y: box.maxY },
      { x: box.minX, y: box.minY },
    ],
  ];
  for (const [a, b] of edges) {
    const t = raySegmentIntersection(inner, dx, dy, a, b);
    if (t !== null && t >= 0 && t < bestT) {
      bestT = t;
      best = { x: inner.x + dx * t, y: inner.y + dy * t };
    }
  }
  return best ?? { x: box.minX, y: box.minY };
}

/** Ray p + t*d (t >= 0) intersected with segment [a,b]. Returns t or null. */
function raySegmentIntersection(
  p: WhiteboardPoint,
  dx: number,
  dy: number,
  a: WhiteboardPoint,
  b: WhiteboardPoint,
): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / denom;
  const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

function intersectEllipse(
  box: BoundingBox,
  inner: WhiteboardPoint,
  outer: WhiteboardPoint,
): WhiteboardPoint {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = Math.max((box.maxX - box.minX) / 2, 1);
  const ry = Math.max((box.maxY - box.minY) / 2, 1);
  const dx = outer.x - inner.x;
  const dy = outer.y - inner.y;
  // Solve |inner + t*d - c|^2_normalized = 1 for t > 0.
  const nx = dx / rx;
  const ny = dy / ry;
  const fx = (inner.x - cx) / rx;
  const fy = (inner.y - cy) / ry;
  const A = nx * nx + ny * ny;
  if (A < 1e-9) return { x: cx, y: cy - ry };
  const B = 2 * (fx * nx + fy * ny);
  const C = fx * fx + fy * fy - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return { x: cx, y: cy - ry };
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  if (t < 0) return { x: cx, y: cy - ry };
  return { x: inner.x + dx * t, y: inner.y + dy * t };
}

function centerOf(el: ExcalidrawElement): WhiteboardPoint {
  const b = getElementBounds(el);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

// ---------------------------------------------------------------------------
// Side + focus anchors (sticky binding)
// ---------------------------------------------------------------------------

const SIDE_NORMALS: Record<BindSide, WhiteboardPoint> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

function clampFocus(f: number): number {
  return Math.min(1, Math.max(-1, f));
}

/** Point on the box edge for a side + focus (no gap applied). */
export function anchorToPoint(box: BoundingBox, side: BindSide, focus: number): WhiteboardPoint {
  const f = clampFocus(focus);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const halfW = Math.max((box.maxX - box.minX) / 2, 1);
  const halfH = Math.max((box.maxY - box.minY) / 2, 1);
  switch (side) {
    case "n":
      return { x: cx + f * halfW, y: box.minY };
    case "s":
      return { x: cx + f * halfW, y: box.maxY };
    case "e":
      return { x: box.maxX, y: cy + f * halfH };
    case "w":
      return { x: box.minX, y: cy + f * halfH };
  }
}

/** Push a boundary point outward along the side normal by gap. */
export function pushOutByGap(pt: WhiteboardPoint, side: BindSide, gap: number): WhiteboardPoint {
  if (!gap) return pt;
  const n = SIDE_NORMALS[side];
  return { x: pt.x + n.x * gap, y: pt.y + n.y * gap };
}

/**
 * Nearest side + focus for a pointer relative to a target box.
 * Inside the box the nearest edge wins; outside the closest edge (with
 * corner ties broken by dominant axis) wins — matching Excalidraw's
 * "sticks to the side you dropped it on" feel.
 */
export function sideFocusForPoint(
  box: BoundingBox,
  pt: WhiteboardPoint,
): { side: BindSide; focus: number } {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const halfW = Math.max((box.maxX - box.minX) / 2, 1);
  const halfH = Math.max((box.maxY - box.minY) / 2, 1);
  const insideX = pt.x >= box.minX && pt.x <= box.maxX;
  const insideY = pt.y >= box.minY && pt.y <= box.maxY;

  if (insideX && insideY) {
    const dN = pt.y - box.minY;
    const dS = box.maxY - pt.y;
    const dW = pt.x - box.minX;
    const dE = box.maxX - pt.x;
    const m = Math.min(dN, dS, dW, dE);
    if (m === dN) return { side: "n", focus: clampFocus((pt.x - cx) / halfW) };
    if (m === dS) return { side: "s", focus: clampFocus((pt.x - cx) / halfW) };
    if (m === dE) return { side: "e", focus: clampFocus((pt.y - cy) / halfH) };
    return { side: "w", focus: clampFocus((pt.y - cy) / halfH) };
  }

  // Outside: distance to each edge line, pick the closest.
  const dN = insideX ? Math.abs(pt.y - box.minY) : Infinity;
  const dS = insideX ? Math.abs(pt.y - box.maxY) : Infinity;
  const dW = insideY ? Math.abs(pt.x - box.minX) : Infinity;
  const dE = insideY ? Math.abs(pt.x - box.maxX) : Infinity;
  const best = Math.min(dN, dS, dW, dE);
  if (best !== Infinity) {
    if (best === dN) return { side: "n", focus: clampFocus((pt.x - cx) / halfW) };
    if (best === dS) return { side: "s", focus: clampFocus((pt.x - cx) / halfW) };
    if (best === dE) return { side: "e", focus: clampFocus((pt.y - cy) / halfH) };
    return { side: "w", focus: clampFocus((pt.y - cy) / halfH) };
  }
  // Corner region: dominant axis from center decides the side.
  const nx = (pt.x - cx) / halfW;
  const ny = (pt.y - cy) / halfH;
  if (Math.abs(nx) >= Math.abs(ny)) {
    return { side: nx >= 0 ? "e" : "w", focus: clampFocus((pt.y - cy) / halfH) };
  }
  return { side: ny >= 0 ? "s" : "n", focus: clampFocus((pt.x - cx) / halfW) };
}

/** Sticky side+focus binding built by {@link createBinding} (always has side+focus). */
export interface StickyBinding {
  elementId: string;
  gap: number;
  side: BindSide;
  focus: number;
}

/** Build a sticky binding for a drop point near a target. */
export function createBinding(
  target: ExcalidrawElement,
  pt: WhiteboardPoint,
  gap: number = DEFAULT_BIND_GAP,
): StickyBinding {
  const box = getElementBounds(target);
  const { side, focus } = sideFocusForPoint(box, pt);
  return { elementId: target.id, gap, side, focus };
}

/** Detailed magnetic candidate: nearest bindable shape within `radius`. */
export function findBindAnchor(
  elements: ExcalidrawElement[],
  pt: WhiteboardPoint,
  radius: number = BIND_DISTANCE,
  excludeIds: Set<string> = new Set(),
): BindAnchor | null {
  let best: BindAnchor | null = null;
  for (const el of elements) {
    if (excludeIds.has(el.id) || !isArrowBindTarget(el)) continue;
    const b = getElementBounds(el);
    const dx = Math.max(b.minX - pt.x, 0, pt.x - b.maxX);
    const dy = Math.max(b.minY - pt.y, 0, pt.y - b.maxY);
    const dist = Math.hypot(dx, dy);
    if (dist <= radius && (!best || dist < best.distance)) {
      const { side, focus } = sideFocusForPoint(b, pt);
      best = { element: el, side, focus, point: anchorToPoint(b, side, focus), distance: dist };
    }
  }
  return best;
}

function resolveEnd(
  byId: Map<string, ExcalidrawElement>,
  binding: ElementBinding,
  from: WhiteboardPoint,
): WhiteboardPoint | null {
  const target = byId.get(binding.elementId);
  if (!target || !isArrowBindTarget(target)) return null;
  const box = getElementBounds(target);
  const gap = binding.gap ?? DEFAULT_BIND_GAP;
  // Sticky path: side + focus anchor survives moves of either end.
  if (binding.side) {
    const focus =
      typeof binding.focus === "number" && Number.isFinite(binding.focus) ? binding.focus : 0;
    return pushOutByGap(anchorToPoint(box, binding.side, focus), binding.side, gap);
  }
  // Import path (excalidraw.com bindings carry no side): ray from target
  // center toward the other end.
  const center = centerOf(target);
  const onBoundary = intersectBoundary(target, center, from);
  const dx = onBoundary.x - center.x;
  const dy = onBoundary.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || gap === 0) return onBoundary;
  return { x: onBoundary.x + (dx / len) * gap, y: onBoundary.y + (dy / len) * gap };
}

/**
 * Concrete render/hit-test endpoints for an arrow or line. Bound ends are
 * derived from the target's live bounds (so they follow moves/resizes);
 * missing targets fall back to stored coordinates.
 */
export function resolveEndpoints(
  elements: ExcalidrawElement[],
  el: ConnectorElement,
): ResolvedEndpoints {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const stored = connectorStoredEnds(el);
  let start = stored.start;
  let end = stored.end;
  // Resolve against the *other* end's current position (free or resolved).
  if (el.startBinding) {
    const r = resolveEnd(byId, el.startBinding, stored.end);
    if (r) start = r;
  }
  if (el.endBinding) {
    const r = resolveEnd(byId, el.endBinding, start);
    if (r) end = r;
  }
  return { start, end };
}

/**
 * Nearest bindable shape within the attach zone (for arrow creation and
 * endpoint rebinds). Highlight zone == commit zone: anything highlighted
 * on release gets attached.
 */
export function findBindCandidate(
  elements: ExcalidrawElement[],
  pt: WhiteboardPoint,
  excludeIds: Set<string> = new Set(),
  radius: number = BIND_DISTANCE,
): ExcalidrawElement | null {
  return findBindAnchor(elements, pt, radius, excludeIds)?.element ?? null;
}

/**
 * Attach-zone candidate (highlight previews). Same radius as the commit
 * tier — previewed drops always attach.
 */
export function findBindHover(
  elements: ExcalidrawElement[],
  pt: WhiteboardPoint,
  excludeIds: Set<string> = new Set(),
  radius: number = BIND_DISTANCE,
): BindAnchor | null {
  return findBindAnchor(elements, pt, radius, excludeIds);
}

/**
 * Whether a dragged bound endpoint has been pulled far enough from its
 * anchor to preview a detach.
 */
export function isDetachPreview(
  elements: ExcalidrawElement[],
  binding: ElementBinding,
  pt: WhiteboardPoint,
): boolean {
  const target = elements.find((e) => e.id === binding.elementId);
  if (!target || !isArrowBindTarget(target)) return true;
  const box = getElementBounds(target);
  const dx = Math.max(box.minX - pt.x, 0, pt.x - box.maxX);
  const dy = Math.max(box.minY - pt.y, 0, pt.y - box.maxY);
  return Math.hypot(dx, dy) > DETACH_DISTANCE;
}

/**
 * Full render/hit-test path for an arrow or line: resolved (binding-aware)
 * endpoints with the waypoints (relative to the resolved chord) in between.
 * Straight connectors yield exactly two points. Connectors resolve
 * from `x/y + points` (relative) to absolute coords.
 */
export function arrowPath(
  elements: ExcalidrawElement[],
  el: ConnectorElement,
): WhiteboardPoint[] {
  const resolved = resolveEndpoints(elements, el);
  return [resolved.start, ...resolveConnectorWaypoints(el, resolved), resolved.end];
}

/** Point at half the total arc length of a polyline. */
export function polylineMidpoint(pts: WhiteboardPoint[]): WhiteboardPoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { ...pts[0] };
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    lens.push(len);
    total += len;
  }
  if (total < 1e-9) return { ...pts[0] };
  let target = total / 2;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i]) {
      const t = lens[i] < 1e-9 ? 0 : target / lens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    target -= lens[i];
  }
  return { ...pts[pts.length - 1] };
}

// ---------------------------------------------------------------------------
// Binding writes with boundElements back-refs (Excalidraw interop)
// ---------------------------------------------------------------------------

/** Add `{ type: "arrow", id }` to a target's back-refs (deduped, null-safe). */
function addArrowBackref(el: ExcalidrawElement, arrowId: string): ExcalidrawElement {
  const bound = el.boundElements ?? [];
  if (bound.some((b) => b.id === arrowId)) return el;
  return { ...el, boundElements: [...bound, { type: "arrow" as const, id: arrowId }] };
}

/** Remove `{ id: arrowId }` from an element's back-refs (null-safe). */
function removeBackref(el: ExcalidrawElement, arrowId: string): ExcalidrawElement {
  const bound = el.boundElements ?? [];
  if (!bound.some((b) => b.id === arrowId)) return el;
  return { ...el, boundElements: bound.filter((b) => b.id !== arrowId) };
}

function setStoredEnd(
  el: ConnectorElement,
  which: "start" | "end",
  pt: WhiteboardPoint,
): ConnectorElement {
  const rel: [number, number] = [pt.x - el.x, pt.y - el.y];
  if (which === "start") {
    const next: [number, number][] = [rel, ...el.points.slice(1)];
    if (next.length < 2) next.push(rel);
    return withRelativePoints(el, next);
  }
  const next: [number, number][] = [...el.points.slice(0, -1), rel];
  if (next.length < 2) next.unshift(rel);
  return withRelativePoints(el, next);
}

/** Set one endpoint binding on a connector. */
function withBinding(
  el: ConnectorElement,
  which: "start" | "end",
  binding: StickyBinding | null,
): ConnectorElement {
  return which === "start" ? { ...el, startBinding: binding } : { ...el, endBinding: binding };
}

/**
 * Attach one arrow/line endpoint to a target: sets the sticky side+focus
 * `startBinding`/`endBinding`, snaps the stored end to the anchor, writes
 * the `{ type: "arrow", id }` back-ref on the target, and clears a stale
 * back-ref when rebinding away from another target. Pure — caller commits.
 */
export function attachArrowBinding(
  elements: ExcalidrawElement[],
  arrowId: string,
  which: "start" | "end",
  target: ExcalidrawElement,
  pt: WhiteboardPoint,
  gap: number = DEFAULT_BIND_GAP,
): ExcalidrawElement[] {
  const arrow = elements.find((e) => e.id === arrowId);
  if (!arrow || (arrow.type !== "arrow" && arrow.type !== "line")) return elements;
  const prev = which === "start" ? arrow.startBinding : arrow.endBinding;
  const binding = createBinding(target, pt, gap);
  const box = getElementBounds(target);
  const snapped = pushOutByGap(
    anchorToPoint(box, binding.side, binding.focus),
    binding.side,
    binding.gap,
  );
  return elements.map((el) => {
    if (el.id === arrowId && (el.type === "arrow" || el.type === "line")) {
      return withBinding(setStoredEnd(el, which, snapped), which, binding);
    }
    if (el.id === target.id) return addArrowBackref(el, arrowId);
    if (prev && el.id === prev.elementId && el.id !== target.id) {
      return removeBackref(el, arrowId);
    }
    return el;
  });
}

/**
 * Detach one arrow/line endpoint: clears the binding and removes the
 * back-ref from its target. The stored end keeps its last position.
 */
export function detachArrowBinding(
  elements: ExcalidrawElement[],
  arrowId: string,
  which: "start" | "end",
): ExcalidrawElement[] {
  const arrow = elements.find((e) => e.id === arrowId);
  if (!arrow || (arrow.type !== "arrow" && arrow.type !== "line")) return elements;
  const prev = which === "start" ? arrow.startBinding : arrow.endBinding;
  if (!prev) return elements;
  return elements.map((el) => {
    if (el.id === arrowId && (el.type === "arrow" || el.type === "line")) {
      return withBinding(el, which, null);
    }
    if (el.id === prev.elementId) return removeBackref(el, arrowId);
    return el;
  });
}
