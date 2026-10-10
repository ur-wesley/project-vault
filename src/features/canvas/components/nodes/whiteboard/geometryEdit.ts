import type { ExcalidrawElement, ExcalidrawFreedrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  MAX_WAYPOINTS,
  connectorAbsolutePoints,
  distanceToSegment,
  flattenSmoothPathDetailed,
  getElementBounds,
  normalizeXYWH,
  withFreedrawPoints,
  withRelativePoints,
  type BoundingBox,
  type ConnectorElement,
} from "./geometry";

/**
 * Element editing on Excalidraw-native elements: move, resize (+handles),
 * connector waypoint resolve/edit, draw modifiers, rotate helpers.
 * Pure functions — the store owns the live state.
 */

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

/** Translate one element by a delta (connectors/freedraw shift the origin). */
export function moveElement(el: ExcalidrawElement, dx: number, dy: number): ExcalidrawElement {
  // Connectors/freedraw store points relative to the x/y origin, so a move
  // only shifts the origin — the relative path (and width/height) is untouched.
  // Bound arrows stay glued via live endpoint resolution (see bindings).
  return { ...el, x: el.x + dx, y: el.y + dy };
}

/** Translate every element in the id set by the same delta (group/marquee move). */
export function moveElements(
  elements: ExcalidrawElement[],
  ids: Set<string>,
  dx: number,
  dy: number,
): ExcalidrawElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) => {
    if (!ids.has(el.id)) return el;
    return moveElement(el, dx, dy);
  });
}

// ---------------------------------------------------------------------------
// Connector waypoints (multi-point bends, relative to the resolved chord)
// ---------------------------------------------------------------------------

/** Absolute intermediate points of a connector (excludes stored endpoints). */
function connectorIntermediates(el: ConnectorElement): WhiteboardPoint[] {
  return connectorAbsolutePoints(el).slice(1, -1);
}

/** Stored absolute endpoints of a connector. */
export function connectorStoredEnds(el: ConnectorElement): {
  start: WhiteboardPoint;
  end: WhiteboardPoint;
} {
  const abs = connectorAbsolutePoints(el);
  const fallback = { x: el.x, y: el.y };
  return { start: abs[0] ?? fallback, end: abs[abs.length - 1] ?? fallback };
}

/** Full stored absolute path of a connector (unresolved — see bindings for resolved). */
export function connectorStoredPath(el: ConnectorElement): WhiteboardPoint[] {
  const { start, end } = connectorStoredEnds(el);
  return [start, ...connectorIntermediates(el), end];
}

/** Stored midpoint of a connector's fallback coords (pre-resolve). */
export function storedConnectorMid(el: ConnectorElement): WhiteboardPoint {
  const { start, end } = connectorStoredEnds(el);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/**
 * Waypoints replayed relative to the resolved chord: each stored waypoint's
 * offset from the stored midpoint is applied on top of the resolved
 * midpoint. Bound shapes can move (stretching the chord) without distorting
 * the bends — the same delta that moves the chord moves every waypoint.
 */
export function resolveConnectorWaypoints(
  el: ConnectorElement,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint },
): WhiteboardPoint[] {
  const intermediates = connectorIntermediates(el);
  if (intermediates.length === 0) return [];
  const sm = storedConnectorMid(el);
  const rm = {
    x: (resolved.start.x + resolved.end.x) / 2,
    y: (resolved.start.y + resolved.end.y) / 2,
  };
  const dx = rm.x - sm.x;
  const dy = rm.y - sm.y;
  return intermediates.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Chord delta between stored and resolved spaces. */
function chordDelta(
  el: ConnectorElement,
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
  el: ConnectorElement,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint } | undefined,
  pt: WhiteboardPoint,
): WhiteboardPoint {
  const d = chordDelta(el, resolved);
  return { x: pt.x - d.x, y: pt.y - d.y };
}

