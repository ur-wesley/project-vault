import type { WhiteboardElement, WhiteboardPoint } from "./types";
import { getElementBounds, unionBounds, type BoundingBox } from "./geometry";

/** Outermost group id of an element (single-level: the only entry). */
export function groupOf(el: WhiteboardElement): string | null {
  return el.groupIds[0] ?? null;
}

/** All element ids sharing the element's group (including itself). */
export function groupMembers(elements: WhiteboardElement[], id: string): string[] {
  const el = elements.find((e) => e.id === id);
  if (!el) return [];
  const g = groupOf(el);
  if (!g) return [id];
  return elements.filter((e) => groupOf(e) === g).map((e) => e.id);
}

/** Bounding box of a group (resolved element bounds). */
export function groupBounds(
  elements: WhiteboardElement[],
  groupId: string,
  boundsOf: (el: WhiteboardElement) => BoundingBox = getElementBounds,
): BoundingBox | null {
  const boxes = elements.filter((e) => groupOf(e) === groupId).map(boundsOf);
  return unionBounds(boxes);
}

/**
 * Assign a fresh group id to the given elements. Elements already in a
 * group keep theirs (no nesting in v1) — only ungrouped elements join.
 * Returns the updated list and the group id (new or existing solo).
 */
export function groupSelection(
  elements: WhiteboardElement[],
  ids: string[],
  newGroupId: string,
): { elements: WhiteboardElement[]; groupId: string | null } {
  const targets = ids.filter((id) => {
    const el = elements.find((e) => e.id === id);
    return el && !groupOf(el);
  });
  if (targets.length < 2) return { elements, groupId: null };
  const set = new Set(targets);
  return {
    elements: elements.map((el) => (set.has(el.id) ? { ...el, groupIds: [newGroupId] } : el)),
    groupId: newGroupId,
  };
}

/** Remove group membership from the given elements (ungroup). */
export function ungroupSelection(
  elements: WhiteboardElement[],
  ids: string[],
): WhiteboardElement[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    const g = el && groupOf(el);
    if (g) groups.add(g);
  }
  if (groups.size === 0) return elements;
  return elements.map((el) =>
    groupOf(el) && groups.has(groupOf(el) as string) ? { ...el, groupIds: [] } : el,
  );
}

/**
 * Scale all members of a union box from an old union to a new union
 * (group resize). Returns updated elements for the affected ids.
 */
export function scaleElementsToUnion(
  elements: WhiteboardElement[],
  ids: Set<string>,
  from: BoundingBox,
  to: BoundingBox,
): WhiteboardElement[] {
  const sx = (to.maxX - to.minX) / Math.max(from.maxX - from.minX, 1);
  const sy = (to.maxY - to.minY) / Math.max(from.maxY - from.minY, 1);
  const mapPt = (p: WhiteboardPoint): WhiteboardPoint => ({
    x: to.minX + (p.x - from.minX) * sx,
    y: to.minY + (p.y - from.minY) * sy,
  });
  return elements.map((el) => {
    if (!ids.has(el.id)) return el;
    switch (el.kind) {
      case "rectangle":
      case "ellipse":
      case "diamond":
        return { ...el, start: mapPt(el.start), end: mapPt(el.end) };
      case "arrow":
      case "line":
        // Scaling detaches connectors (same rule as manual endpoint drags).
        return {
          ...el,
          startBinding: null,
          endBinding: null,
          start: mapPt(el.start),
          end: mapPt(el.end),
          waypoints: el.waypoints.map(mapPt),
        };
      case "freehand":
        return { ...el, points: el.points.map(mapPt) };
      case "text": {
        if (el.containerId || el.labelGroupId) {
          // Bound/group labels are never resized: only their manual offset
          // follows the union scale so they stay glued to the container.
          return {
            ...el,
            offset: { x: el.offset.x * sx, y: el.offset.y * sy },
          };
        }
        const pos = mapPt(el.position);
        return {
          ...el,
          position: pos,
          fontSize: Math.min(96, Math.max(8, Math.round(el.fontSize * sy))),
        };
      }
    }
  });
}
