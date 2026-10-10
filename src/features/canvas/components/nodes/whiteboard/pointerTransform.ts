import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint, WhiteboardTool } from "./types";
import {
  isConnector,
  isShapeElement,
  isTextElement,
  normalizeBox,
  normalizeXYWH,
  type BoundingBox,
} from "./geometry";
import {
  aspectLockedBox,
  centeredResizeBox,
  connectorFallbackEnds,
  hitTestBoxHandles,
  hitTestHandle,
  hitTestRotateHandle,
  resizeElement,
  type ResizeHandleId,
} from "./geometryEdit";
import {
  BIND_DISTANCE,
  createBinding,
  findBindAnchor,
  findBindHover,
  pushOutByGap,
  type ResolvedEndpoints,
  type StickyBinding,
} from "./bindings";
import { groupMembers } from "./groups";
import { redirectLabelHit } from "./boundText";
import { duplicateElements, expandMoveIds } from "./elementOps";

/**
 * Transform gestures (pure computation — the pointer owns events, history,
 * and signals). Single-shape resize with Excalidraw modifiers, select/pick
 * gesture construction, plus the endpoint-rebind commit for arrows/lines.
 */

/** In-progress gesture state (owned by the pointer, constructed here). */
export type PointerGesture =
  | {
      kind: "draw";
      tool: WhiteboardTool;
      start: WhiteboardPoint;
      startBinding: StickyBinding | null;
    }
  | {
      kind: "move";
      ids: string[];
      orig: Map<string, ExcalidrawElement>;
      start: WhiteboardPoint;
      moved: boolean;
    }
  | {
      kind: "resize";
      id: string;
      handleId: ResizeHandleId;
      orig: ExcalidrawElement;
      moved: boolean;
      origResolved?: { start: WhiteboardPoint; end: WhiteboardPoint };
    }
  | {
      kind: "resize-union";
      ids: string[];
      handleId: ResizeHandleId;
      from: BoundingBox;
      origElements: ExcalidrawElement[];
      moved: boolean;
    }
  | {
      kind: "rotate";
      id: string;
      center: WhiteboardPoint;
      startAngle: number;
      origAngle: number;
      moved: boolean;
    }
  | { kind: "marquee"; origin: WhiteboardPoint; additive: boolean }
  | { kind: "text"; origin: WhiteboardPoint; containerId: string | null; textId: string | null }
  | { kind: "pan"; startScreen: WhiteboardPoint; startPan: WhiteboardPoint }
  | { kind: "erase"; dirty: boolean }
  | null;

/**
 * Single-shape resize with Excalidraw modifiers: Shift locks the aspect
 * ratio (corner handles), Alt resizes around the original center. Both
 * combine (aspect box recentered). Other types use the plain resize path.
 */