/** Convert stored coords to resolved (on-screen) coords. */
export function storedToResolved(
  el: ConnectorElement,
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
  el: ConnectorElement,
  clickPt: WhiteboardPoint,
  resolved: { start: WhiteboardPoint; end: WhiteboardPoint },
): ConnectorElement {
  const intermediates = el.points.length - 2;
  if (intermediates >= MAX_WAYPOINTS) return el;
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
  const stored = resolvedToStored(el, resolved, clickPt);
  const rel: [number, number] = [stored.x - el.x, stored.y - el.y];
  const next = [...el.points];
  next.splice(bestIdx + 1, 0, rel);
  return withRelativePoints(el, next);
}

/** Remove the waypoint at `index` (no-op when out of range). */
export function removeWaypointAt(el: ConnectorElement, index: number): ConnectorElement {
  const intermediates = el.points.length - 2;
  if (index < 0 || index >= intermediates) return el;
  const next = el.points.filter((_, j) => j !== index + 1);
  if (next.length < 2) return el;
  return withRelativePoints(el, next);
}

// ---------------------------------------------------------------------------
// Resize handles + resize
// ---------------------------------------------------------------------------

/**
 * Resize handles for an element. Arrows/lines expose their two endpoints
 * plus one handle per waypoint (`wp-0`, `wp-1`, …). With no waypoints a
 * single `bend` handle at the midpoint creates the first waypoint on drag.
 * Pass resolved binding-aware ends via `arrowEnds`; waypoint positions are
 * replayed relative to the resolved chord (see resolveConnectorWaypoints).
 */
