import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint, WhiteboardTool } from "./types";
import {
  BIND_DISTANCE,
  DEFAULT_BIND_GAP,
  createBinding,
  findBindAnchor,
  findBindHover,
  pushOutByGap,
  type StickyBinding,
} from "./bindings";
import { isConnector, isShapeElement, normalizeBox } from "./geometry";
import { applyDrawModifiers } from "./geometryEdit";
import {
  createDraftElement,
  finishDraft,
  type DrawableTool,
} from "./elementOps";
import { decimatePoints } from "./geometry";
import type { StylePatch } from "./whiteboardStyle";

/**
 * Draw-tool gestures (pure logic — the pointer owns events and signals).
 * Press starts a collapsed draft, moves grow it (Shift = square, Alt =
 * centered for shapes), release normalizes and binds connector ends.
 */

const DRAW_TOOLS: DrawableTool[] = ["freehand", "rectangle", "ellipse", "diamond", "arrow", "line"];

/** True for tools that paint drafts (select/eraser/text never draft). */
export function isDrawableTool(t: WhiteboardTool): t is DrawableTool {
  return (DRAW_TOOLS as WhiteboardTool[]).includes(t);
}

/** Press-point binding for a new connector, or null (free placement). */
export function pressBinding(
  tool: DrawableTool,
  elements: ExcalidrawElement[],
  pt: WhiteboardPoint,
  zoom: number,
): StickyBinding | null {
  if (tool !== "arrow" && tool !== "line") return null;
  const anchor = findBindAnchor(elements, pt, BIND_DISTANCE / zoom);
  return anchor ? createBinding(anchor.element, pt, DEFAULT_BIND_GAP) : null;
}

/** Press-point draft for a draw tool (connectors start detached). */
export function beginDraw(
  tool: DrawableTool,
  pt: WhiteboardPoint,
  style: StylePatch,
  startBinding: StickyBinding | null,
): ExcalidrawElement {
  const draftEl = createDraftElement(tool, pt, style);
  if (isConnector(draftEl)) return { ...draftEl, startBinding };
  return draftEl;
}

export interface DrawUpdate {
  draft: ExcalidrawElement;
  highlight: string | null;
  anchor: WhiteboardPoint | null;
}

/** Grow a draft toward the pointer; connectors also preview bind targets. */
export function updateDraw(
  draft: ExcalidrawElement,
  start: WhiteboardPoint,
  pt: WhiteboardPoint,
  e: PointerEvent,
  elements: ExcalidrawElement[],
  zoom: number,
): DrawUpdate | null {
  if (draft.type === "freedraw") {
    // Relative points (translation-invariant capture).
    return {
      draft: {
        ...draft,
        points: [...draft.points, [pt.x - draft.x, pt.y - draft.y] as [number, number]],
      },
      highlight: null,
      anchor: null,
    };
  }
  if (!isConnector(draft) && !isShapeElement(draft)) return null;
  // Excalidraw modifiers: Shift locks squares/circles, Alt draws centered
  // on the press point (shapes only — connectors stay free).
  const shaped = isShapeElement(draft);
  const box = applyDrawModifiers(start, pt, {
    square: shaped && e.shiftKey,
    centered: shaped && e.altKey,
  });
  if (isConnector(draft)) {
    const next: ExcalidrawElement = {
      ...draft,
      points: [
        [box.start.x - draft.x, box.start.y - draft.y],
        [box.end.x - draft.x, box.end.y - draft.y],
      ],
    };
    // Connector binding preview: halo + snap dot while hovering shapes.
    const hover = findBindHover(elements, pt, undefined, BIND_DISTANCE / zoom);
    return { draft: next, highlight: hover?.element.id ?? null, anchor: hover?.point ?? null };
  }
  const b = normalizeBox(box.start, box.end);
  return {
    draft: { ...draft, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY },
    highlight: null,
    anchor: null,
  };
}

/** Normalize a finished draft (rebase origins, snap the free connector end). */
export function finishDraw(
  draft: ExcalidrawElement,
  pt: WhiteboardPoint,
  elements: ExcalidrawElement[],
  zoom: number,
  startBinding: StickyBinding | null,
  clickTol?: number,
): ExcalidrawElement | null {
  const tol = clickTol ?? 4 / zoom;
  if (draft.type === "freedraw") {
    const rel = decimatePoints(draft.points.map(([px, py]) => ({ x: px, y: py }))).map(
      (p): [number, number] => [p.x, p.y],
    );
    return finishDraft({ ...draft, points: rel.length > 0 ? rel : [[0, 0]] });
  }
  if (isConnector(draft)) {
    const abs = draft.points.map(([px, py]) => ({ x: draft.x + px, y: draft.y + py }));
    const first = abs[0] ?? { x: draft.x, y: draft.y };
    const last = abs[abs.length - 1] ?? { x: draft.x, y: draft.y };
    if (Math.hypot(last.x - first.x, last.y - first.y) < tol) return null;
    const snap = findBindAnchor(elements, pt, BIND_DISTANCE / zoom);
    const endBinding = snap ? createBinding(snap.element, pt, DEFAULT_BIND_GAP) : null;
    const snappedEnd = endBinding
      ? pushOutByGap(snap?.point ?? pt, endBinding.side, endBinding.gap)
      : pt;
    const rel: [number, number][] = [
      ...draft.points.slice(0, -1),
      [snappedEnd.x - draft.x, snappedEnd.y - draft.y],
    ];
    return finishDraft({ ...draft, points: rel, startBinding, endBinding });
  }
  if (isShapeElement(draft)) return finishDraft(draft);
  // Text drafts never exist (text commits via the overlay) — ignored.
  return null;
}
