import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  connectorAbsolutePoints,
  getElementBounds,
  isConnector,
  unionBounds,
  type BoundingBox,
} from "./geometry";
import {
  getResizeHandles,
  getRotateHandle,
  type ResizeHandle,
} from "./geometryEdit";
import type { ResolvedEndpoints } from "./bindings";
import { arrowPath } from "./bindings";
import { LABEL_PILL_PAD_X, LABEL_PILL_PAD_Y } from "./textMeasure";
import { drawNativeElement, type PaintOpts, type TextLayout } from "./paint";

export type { TextLayout };

/** Renderable element: native Excalidraw. */
export type RenderElement = ExcalidrawElement;

export interface RenderOptions {
  selectedIds: string[];
  /** Resolved (binding-aware) endpoints for arrows/lines by element id. */
  resolvedEnds?: Map<string, ResolvedEndpoints>;
  /** Resolved label anchors for bound texts by element id. */
  textAnchors?: Map<string, WhiteboardPoint>;
  /** Text ids (arrow labels) that render on a board-colored pill. */
  pillIds?: Set<string>;
  /** Pre-wrapped text layouts so render == bounds == hit-test. */
  textLayouts?: Map<string, TextLayout>;
  /** Marquee rubber band in board coords. */
  marquee?: BoundingBox | null;
  /** Element id to highlight as a bind candidate while drawing an arrow. */
  bindHighlightId?: string | null;
  /** Exact snap point on the highlight target boundary (magnetic preview). */
  bindAnchor?: WhiteboardPoint | null;
  /** Union-box resize handles for multi-selection. */
  unionHandles?: ResizeHandle[];
  /** Precomputed union box (binding-aware) for multi-selection. */
  unionBox?: BoundingBox | null;
  /** Binding-aware selection boxes for single selection by element id. */
  boundsOverride?: Map<string, BoundingBox>;
  /** Suppress resize handles (e.g. bound text moves via its container). */
  noHandles?: boolean;
  /** Current viewport zoom: UI chrome counter-scales so handles stay grabbable. */
  zoom?: number;
}

/** Draw one element. Assumes ctx transform already accounts for devicePixelRatio. */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: RenderElement,
  opts?: PaintOpts,
): void {
  drawNativeElement(ctx, el, opts);
}

/** Element ids already warned about (render faults log once, not per frame). */
const warnedRenderFaults = new Set<string>();

function warnRenderFault(id: string, err: unknown): void {
  if (warnedRenderFaults.has(id)) return;
  warnedRenderFaults.add(id);
  console.warn("[whiteboard] skipping element that failed to render", { id, err });
}

export interface DrawOpts extends PaintOpts {
  resolvedEnds?: Map<string, ResolvedEndpoints>;
  /** Current viewport zoom for UI counter-scaling. */
  zoom?: number;
}

/**
 * Label boxes per connector id, so the stroke leaves a gap behind each
 * bound label pill. Mirrors getTextBounds sizing (estimated width + pill
 * padding, centered on the anchor).
 */
function collectLabelGaps(
  elements: RenderElement[],
  opts?: RenderOptions,
): Map<string, BoundingBox[]> {
  const gaps = new Map<string, BoundingBox[]>();
  if (!opts?.textAnchors || !opts?.textLayouts) return gaps;
  const { textAnchors, textLayouts } = opts;
  for (const el of elements) {
    if (!isConnector(el)) continue;
    const bound = el.boundElements;
    if (!bound || bound.length === 0) continue;
    const boxes: BoundingBox[] = [];
    for (const b of bound) {
      if (b.type !== "text") continue;
      const anchor = textAnchors.get(b.id);
      const layout = textLayouts.get(b.id);
      if (!anchor || !layout) continue;
      const w = layout.width + LABEL_PILL_PAD_X * 2;
      const h = layout.height + LABEL_PILL_PAD_Y * 2;
      boxes.push({
        minX: anchor.x - w / 2,
        minY: anchor.y - h / 2,
        maxX: anchor.x + w / 2,
        maxY: anchor.y + h / 2,
      });
    }
    if (boxes.length > 0) gaps.set(el.id, boxes);
  }
  return gaps;
}

export function drawSelectionBox(ctx: CanvasRenderingContext2D, box: BoundingBox, zoom = 1): void {
  const z = zoom > 0 ? zoom : 1;
  const pad = 6 / z;
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.5 / z;
  ctx.setLineDash([4 / z, 4 / z]);
  ctx.strokeRect(
    box.minX - pad,
    box.minY - pad,
    box.maxX - box.minX + pad * 2,
    box.maxY - box.minY + pad * 2,
  );
  ctx.restore();
}

export function drawHandles(
  ctx: CanvasRenderingContext2D,
  handles: ResizeHandle[],
  zoom = 1,
): void {
  const z = zoom > 0 ? zoom : 1;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.5 / z;
  const size = 8 / z;
  const half = size / 2;
  for (const h of handles) {
    ctx.fillRect(h.x - half, h.y - half, size, size);
    ctx.strokeRect(h.x - half, h.y - half, size, size);
  }
  ctx.restore();
}