export function resizeWithModifiers(
  orig: ExcalidrawElement,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
  e: PointerEvent,
  origResolved?: { start: WhiteboardPoint; end: WhiteboardPoint },
): ExcalidrawElement {
  const shaped = isShapeElement(orig);
  const boxHandle =
    handleId === "nw" ||
    handleId === "ne" ||
    handleId === "sw" ||
    handleId === "se" ||
    handleId === "n" ||
    handleId === "s" ||
    handleId === "e" ||
    handleId === "w";
  if (!shaped || !boxHandle || (!e.shiftKey && !e.altKey)) {
    return resizeElement(orig, handleId, pt, origResolved);
  }
  const from = normalizeXYWH(orig.x, orig.y, orig.width, orig.height);
  const corner =
    handleId === "nw" || handleId === "ne" || handleId === "sw" || handleId === "se";
  let box: BoundingBox = from;
  if (e.altKey && e.shiftKey && corner) {
    // Centered + aspect: lock the ratio first, then mirror around center.
    const locked = aspectLockedBox(from, handleId, pt);
    const cx = (from.minX + from.maxX) / 2;
    const cy = (from.minY + from.maxY) / 2;
    const hw = Math.max((locked.maxX - locked.minX) / 2, 4);
    const hh = Math.max((locked.maxY - locked.minY) / 2, 4);
    box = {
      minX: cx - hw,
      minY: cy - hh,
      maxX: cx + hw,
      maxY: cy + hh,
    };
  } else if (e.altKey) {
    box = centeredResizeBox(from, handleId, pt);
  } else {
    box = aspectLockedBox(from, handleId, pt);
  }
  return { ...orig, x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

/** Live magnetic preview while dragging an arrow/line endpoint. */
export function endpointHover(
  elements: ExcalidrawElement[],
  targetId: string,
  pt: WhiteboardPoint,
  zoom: number,
): { highlight: string | null; anchor: WhiteboardPoint | null } {
  const hover = findBindHover(elements, pt, new Set([targetId]), BIND_DISTANCE / zoom);
  return { highlight: hover?.element.id ?? null, anchor: hover?.point ?? null };
}

/**
 * Endpoint rebind commit: dropping an arrow/line resize handle on a shape
 * sticks it (side+focus anchor); dropping on empty space leaves it detached
 * (the resize already cleared that binding). Returns the updated list, or
 * null when nothing snapped.
 */
export function rebindEndpoint(
  elements: ExcalidrawElement[],
  targetId: string,
  handleId: ResizeHandleId,
  pt: WhiteboardPoint,
  zoom: number,
): ExcalidrawElement[] | null {
  if (handleId !== "start" && handleId !== "end") return null;
  const target = elements.find((el) => el.id === targetId);
  if (!target || !isConnector(target)) return null;
  const snap = findBindAnchor(elements, pt, BIND_DISTANCE / zoom, new Set([target.id]));
  if (!snap) return null;
  const binding = createBinding(snap.element, pt);
  const snapped = pushOutByGap(snap.point, snap.side, binding.gap);
  return elements.map((el) => {
    if (el.id !== targetId || !isConnector(el)) return el;
    const rel: [number, number] = [snapped.x - el.x, snapped.y - el.y];
    if (handleId === "start") {
      return { ...el, points: [rel, ...el.points.slice(1)], startBinding: binding };
    }
    return { ...el, points: [...el.points.slice(0, -1), rel], endBinding: binding };
  });
}

export interface SelectDeps {
  elements: () => ExcalidrawElement[];
  selectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  zoom: () => number;
  boundsOf: (el: ExcalidrawElement) => BoundingBox;
  resolvedEnds: () => Map<string, ResolvedEndpoints>;
  selectionUnion: () => BoundingBox | null;
  hitAt: (pt: WhiteboardPoint) => ExcalidrawElement | null;
  setMarquee: (m: BoundingBox | null) => void;
  commit: (els: ExcalidrawElement[]) => void;
}

function moveFromHit(deps: SelectDeps, hit: ExcalidrawElement, pt: WhiteboardPoint, e: PointerEvent): PointerGesture {
  const els = deps.elements();
  const ids = deps.selectedIds();
  const drill = e.ctrlKey || e.metaKey;
  const targets = drill ? [hit.id] : groupMembers(els, hit.id);
  let nextSel: string[];
  if (e.shiftKey) {
    const set = new Set(ids);
    if (targets.every((id) => set.has(id))) {
      targets.forEach((id) => set.delete(id));
    } else {
      targets.forEach((id) => set.add(id));
    }
    nextSel = els.filter((el) => set.has(el.id)).map((el) => el.id);
  } else if (!drill && ids.includes(hit.id)) {
    nextSel = ids;
  } else {
    nextSel = targets;
  }
  deps.setSelectedIds(nextSel);
  // Locked-only picks select but never start a drag.
  const movable = nextSel.filter((id) => !els.find((el) => el.id === id)?.locked);
  if (e.altKey && movable.length > 0) {
    const { elements: next, newIds } = duplicateElements(deps.elements(), movable, 0, 0);
    if (newIds.length > 0) {
      deps.commit(next);
      deps.setSelectedIds(newIds);
      return {
        kind: "move",
        ids: newIds,
        orig: new Map(next.filter((el) => newIds.includes(el.id)).map((el) => [el.id, el])),
        start: pt,
        moved: true,
      };
    }
  }
  if (movable.length === 0) return null;
  // Bound-label drags move the container (labels anchor to it).
  const moveIds = expandMoveIds(els, movable);
  return {
    kind: "move",
    ids: moveIds,
    orig: new Map(els.filter((el) => moveIds.includes(el.id)).map((el) => [el.id, el])),
    start: pt,
    moved: false,
  };
}

/**
 * Select-tool press: rotation handle, resize handles, group-aware pick
 * (Alt duplicates first), or marquee on empty space. Arrow labels redirect
 * to their connector: one selectable unit.
 */
export function pickSelectGesture(deps: SelectDeps, pt: WhiteboardPoint, e: PointerEvent): PointerGesture {
  const els = deps.elements();
  const ids = deps.selectedIds();
  // Fixed screen-space grab radius, converted to world units.
  const grabR = 9 / deps.zoom();
  // 1. Rotation handle (single selection, shapes/freedraw only).
  // Connectors rotate via endpoint drags (bindings), bound labels
  // reflow via their container — none take the rotate handle.
  if (ids.length === 1) {
    const sel = els.find((el) => el.id === ids[0]);
    const rotatable = sel && !sel.locked && (isShapeElement(sel) || sel.type === "freedraw");
    if (sel && rotatable) {
      const box = deps.boundsOf(sel);
      if (hitTestRotateHandle(box, pt, deps.zoom())) {
        const cx = (box.minX + box.maxX) / 2;
        const cy = (box.minY + box.maxY) / 2;
        return {
          kind: "rotate",
          id: sel.id,
          center: { x: cx, y: cy },
          startAngle: Math.atan2(pt.y - cy, pt.x - cx),
          origAngle: sel.angle ?? 0,
          moved: false,
        };
      }
    }
  }
  // 2. Resize handles first (locked selections don't resize; bound
  // labels resize via their container).
  if (ids.length === 1) {
    const sel = els.find((el) => el.id === ids[0]);
    const resizable = sel && !sel.locked && !(isTextElement(sel) && sel.containerId);
    if (sel && resizable) {
      const h = hitTestHandle(sel, pt, undefined, deps.resolvedEnds().get(sel.id), grabR);
      if (h) {
        const origResolved = isConnector(sel)
          ? (deps.resolvedEnds().get(sel.id) ?? connectorFallbackEnds(sel))
          : undefined;
        return {
          kind: "resize",
          id: sel.id,
          handleId: h.id,
          orig: sel,
          moved: false,
          origResolved,
        };
      }
    }
  } else if (ids.length > 1) {
    const u = deps.selectionUnion();
    if (u) {
      const h = hitTestBoxHandles(u, pt, grabR);
      if (h) {
        return {
          kind: "resize-union",
          ids: [...ids],
          handleId: h.id,
          from: u,
          origElements: els,
          moved: false,
        };
      }
    }
  }
  // 3. Pick (group-aware unless drilling with Ctrl/Cmd).
  const hit = redirectLabelHit(els, deps.hitAt(pt));
  if (hit) return moveFromHit(deps, hit, pt, e);
  // 4. Marquee on empty space.
  deps.setMarquee(normalizeBox(pt, pt));
  return { kind: "marquee", origin: pt, additive: e.shiftKey };
}
