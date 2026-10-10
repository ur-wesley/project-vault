import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import { getElementBounds, unionBounds, type BoundingBox } from "./geometry";

/**
 * Groups on Excalidraw-native elements. `groupIds: string[]` allows nesting
 * (grouping grouped elements appends a parent id); `frameId` tracks frame
 * membership with `frameMembers`/`frameBounds` helpers. Group labels are
 * frame names — see `frameLabel` in `./boundText`.
 */

/**
 * Direct (innermost) group of an element. Ordering convention: the LAST
 * entry is the direct group (grouping appends the new parent id); readers
 * that need the full chain use `groupChain`.
 */
export function groupOf(el: ExcalidrawElement): string | null {
  if (el.groupIds.length === 0) return null;
  return el.groupIds[el.groupIds.length - 1] ?? null;
}

/** Full group chain of an element (outermost-first by convention). */
export function groupChain(el: ExcalidrawElement): string[] {
  return [...el.groupIds];
}

/** All element ids sharing the element's direct group (including itself). */
export function groupMembers(elements: ExcalidrawElement[], id: string): string[] {
  const el = elements.find((e) => e.id === id);
  if (!el) return [];
  const g = groupOf(el);
  if (!g) return [id];
  return elements.filter((e) => groupOf(e) === g).map((e) => e.id);
}

/** Bounding box of a group (resolved element bounds, any nesting level). */
export function groupBounds(
  elements: ExcalidrawElement[],
  groupId: string,
  boundsOf: (el: ExcalidrawElement) => BoundingBox = getElementBounds,
): BoundingBox | null {
  const boxes = elements.filter((e) => e.groupIds.includes(groupId)).map(boundsOf);
  return unionBounds(boxes);
}

/** All element ids belonging to a frame (by `frameId`). */
export function frameMembers(elements: ExcalidrawElement[], frameId: string): string[] {
  return elements.filter((e) => e.frameId === frameId).map((e) => e.id);
}

/** Bounding box of a frame's members (resolved element bounds). */
export function frameBounds(
  elements: ExcalidrawElement[],
  frameId: string,
  boundsOf: (el: ExcalidrawElement) => BoundingBox = getElementBounds,
): BoundingBox | null {
  const boxes = elements.filter((e) => e.frameId === frameId).map(boundsOf);
  return unionBounds(boxes);
}

function withAddedGroup(el: ExcalidrawElement, groupId: string): ExcalidrawElement {
  if (el.groupIds.includes(groupId)) return el;
  return { ...el, groupIds: [...el.groupIds, groupId] };
}

/**
 * Assign a fresh group id to the given elements. Grouping is nestable:
 * already-grouped elements keep their chain and gain the new id as the
 * direct (last) entry. Needs 2+ targets to form a group.
 * Returns the updated list and the group id (null when nothing grouped).
 */
export function groupSelection(
  elements: ExcalidrawElement[],
  ids: string[],
  newGroupId: string,
): { elements: ExcalidrawElement[]; groupId: string | null } {
  const set = new Set(ids);
  const targets = elements.filter((el) => set.has(el.id));
  if (targets.length < 2) return { elements, groupId: null };
  const next = elements.map((el) => (set.has(el.id) ? withAddedGroup(el, newGroupId) : el));
  return { elements: next, groupId: newGroupId };
}

/**
 * Remove group membership touched by the given elements (ungroup). Only the
 * direct groups of the selection are removed — outer parents survive, so
 * nested groups unpeel one level at a time.
 */
export function ungroupSelection(
  elements: ExcalidrawElement[],
  ids: string[],
): ExcalidrawElement[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    const g = el && groupOf(el);
    if (g) groups.add(g);
  }
  if (groups.size === 0) return elements;
  return elements.map((el) => {
    if (!el.groupIds.some((g) => groups.has(g))) return el;
    return { ...el, groupIds: el.groupIds.filter((g) => !groups.has(g)) };
  });
}