/** Rotation handle: stem from the box top-center to a round grip. */
export function drawRotateHandle(
  ctx: CanvasRenderingContext2D,
  box: BoundingBox,
  zoom = 1,
): void {
  const z = zoom > 0 ? zoom : 1;
  const h = getRotateHandle(box, z);
  const cx = (box.minX + box.maxX) / 2;
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.5 / z;
  ctx.beginPath();
  ctx.moveTo(cx, box.minY);
  ctx.lineTo(h.x, h.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(h.x, h.y, 6 / z, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Circular-arrow glyph so the grip reads as "rotate".
  ctx.beginPath();
  ctx.arc(h.x, h.y, 2.5 / z, -0.4, Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  elements: RenderElement[],
  draft: RenderElement | null,
  selectedIds: string[] | string | null,
  opts?: RenderOptions,
): void {
  let ids: string[];
  if (Array.isArray(selectedIds)) ids = selectedIds;
  else if (selectedIds) ids = [selectedIds];
  else ids = opts?.selectedIds ?? [];
  const { width, height } = ctx.canvas;
  // Clear in device px under the identity transform: callers paint with a
  // world-space (pan/zoom) transform that must not affect the clear region.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
  // One resolved path per connector shared by draw, selection and labels —
  // this is what keeps arrows glued to shapes while they move.
  // Each element is isolated: one corrupt element logs once and is skipped
  // instead of blanking the whole board (clearRect already ran).
  const paths = new Map<string, WhiteboardPoint[]>();
  const collectPaths = (el: RenderElement) => {
    try {
      if (!isConnector(el)) return;
      paths.set(el.id, arrowPath(elements, el));
    } catch (err) {
      warnRenderFault(el.id, err);
    }
  };
  for (const el of elements) collectPaths(el);
  if (draft && isConnector(draft)) {
    paths.set(draft.id, connectorAbsolutePoints(draft));
  }
  const drawOpts: DrawOpts = {
    resolvedEnds: opts?.resolvedEnds,
    paths,
    textAnchors: opts?.textAnchors,
    pillIds: opts?.pillIds,
    textLayouts: opts?.textLayouts,
    labelGaps: collectLabelGaps(elements, opts),
    zoom: opts?.zoom ?? 1,
  };
  for (const el of elements) {
    try {
      drawElement(ctx, el, drawOpts);
    } catch (err) {
      warnRenderFault(el.id, err);
    }
  }
  if (draft) {
    try {
      drawElement(ctx, draft, drawOpts);
    } catch (err) {
      warnRenderFault(draft.id, err);
    }
  }

  if (opts?.bindHighlightId) {
    const target = elements.find((e) => e.id === opts.bindHighlightId);
    if (target) {
      const z = opts.zoom && opts.zoom > 0 ? opts.zoom : 1;
      ctx.save();
      const b = getElementBounds(target);
      // Magnetic-range halo (hover tier): faint fill shows the snap zone.
      ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
      ctx.fillRect(b.minX - 28, b.minY - 28, b.maxX - b.minX + 56, b.maxY - b.minY + 56);
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.strokeRect(b.minX - 4, b.minY - 4, b.maxX - b.minX + 8, b.maxY - b.minY + 8);
      ctx.restore();
    }
    // Exact snap-point dot (sticky side+focus anchor preview).
    if (opts?.bindAnchor) {
      const z = opts.zoom && opts.zoom > 0 ? opts.zoom : 1;
      ctx.save();
      ctx.fillStyle = "#3b82f6";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(opts.bindAnchor.x, opts.bindAnchor.y, 5 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  if (ids.length === 1) {
    const sel = elements.find((e) => e.id === ids[0]);
    if (sel) {
      const z = opts?.zoom ?? 1;
      const box = opts?.boundsOverride?.get(sel.id) ?? getElementBounds(sel);
      drawSelectionBox(ctx, box, z);
      if (!opts?.noHandles) {
        drawHandles(ctx, getResizeHandles(sel, undefined, opts?.resolvedEnds?.get(sel.id)), z);
        // Rotate grip for shapes/freedraw (connectors rotate via endpoints,
        // bound labels via their container). The drag writes `angle`; paint
        // stays axis-aligned (rotation renders in a later pass).
        if (
          (sel.type === "rectangle" ||
            sel.type === "ellipse" ||
            sel.type === "diamond" ||
            sel.type === "freedraw") &&
          !sel.locked
        ) {
          drawRotateHandle(ctx, box, z);
        }
      }
    }
  } else if (ids.length > 1) {
    const union =
      opts?.unionBox ??
      unionBounds(
        ids
          .map((id) => elements.find((e) => e.id === id))
          .filter((e) => e !== undefined)
          .map((e) => getElementBounds(e as RenderElement)),
      );
    if (union) {
      drawSelectionBox(ctx, union, opts?.zoom ?? 1);
      if (opts?.unionHandles) drawHandles(ctx, opts.unionHandles, opts?.zoom ?? 1);
    }
  }

  if (opts?.marquee) {
    const m = opts.marquee;
    const z = opts.zoom && opts.zoom > 0 ? opts.zoom : 1;
    ctx.save();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1 / z;
    ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
    ctx.fillRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY);
    ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY);
    ctx.restore();
  }
}
