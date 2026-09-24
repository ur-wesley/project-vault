import type { WhiteboardElement, WhiteboardPoint } from "./types";
import { FONT_STACKS } from "./types";
import {
  getElementBounds,
  normalizeBox,
  diamondVertices,
  unionBounds,
  getResizeHandles,
  flattenSmoothPath,
  splitPathAtBox,
  type BoundingBox,
  type ResizeHandle,
} from "./geometry";
import type { ResolvedEndpoints } from "./bindings";
import { arrowPath } from "./bindings";
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_LINES,
  LABEL_PILL_PAD_X,
  LABEL_PILL_PAD_Y,
  measureTextBlock,
} from "./textMeasure";

export interface RenderOptions {
  selectedIds: string[];
  /** Resolved (binding-aware) endpoints for arrows/lines by element id. */
  resolvedEnds?: Map<string, ResolvedEndpoints>;
  /** Resolved label anchors for bound/group-label texts by element id. */
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
  /** Suppress resize handles (e.g. bound text moves via offset instead). */
  noHandles?: boolean;
  /** Current viewport zoom: UI chrome counter-scales so handles stay grabbable. */
  zoom?: number;
}

/**
 * Full draw path for a connector. Prefers the precomputed binding-aware
 * path (resolved ends + relative waypoints, see bindings.arrowPath) so
 * render, hit-test and selection boxes all agree — even while a bound
 * shape is being dragged. Falls back to stored coords without bindings.
 */
function pathOf(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  opts?: DrawOpts,
): WhiteboardPoint[] {
  return opts?.paths?.get(el.id) ?? [el.start, ...el.waypoints, el.end];
}

/**
 * Stroke a connector path. The sparse control path is flattened first
 * (straight runs + bounded corner rounding), so the painted line stays
 * visibly on the bend points — the same dense path hit-test, selection
 * and labels use. Straight connectors stay straight.
 */
function strokeConnectorPath(ctx: CanvasRenderingContext2D, pts: WhiteboardPoint[]): void {
  const flat = flattenSmoothPath(pts);
  if (flat.length === 0) return;
  const head = flat[0];
  ctx.beginPath();
  ctx.moveTo(head.x, head.y);
  for (let i = 1; i < flat.length; i++) ctx.lineTo(flat[i].x, flat[i].y);
  ctx.stroke();
}

/** Painted (flattened) connector path for arrowhead tangents. */
function paintedPath(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  opts?: DrawOpts,
): WhiteboardPoint[] {
  return flattenSmoothPath(pathOf(el, opts));
}

/**
 * Label boxes per connector id, so the stroke leaves a gap behind each
 * bound label pill. Mirrors getTextBounds sizing (estimated width + pill
 * padding, centered on the anchor).
 */
