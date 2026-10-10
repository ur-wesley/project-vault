import type { ExcalidrawElement } from "./excalidrawTypes";
import { createElementId, newElement } from "./excalidrawDefaults";
import type { WhiteboardPoint } from "./types";
import { normalizeElementOrigin } from "./geometry";
import { moveElement } from "./geometryEdit";
import { defaultStyleFor, type StylePatch } from "./whiteboardStyle";
import { syncBoundTextOrigins } from "./boundText";
import { isTextElement } from "./geometry";

export type DrawableTool =
  | "freehand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text";

/** Native type for a drawable tool (freehand paints freedraw). */
export function nativeTypeFor(tool: DrawableTool): ExcalidrawElement["type"] {
  return tool === "freehand" ? "freedraw" : tool;
}

/**
 * Central draft factory: one home for press-point drafts. Connectors start
 * detached (`startBinding`/`endBinding` null — bind on pointer-up preview);
 * freedraw starts with a single point; shapes start collapsed at the press.
 */
export function createDraftElement(
  tool: DrawableTool,
  at: WhiteboardPoint,
  style: StylePatch,
  id: string = createElementId(),
): ExcalidrawElement {
  const type = nativeTypeFor(tool);
  const base = {
    id,
    x: Math.round(at.x),
    y: Math.round(at.y),
    strokeColor: style.strokeColor ?? defaultStyleFor(tool).strokeColor,
    backgroundColor: style.backgroundColor ?? "transparent",
    fillStyle: style.fillStyle ?? "transparent",
    strokeWidth: style.strokeWidth ?? 2,
    strokeStyle: style.strokeStyle ?? "solid",
    roughness: style.roughness ?? 1,
    opacity: style.opacity ?? 100,
  };
  if (type === "freedraw") {
    return newElement("freedraw", { ...base, points: [[0, 0]], width: 0, height: 0 });
  }
  if (type === "arrow" || type === "line") {
    const startHead = style.startArrowhead === "dot" ? "dot" : null;
    let endHead: "arrow" | "dot" | null = null;
    if (style.endArrowhead === "arrow") endHead = "arrow";
    else if (style.endArrowhead === "dot") endHead = "dot";
    else if (style.endArrowhead === undefined && type === "arrow") endHead = "arrow";
    return newElement(type, {
      ...base,
      points: [
        [0, 0],
        [0, 0],
      ],
      width: 0,
      height: 0,
      startBinding: null,
      endBinding: null,
      startArrowhead: startHead,
      endArrowhead: endHead,
    });
  }
  if (type === "text") {
    throw new Error("createDraftElement: text commits via the label overlay");
  }
  return newElement(type, { ...base, width: 0, height: 0 });
}

/**
 * Move ids expanded for bound labels: dragging a bound text moves its
 * container (labels render centered on the anchor — see boundText).
 */
export function expandMoveIds(
  elements: ExcalidrawElement[],
  ids: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    if (el && isTextElement(el) && el.containerId) {
      if (elements.some((e) => e.id === el.containerId)) {
        out.add(el.containerId);
        continue;
      }
    }
    out.add(id);
  }
  return [...out];
}

/**
 * Shift one element by a delta. Bound texts follow their container via
 * {@link expandMoveIds}; every element moves its stored geometry here.
 */
export function shiftElement(
  el: ExcalidrawElement,
  dx: number,
  dy: number,
): ExcalidrawElement {
  return moveElement(el, dx, dy);
}

/** Normalize a finished draft (rebase origins, drop zero-size shapes). */
export function finishDraft(el: ExcalidrawElement): ExcalidrawElement | null {
  const norm = normalizeElementOrigin(el);
  if (norm.type === "rectangle" || norm.type === "ellipse" || norm.type === "diamond") {
    if (norm.width < 4 && norm.height < 4) return null;
  }
  return norm;
}

/**
 * Duplicate elements with fresh ids, shifted by (dx, dy), appended on top.
 * Bound texts of duplicated containers come along even when unselected
 * (their `containerId` + the container's `boundElements` remap to the clone);
 * bindings/frame refs remap when both ends duplicate, else they detach.
 */