function scaleConnector(
  el: Extract<ExcalidrawElement, { type: "arrow" | "line" }>,
  mapPt: (p: WhiteboardPoint) => WhiteboardPoint,
): ExcalidrawElement {
  // Scaling detaches connectors (same rule as manual endpoint drags).
  const origin = mapPt({ x: el.x, y: el.y });
  const rel = el.points.map(
    ([px, py]): [number, number] => {
      const m = mapPt({ x: el.x + px, y: el.y + py });
      return [m.x - origin.x, m.y - origin.y];
    },
  );
  const abs = rel.map(([px, py]) => ({ x: origin.x + px, y: origin.y + py }));
  const b = unionBounds(abs.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })));
  return {
    ...el,
    x: origin.x,
    y: origin.y,
    width: b ? b.maxX - b.minX : 0,
    height: b ? b.maxY - b.minY : 0,
    points: rel,
    startBinding: null,
    endBinding: null,
  };
}

function scaleFreedraw(
  el: Extract<ExcalidrawElement, { type: "freedraw" }>,
  mapPt: (p: WhiteboardPoint) => WhiteboardPoint,
): ExcalidrawElement {
  const origin = mapPt({ x: el.x, y: el.y });
  const rel = el.points.map(
    ([px, py]): [number, number] => {
      const m = mapPt({ x: el.x + px, y: el.y + py });
      return [m.x - origin.x, m.y - origin.y];
    },
  );
  const abs = rel.map(([px, py]) => ({ x: origin.x + px, y: origin.y + py }));
  const b = unionBounds(abs.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })));
  return {
    ...el,
    x: origin.x,
    y: origin.y,
    width: b ? b.maxX - b.minX : 0,
    height: b ? b.maxY - b.minY : 0,
    points: rel,
  };
}

function scaleText(
  el: Extract<ExcalidrawElement, { type: "text" }>,
  mapPt: (p: WhiteboardPoint) => WhiteboardPoint,
  sy: number,
): ExcalidrawElement {
  if (el.containerId) {
    // Bound labels are never resized: their stored corner follows the
    // union scale so they stay glued to the container.
    const pos = mapPt({ x: el.x, y: el.y });
    return { ...el, x: pos.x, y: pos.y };
  }
  const a = mapPt({ x: el.x, y: el.y });
  const b = mapPt({ x: el.x + el.width, y: el.y + el.height });
  return {
    ...el,
    x: a.x,
    y: a.y,
    width: Math.max(1, b.x - a.x),
    height: Math.max(1, b.y - a.y),
    fontSize: Math.min(96, Math.max(8, Math.round(el.fontSize * sy))),
  };
}

function scaleBox(
  el: ExcalidrawElement,
  mapPt: (p: WhiteboardPoint) => WhiteboardPoint,
): ExcalidrawElement {
  const a = mapPt({ x: el.x, y: el.y });
  const b = mapPt({ x: el.x + el.width, y: el.y + el.height });
  return {
    ...el,
    x: a.x,
    y: a.y,
    width: Math.max(MIN_GROUP_SIZE, b.x - a.x),
    height: Math.max(MIN_GROUP_SIZE, b.y - a.y),
  };
}

/** Minimum dimension after a group resize (mirrors geometry.MIN_BOX_SIZE). */
export const MIN_GROUP_SIZE = 8;

/**
 * Scale all members of a union box from an old union to a new union
 * (group resize). Returns updated elements for the affected ids.
 */
export function scaleElementsToUnion(
  elements: ExcalidrawElement[],
  ids: Set<string>,
  from: BoundingBox,
  to: BoundingBox,
): ExcalidrawElement[] {
  const sx = (to.maxX - to.minX) / Math.max(from.maxX - from.minX, 1);
  const sy = (to.maxY - to.minY) / Math.max(from.maxY - from.minY, 1);
  const mapPt = (p: WhiteboardPoint): WhiteboardPoint => ({
    x: to.minX + (p.x - from.minX) * sx,
    y: to.minY + (p.y - from.minY) * sy,
  });
  return elements.map((el) => {
    if (!ids.has(el.id)) return el;
    if (el.type === "arrow" || el.type === "line") return scaleConnector(el, mapPt);
    if (el.type === "freedraw") return scaleFreedraw(el, mapPt);
    if (el.type === "text") return scaleText(el, mapPt, sy);
    return scaleBox(el, mapPt);
  });
}