export function getResizeHandles(
  el: ExcalidrawElement,
  bounds?: BoundingBox,
  arrowEnds?: { start: WhiteboardPoint; end: WhiteboardPoint },
): ResizeHandle[] {
  if (el.type === "arrow" || el.type === "line") {
    const stored = connectorStoredEnds(el);
    const s = arrowEnds?.start ?? stored.start;
    const e = arrowEnds?.end ?? stored.end;
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
  el: ExcalidrawElement,
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

function resizeConnector(
  el: ConnectorElement,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
  resolved?: { start: WhiteboardPoint; end: WhiteboardPoint },
): ConnectorElement {
  // Dragging the bend handle creates the first waypoint; dragging a
  // `wp-i` handle moves that waypoint; dragging an endpoint detaches
  // that binding (manual placement wins, rebind happens on pointer-up).
  if (handleId === "bend") {
    const stored = resolvedToStored(el, resolved, pt);
    const rel: [number, number][] = [
      el.points[0] ?? [0, 0],
      [stored.x - el.x, stored.y - el.y],
      ...el.points.slice(1),
    ];
    return withRelativePoints(el, rel);
  }
  if (handleId.startsWith("wp-")) {
    const i = Number(handleId.slice(3));
    const intermediates = el.points.length - 2;
    if (!Number.isInteger(i) || i < 0 || i >= intermediates) return el;
    const stored = resolvedToStored(el, resolved, pt);
    const rel = el.points.map(
      (p, j): [number, number] => (j === i + 1 ? [stored.x - el.x, stored.y - el.y] : p),
    );
    return withRelativePoints(el, rel);
  }
  if (handleId === "start") {
    const rel: [number, number][] = [[pt.x - el.x, pt.y - el.y], ...el.points.slice(1)];
    return { ...withRelativePoints(el, rel), startBinding: null };
  }
  if (handleId === "end") {
    const rel: [number, number][] = [...el.points.slice(0, -1), [pt.x - el.x, pt.y - el.y]];
    const sized: [number, number][] = rel.length > 0 ? rel : [[pt.x - el.x, pt.y - el.y]];
    return { ...withRelativePoints(el, sized), endBinding: null };
  }
  return el;
}

function resizeFreedraw(
  el: ExcalidrawFreedrawElement,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
): ExcalidrawFreedrawElement {
  const box = getElementBounds(el);
  const { minX, minY, maxX, maxY } = dragBoxHandle(box, handleId, pt);
  const sx = (maxX - minX) / Math.max(box.maxX - box.minX, 1);
  const sy = (maxY - minY) / Math.max(box.maxY - box.minY, 1);
  // Origin x/y is fixed; relative points absorb the scale.
  const rel = el.points.map(([px, py]): [number, number] => {
    const ax = el.x + px;
    const ay = el.y + py;
    return [minX + (ax - box.minX) * sx - el.x, minY + (ay - box.minY) * sy - el.y];
  });
  return withFreedrawPoints(el, rel);
}

function resizeText(
  el: Extract<ExcalidrawElement, { type: "text" }>,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
): ExcalidrawElement {
  if (el.containerId) {
    // Bound text reflows via its container; only the stored position follows
    // the drag so it stays glued to the anchor.
    const box = getElementBounds(el);
    const next = dragBoxHandle(box, handleId, pt);
    const dx = (next.minX + next.maxX) / 2 - (box.minX + box.maxX) / 2;
    const dy = (next.minY + next.maxY) / 2 - (box.minY + box.maxY) / 2;
    return { ...el, x: el.x + dx, y: el.y + dy };
  }
  const box = getElementBounds(el);
  const oldH = Math.max(box.maxY - box.minY, 1);
  const next = dragBoxHandle(box, handleId, pt);
  const ratio = (next.maxY - next.minY) / oldH;
  return {
    ...el,
    x: next.minX,
    y: next.minY,
    fontSize: Math.min(96, Math.max(8, Math.round(el.fontSize * ratio))),
  };
}

function resizeShape(el: ExcalidrawElement, handleId: ResizeHandleId, pt: WhiteboardPoint) {
  const box = normalizeXYWH(el.x, el.y, el.width, el.height);
  const { minX, minY, maxX, maxY } = dragBoxHandle(box, handleId, pt);
  return { ...el, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Apply a resize drag to an element. Returns the updated element.
 * For arrows/lines the moved endpoint detaches (binding cleared) — the
 * caller rebinds on pointer-up if the release lands on a shape.
 * For bend/wp drags `resolved` is the binding-aware chord the pointer
 * lives in; the point is converted back to stored coords so bound arrows
 * don't double-offset (the jumpy-bend bug).
 */
export function resizeElement(
  el: ExcalidrawElement,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
  resolved?: { start: WhiteboardPoint; end: WhiteboardPoint },
): ExcalidrawElement {
  if (el.type === "arrow" || el.type === "line") {
    return resizeConnector(el, handleId, pt, resolved);
  }
  if (el.type === "freedraw") return resizeFreedraw(el, handleId, pt);
  if (el.type === "text") return resizeText(el, handleId, pt);
  return resizeShape(el, handleId, pt);
}

// ---------------------------------------------------------------------------
// Draw modifiers + rotate (Excalidraw parity, model-agnostic box math)
// ---------------------------------------------------------------------------

/** Square corner for Shift-draw: largest side wins, direction preserved. */
export function squareDraftEnd(start: WhiteboardPoint, pt: WhiteboardPoint): WhiteboardPoint {
  const dx = pt.x - start.x;
  const dy = pt.y - start.y;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -s : s), y: start.y + (dy < 0 ? -s : s) };
}

/**
 * Draw modifiers (Excalidraw shortcuts): Shift locks squares/circles,
 * Alt draws centered on the press point. Returns box corners (min, max).
 */
export function applyDrawModifiers(
  start: WhiteboardPoint,
  pt: WhiteboardPoint,
  opts: { square: boolean; centered: boolean },
): { start: WhiteboardPoint; end: WhiteboardPoint } {
  const end = opts.square ? squareDraftEnd(start, pt) : pt;
  if (!opts.centered) return { start, end };
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  return {
    start: { x: start.x - dx, y: start.y - dy },
    end: { x: start.x + dx, y: start.y + dy },
  };
}

/**
 * Shift-resize a shape box preserving the original aspect ratio. The edge
 * opposite the dragged handle anchors; the dragged corner is pulled onto
 * the aspect ray (dominant axis wins). Non-corner handles pass through.
 */
export function aspectLockedBox(
  orig: BoundingBox,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
): BoundingBox {
  const corner = handleId === "nw" || handleId === "ne" || handleId === "sw" || handleId === "se";
  if (!corner) return dragBoxHandle(orig, handleId, pt);
  const ow = Math.max(orig.maxX - orig.minX, 1);
  const oh = Math.max(orig.maxY - orig.minY, 1);
  const aspect = ow / oh;
  const anchorX = handleId.includes("w") ? orig.maxX : orig.minX;
  const anchorY = handleId.includes("n") ? orig.maxY : orig.minY;
  const rawW = Math.max(Math.abs(pt.x - anchorX), MIN_BOX_SIZE);
  const rawH = Math.max(Math.abs(pt.y - anchorY), MIN_BOX_SIZE);
  // Dominant axis wins so the box follows the pointer instead of jumping.
  const w = rawW / aspect >= rawH ? rawW : rawH * aspect;
  const h = rawW / aspect >= rawH ? rawW / aspect : rawH;
  const minX = handleId.includes("w") ? anchorX - w : anchorX;
  const minY = handleId.includes("n") ? anchorY - h : anchorY;
  return clampBox(minX, minY, minX + w, minY + h);
}

/**
 * Alt-resize around the original center (Excalidraw center-resize). Each
 * dragged axis mirrors around the center; undragged axes keep their size.
 */
export function centeredResizeBox(
  orig: BoundingBox,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
): BoundingBox {
  const cx = (orig.minX + orig.maxX) / 2;
  const cy = (orig.minY + orig.maxY) / 2;
  const halfW =
    handleId.includes("e") || handleId.includes("w")
      ? Math.max(Math.abs(pt.x - cx), MIN_BOX_SIZE / 2)
      : (orig.maxX - orig.minX) / 2;
  const halfH =
    handleId.includes("n") || handleId.includes("s")
      ? Math.max(Math.abs(pt.y - cy), MIN_BOX_SIZE / 2)
      : (orig.maxY - orig.minY) / 2;
  return clampBox(cx - halfW, cy - halfH, cx + halfW, cy + halfH);
}

/** Screen gap (world units handled by callers via zoom) above a box. */
export const ROTATE_HANDLE_GAP = 24;

/** Rotation handle position: centered above the selection box. */
export function getRotateHandle(box: BoundingBox, zoom = 1): WhiteboardPoint {
  const z = zoom > 0 ? zoom : 1;
  return { x: (box.minX + box.maxX) / 2, y: box.minY - ROTATE_HANDLE_GAP / z };
}

/** Hit-test the rotation handle (grab radius counter-scaled by zoom). */
export function hitTestRotateHandle(
  box: BoundingBox,
  pt: WhiteboardPoint,
  zoom = 1,
  threshold = 9,
): boolean {
  const z = zoom > 0 ? zoom : 1;
  const h = getRotateHandle(box, z);
  return Math.hypot(pt.x - h.x, pt.y - h.y) <= threshold / z;
}

/** Stored absolute endpoints, or the origin doubled when pointless. */
export function connectorFallbackEnds(el: ConnectorElement): {
  start: WhiteboardPoint;
  end: WhiteboardPoint;
} {
  const pts = el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  const first = pts[0] ?? { x: el.x, y: el.y };
  const last = pts[pts.length - 1] ?? { x: el.x, y: el.y };
  return { start: first, end: last };
}

/** Snap an angle to 15° steps (Shift-drag while rotating, Excalidraw parity). */
export function snapAngle(angle: number, step: number = Math.PI / 12): number {
  return Math.round(angle / step) * step;
}