export function duplicateElements(
  els: ExcalidrawElement[],
  ids: readonly string[],
  dx = 20,
  dy = 20,
): { elements: ExcalidrawElement[]; newIds: string[] } {
  const pick = new Set(ids);
  if (pick.size === 0) return { elements: els, newIds: [] };
  // Auto-include bound texts of duplicated containers (Excalidraw parity).
  const extra = new Set<string>();
  for (const el of els) {
    if (isTextElement(el) && el.containerId && pick.has(el.containerId) && !pick.has(el.id)) {
      extra.add(el.id);
    }
  }
  const full = new Set([...pick, ...extra]);
  const idMap = new Map<string, string>();
  for (const el of els) {
    if (full.has(el.id)) idMap.set(el.id, createElementId());
  }
  const clones: ExcalidrawElement[] = [];
  const newIds: string[] = [];
  for (const el of els) {
    if (!full.has(el.id)) continue;
    const moved = shiftElement(el, dx, dy);
    const fresh = idMap.get(el.id) ?? moved.id;
    let next: ExcalidrawElement = { ...moved, id: fresh } as ExcalidrawElement;
    if (next.type === "text" && next.containerId) {
      const remapped = idMap.get(next.containerId);
      next = remapped ? { ...next, containerId: remapped } : { ...next, containerId: null };
    }
    if (next.type === "arrow" || next.type === "line") {
      const sb = next.startBinding;
      const eb = next.endBinding;
      next = {
        ...next,
        startBinding: sb && idMap.has(sb.elementId) ? { ...sb, elementId: idMap.get(sb.elementId) as string } : null,
        endBinding: eb && idMap.has(eb.elementId) ? { ...eb, elementId: idMap.get(eb.elementId) as string } : null,
      };
    }
    if (next.frameId && !idMap.has(next.frameId)) next = { ...next, frameId: null };
    if (next.boundElements) {
      next = {
        ...next,
        boundElements: next.boundElements
          .map((b) => ({ ...b, id: idMap.get(b.id) ?? b.id }))
          .filter((b) => idMap.has(b.id)),
      };
    }
    clones.push(next);
    // Only originally-picked ids become the new selection (not auto-included labels).
    if (pick.has(el.id)) newIds.push(next.id);
  }
  // Auto-included labels join the selection via their container clone order.
  for (const clone of clones) {
    if (!newIds.includes(clone.id)) newIds.push(clone.id);
  }
  return { elements: syncBoundTextOrigins([...els, ...clones]), newIds };
}

export type ZOrder = "forward" | "backward" | "front" | "back";

/**
 * Reorder for z-index actions (array order = paint order = z). Single-step
 * moves swap past one unselected neighbor; front/back are stable partitions.
 * Returns the input array unchanged when nothing moves.
 */
export function reorderElements(
  els: ExcalidrawElement[],
  ids: readonly string[],
  dir: ZOrder,
): ExcalidrawElement[] {
  const set = new Set(ids);
  if (set.size === 0) return els;
  if (dir === "front") {
    const moving = els.filter((el) => set.has(el.id));
    if (moving.length === 0 || moving.length === els.length) return els;
    if (els.slice(-moving.length).every((el) => set.has(el.id))) return els;
    return [...els.filter((el) => !set.has(el.id)), ...moving];
  }
  if (dir === "back") {
    const moving = els.filter((el) => set.has(el.id));
    if (moving.length === 0 || moving.length === els.length) return els;
    if (els.slice(0, moving.length).every((el) => set.has(el.id))) return els;
    return [...moving, ...els.filter((el) => !set.has(el.id))];
  }
  const next = [...els];
  let moved = false;
  if (dir === "forward") {
    for (let i = next.length - 2; i >= 0; i--) {
      if (set.has(next[i].id) && !set.has(next[i + 1].id)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        moved = true;
      }
    }
    return moved ? next : els;
  }
  for (let i = 1; i < next.length; i++) {
    if (set.has(next[i].id) && !set.has(next[i - 1].id)) {
      [next[i], next[i - 1]] = [next[i - 1], next[i]];
      moved = true;
    }
  }
  return moved ? next : els;
}

/** Nudge the selection by (dx, dy). Locked elements never move. */
export function nudgeElements(
  els: ExcalidrawElement[],
  ids: readonly string[],
  dx: number,
  dy: number,
): ExcalidrawElement[] {
  if (dx === 0 && dy === 0) return els;
  const set = new Set(expandMoveIds(els, ids));
  let touched = false;
  const next = els.map((el) => {
    if (!set.has(el.id) || el.locked) return el;
    touched = true;
    return shiftElement(el, dx, dy);
  });
  return touched ? syncBoundTextOrigins(next) : els;
}

/** Set `locked` on the selection (pure — caller commits). */
export function setElementsLocked(
  els: ExcalidrawElement[],
  ids: readonly string[],
  locked: boolean,
): ExcalidrawElement[] {
  const set = new Set(ids);
  return els.map((el) => (set.has(el.id) ? { ...el, locked } : el));
}

/** Set `link` on the selection (pure — caller commits). */
export function setElementsLink(
  els: ExcalidrawElement[],
  ids: readonly string[],
  link: string | null,
): ExcalidrawElement[] {
  const set = new Set(ids);
  return els.map((el) => (set.has(el.id) ? { ...el, link } : el));
}