function collectLabelGaps(
  elements: WhiteboardElement[],
  opts?: RenderOptions,
): Map<string, BoundingBox[]> {
  const gaps = new Map<string, BoundingBox[]>();
  if (!opts?.textAnchors || !opts?.textLayouts) return gaps;
  const { textAnchors, textLayouts } = opts;
  for (const el of elements) {
    if (el.kind !== "arrow" && el.kind !== "line") continue;
    if (el.boundElements.length === 0) continue;
    const boxes: BoundingBox[] = [];
    for (const b of el.boundElements) {
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

/**
 * Visible runs of a connector: the painted path with gaps cut where bound
 * labels sit, so the line breaks behind the pill. Heads and hit-test keep
 * using the full painted path.
 */
function connectorRuns(
  el: Extract<WhiteboardElement, { kind: "arrow" | "line" }>,
  painted: WhiteboardPoint[],
  opts?: DrawOpts,
): WhiteboardPoint[][] {
  const gaps = opts?.labelGaps?.get(el.id);
  if (!gaps || gaps.length === 0 || painted.length < 2) return [painted];
  const pad = (Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2) / 2 + 4;
  let runs = [painted];
  for (const gap of gaps) {
    const next: WhiteboardPoint[][] = [];
    for (const run of runs) next.push(...splitPathAtBox(run, gap, pad));
    runs = next;
    if (runs.length === 0) break;
  }
  return runs;
}

function applyStrokeDash(ctx: CanvasRenderingContext2D, el: WhiteboardElement): void {
  if (el.strokeStyle === "dashed") ctx.setLineDash([10, 7]);
  else if (el.strokeStyle === "dotted") ctx.setLineDash([2.5, 7]);
  else ctx.setLineDash([]);
}

function traceShapePath(
  ctx: CanvasRenderingContext2D,
  el: Extract<WhiteboardElement, { kind: "rectangle" | "ellipse" | "diamond" }>,
): void {
  const b = normalizeBox(el.start, el.end);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (el.kind === "rectangle") {
    if (el.roundness === "round") {
      const r = Math.min(10, w / 4, h / 4);
      ctx.beginPath();
      ctx.moveTo(b.minX + r, b.minY);
      ctx.arcTo(b.maxX, b.minY, b.maxX, b.minY + h, r);
      ctx.arcTo(b.maxX, b.minY + h, b.minX, b.minY + h, r);
      ctx.arcTo(b.minX, b.minY + h, b.minX, b.minY, r);
      ctx.arcTo(b.minX, b.minY, b.maxX, b.minY, r);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.rect(b.minX, b.minY, w, h);
    }
  } else if (el.kind === "ellipse") {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
  } else {
    const v = diamondVertices(b);
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
  }
}

/** Fill a shape according to background style (solid/hachure/cross-hatch). */
function fillShape(
  ctx: CanvasRenderingContext2D,
  el: Extract<WhiteboardElement, { kind: "rectangle" | "ellipse" | "diamond" }>,
): void {
  if (el.background === "transparent") return;
  const b = normalizeBox(el.start, el.end);
  ctx.save();
  traceShapePath(ctx, el);
  if (el.background === "solid") {
    ctx.fillStyle =
      typeof el.fillColor === "string" && el.fillColor.length > 0 ? el.fillColor : el.color;
    ctx.fill();
  } else {
    ctx.clip();
    ctx.strokeStyle =
      typeof el.fillColor === "string" && el.fillColor.length > 0 ? el.fillColor : el.color;
    ctx.lineWidth = Math.max(1, (Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2) / 2);
    ctx.setLineDash([]);
    const step = Math.max(7, el.strokeWidth * 3);
    const diag = b.maxX - b.minX + (b.maxY - b.minY);
    ctx.beginPath();
    for (let d = -diag; d < diag; d += step) {
      ctx.moveTo(b.minX + d, b.minY);
      ctx.lineTo(b.minX + d + (b.maxY - b.minY), b.maxY);
    }
    if (el.background === "cross-hatch") {
      for (let d = -diag; d < diag; d += step) {
        ctx.moveTo(b.minX + d, b.maxY);
        ctx.lineTo(b.minX + d + (b.maxY - b.minY), b.minY);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  tip: WhiteboardPoint,
  angle: number,
  kind: "arrow" | "dot",
  strokeWidth: number,
  color: string,
): void {
  if (kind === "dot") {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, Math.max(4, strokeWidth + 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const headLen = Math.max(10, strokeWidth * 4);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - headLen * Math.cos(angle - Math.PI / 6),
    tip.y - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    tip.x - headLen * Math.cos(angle + Math.PI / 6),
    tip.y - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/** Draw one element. Assumes ctx transform already accounts for devicePixelRatio. */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  opts?: DrawOpts,
): void {
  // Defensive fallbacks: foreign/hand-edited payloads may miss style fields
  // that sanitize would normally fill. Never let one bad value blank the board.
  const color = typeof el.color === "string" && el.color.length > 0 ? el.color : "#e5e5e5";
  const strokeWidth = Number.isFinite(el.strokeWidth) ? (el.strokeWidth as number) : 2;
  const opacity = Number.isFinite(el.opacity)
    ? Math.min(100, Math.max(10, el.opacity as number))
    : 100;
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = el.roundness === "sharp" ? "miter" : "round";
  applyStrokeDash(ctx, el);

  switch (el.kind) {
    case "freehand": {
      if (el.points.length < 2) {
        // Single dot tap.
        const p = el.points[0];
        if (p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, strokeWidth / 2), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
      ctx.stroke();
      break;
    }
    case "rectangle":
    case "ellipse":
    case "diamond": {
      fillShape(ctx, el);
      traceShapePath(ctx, el);
      ctx.stroke();
      break;
    }
    case "line": {
      const painted = paintedPath(el, opts);
      for (const run of connectorRuns(el, painted, opts)) strokeConnectorPath(ctx, run);
      if (painted.length >= 2) {
        const s = painted[0];
        const sNext = painted[1] ?? s;
        const e = painted[painted.length - 1];
        const ePrev = painted[painted.length - 2] ?? e;
        if (el.startArrow !== "none")
          drawHead(
            ctx,
            s,
            Math.atan2(s.y - sNext.y, s.x - sNext.x),
            el.startArrow,
            strokeWidth,
            color,
          );
        if (el.endArrow !== "none")
          drawHead(
            ctx,
            e,
            Math.atan2(e.y - ePrev.y, e.x - ePrev.x),
            el.endArrow,
            strokeWidth,
            color,
          );
      }
      break;
    }
    case "arrow": {
      const pts = paintedPath(el, opts);
      for (const run of connectorRuns(el, pts, opts)) strokeConnectorPath(ctx, run);
      if (pts.length >= 2) {
        const start = pts[0];
        const startNext = pts[1] ?? start;
        const end = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? end;
        if (el.startArrow !== "none")
          drawHead(
            ctx,
            start,
            Math.atan2(start.y - startNext.y, start.x - startNext.x),
            el.startArrow,
            strokeWidth,
            color,
          );
        // Arrows default to endArrow=arrow; "none" hides the head (line-like).
        if (el.endArrow !== "none")
          drawHead(
            ctx,
            end,
            Math.atan2(end.y - prev.y, end.x - prev.x),
            el.endArrow,
            strokeWidth,
            color,
          );
      }
      break;
    }
    case "text": {
      const anchor = opts?.textAnchors?.get(el.id);
      ctx.font = textFont(el);
      ctx.textBaseline = "middle";
      const layout = opts?.textLayouts?.get(el.id);
      const wrap = layout?.wrap ?? null;
      const rawText = typeof el.text === "string" ? el.text : "";
      const block =
        layout ??
        measureTextBlock(rawText, Number.isFinite(el.fontSize) ? el.fontSize : 16, wrap, {
          bold: el.bold,
          fontFamily: el.fontFamily,
        });
      const lines = block.lines.slice(0, TEXT_MAX_LINES);
      if (anchor) {
        // Bound/group label: centered on its anchor.
        drawLabelText(ctx, el, lines, block.width, anchor, opts?.pillIds?.has(el.id) ?? false);
      } else {
        drawFreeText(ctx, el, lines, block.width);
      }
      break;
    }
  }
  ctx.restore();
}

export function textFont(
  el: Pick<WhiteboardElement, "kind"> & {
    fontSize: number;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
  },
): string {
  const t = el as { fontSize: number; fontFamily: string; bold: boolean; italic: boolean };
  const size = Number.isFinite(t.fontSize) ? t.fontSize : 16;
  const stack = FONT_STACKS[t.fontFamily as keyof typeof FONT_STACKS] ?? FONT_STACKS.normal;
  return `${t.italic ? "italic " : ""}${t.bold ? "700 " : ""}${size}px ${stack}`;
}

/** Element ids already warned about (render faults log once, not per frame). */
const warnedRenderFaults = new Set<string>();

function warnRenderFault(id: string, err: unknown): void {
  if (warnedRenderFaults.has(id)) return;
  warnedRenderFaults.add(id);
  console.warn("[whiteboard] skipping element that failed to render", { id, err });
}

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  /** Wrap width used (null = auto-width). */
  wrap: number | null;
}

export interface DrawOpts {
  resolvedEnds?: Map<string, ResolvedEndpoints>;
  /** Precomputed binding-aware connector paths (render/hit-test/selection agree). */
  paths?: Map<string, WhiteboardPoint[]>;
  textAnchors?: Map<string, WhiteboardPoint>;
  /** Text ids (arrow labels) that render on a board-colored pill. */
  pillIds?: Set<string>;
  /** Pre-wrapped text layouts so render == bounds == hit-test. */
  textLayouts?: Map<string, TextLayout>;
  /** Label boxes per connector id: the stroke leaves a gap behind them. */
  labelGaps?: Map<string, BoundingBox[]>;
  /** Current viewport zoom for UI counter-scaling. */
  zoom?: number;
}

/** Centered label text; arrow labels get a board-colored pill behind them. */
function drawLabelText(
  ctx: CanvasRenderingContext2D,
  el: Extract<WhiteboardElement, { kind: "text" }>,
  lines: string[],
  estimatedWidth: number,
  anchor: WhiteboardPoint,
  pill: boolean,
): void {
  ctx.save();
  ctx.font = textFont(el);
  ctx.textAlign = "center";
  // Estimated width keeps the pill identical to getTextBounds (hit-test);
  // canvas measure would drift by a few px and cause selection flicker.
  const w = Math.max(estimatedWidth, 8);
  const fontSize = Number.isFinite(el.fontSize) ? el.fontSize : 16;
  const lineH = fontSize * TEXT_LINE_HEIGHT;
  const h = lineH * Math.max(lines.length, 1);
  if (pill) {
    const padX = 6;
    const padY = 3;
    const x = anchor.x - w / 2 - padX;
    const y = anchor.y - h / 2 - padY;
    const pw = w + padX * 2;
    const ph = h + padY * 2;
    const r = 4;
    // Manual rounded rect (no ctx.roundRect dependency for older webviews).
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + pw, y, x + pw, y + ph, r);
    ctx.arcTo(x + pw, y + ph, x, y + ph, r);
    ctx.arcTo(x, y + ph, x, y, r);
    ctx.arcTo(x, y, x + pw, y, r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = el.color;
  const top = anchor.y - h / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(typeof line === "string" ? line : "", anchor.x, top + i * lineH);
  });
  ctx.restore();
}

/** Free (unbound) text: top-left origin, multiline, honors fixed width + align. */
function drawFreeText(
  ctx: CanvasRenderingContext2D,
  el: Extract<WhiteboardElement, { kind: "text" }>,
  lines: string[],
  estimatedWidth: number,
): void {
  ctx.save();
  ctx.font = textFont(el);
  ctx.fillStyle = typeof el.color === "string" ? el.color : "#e5e5e5";
  const fontSize = Number.isFinite(el.fontSize) ? el.fontSize : 16;
  const lineH = fontSize * TEXT_LINE_HEIGHT;
  const boxW = Math.max(estimatedWidth, el.width ?? estimatedWidth);
  if (el.width != null && (el.textAlign === "center" || el.textAlign === "right")) {
    ctx.textAlign = el.textAlign;
    const cx = el.textAlign === "center" ? el.position.x + boxW / 2 : el.position.x + boxW;
    lines.forEach((line, i) => {
      ctx.fillText(typeof line === "string" ? line : "", cx, el.position.y + lineH / 2 + i * lineH);
    });
  } else {
    ctx.textAlign = el.textAlign === "right" && el.width == null ? "right" : "left";
    const x = el.textAlign === "right" && el.width == null ? el.position.x + boxW : el.position.x;
    lines.forEach((line, i) => {
      ctx.fillText(typeof line === "string" ? line : "", x, el.position.y + lineH / 2 + i * lineH);
    });
  }
  ctx.restore();
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

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  elements: WhiteboardElement[],
  draft: WhiteboardElement | null,
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
  for (const el of elements) {
    if (el.kind !== "arrow" && el.kind !== "line") continue;
    try {
      paths.set(el.id, arrowPath(elements, el));
    } catch (err) {
      warnRenderFault(el.id, err);
    }
  }
  if (draft && (draft.kind === "arrow" || draft.kind === "line")) {
    paths.set(draft.id, [draft.start, ...draft.waypoints, draft.end]);
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
      drawSelectionBox(ctx, opts?.boundsOverride?.get(sel.id) ?? getElementBounds(sel), z);
      if (!opts?.noHandles) {
        drawHandles(ctx, getResizeHandles(sel, undefined, opts?.resolvedEnds?.get(sel.id)), z);
      }
    }
  } else if (ids.length > 1) {
    const union =
      opts?.unionBox ??
      unionBounds(
        ids
          .map((id) => elements.find((e) => e.id === id))
          .filter((e) => e !== undefined)
          .map((e) => getElementBounds(e)),
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
