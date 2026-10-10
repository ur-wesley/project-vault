import type { ExcalidrawElement, ExcalidrawTextElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  connectorAbsolutePoints,
  diamondVertices,
  flattenSmoothPath,
  freedrawAbsolutePoints,
  normalizeXYWH,
  splitPathAtBox,
  type BoundingBox,
} from "./geometry";
import { fontStackFor, measureTextBlock, sanitizeLineHeight, TEXT_MAX_LINES } from "./textMeasure";
import {
  sanitizeRoughness,
  roughnessAmplitude,
  roundnessRadius,
  strokeRoughPolyline,
  type Roughness,
} from "./rough";

/** Pre-wrapped text layout so render == bounds == hit-test. */
export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  /** Wrap width used (null = auto-width). */
  wrap: number | null;
}

/**
 * Native element painters (Excalidraw `x/y/w/h`, seeded roughness).
 * Board orchestration (paths, selection chrome, marquee) lives in `./render`.
 */

/** Shared dash mapping for native `strokeStyle` (solid/dashed/dotted). */
export function applyStrokeDashStyle(ctx: CanvasRenderingContext2D, style: unknown): void {
  if (style === "dashed") ctx.setLineDash([10, 7]);
  else if (style === "dotted") ctx.setLineDash([2.5, 7]);
  else ctx.setLineDash([]);
}

function nativeSeed(el: ExcalidrawElement): number {
  if (typeof el.seed === "number" && Number.isFinite(el.seed)) return el.seed;
  let h = 0;
  const id = typeof el.id === "string" ? el.id : "";
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

function nativeRoughness(el: ExcalidrawElement): Roughness {
  return sanitizeRoughness((el as { roughness?: unknown }).roughness);
}

function nativeStrokeWidth(el: ExcalidrawElement): number {
  const w = (el as { strokeWidth?: unknown }).strokeWidth;
  if (typeof w === "number" && Number.isFinite(w)) return Math.min(20, Math.max(1, w));
  return 2;
}

function nativeOpacity(el: ExcalidrawElement): number {
  const o = (el as { opacity?: unknown }).opacity;
  if (typeof o === "number" && Number.isFinite(o)) return Math.min(100, Math.max(0, o));
  return 100;
}

/** Trace a native shape path (clean geometry — jitter applies at stroke time). */
export function traceNativeShapePath(
  ctx: CanvasRenderingContext2D,
  type: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: ExcalidrawElement["roundness"],
): void {
  const b = normalizeXYWH(x, y, w, h);
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (type === "rectangle") {
    const r = roundnessRadius(bw, bh, roundness);
    if (r > 0) {
      ctx.beginPath();
      ctx.moveTo(b.minX + r, b.minY);
      ctx.arcTo(b.maxX, b.minY, b.maxX, b.minY + bh, r);
      ctx.arcTo(b.maxX, b.minY + bh, b.minX, b.minY + bh, r);
      ctx.arcTo(b.minX, b.minY + bh, b.minX, b.minY, r);
      ctx.arcTo(b.minX, b.minY, b.maxX, b.minY, r);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.rect(b.minX, b.minY, bw, bh);
    }
  } else if (type === "ellipse") {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(bw) / 2, Math.abs(bh) / 2, 0, 0, Math.PI * 2);
  } else {
    const v = diamondVertices(b);
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
  }
}

/** Outline points of a native shape for rough stroking (closed loop). */
function nativeShapeOutline(
  type: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
  w: number,
  h: number,
  roundness: ExcalidrawElement["roundness"],
): WhiteboardPoint[] {
  const b = normalizeXYWH(x, y, w, h);
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (type === "diamond") return diamondVertices(b);
  if (type === "ellipse") {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rx = Math.abs(bw) / 2;
    const ry = Math.abs(bh) / 2;
    const pts: WhiteboardPoint[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }
  const r = roundnessRadius(bw, bh, roundness);
  if (r <= 0) {
    return [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
  }
  // Rounded rect sampled as polyline with arc corners.
  const corners: WhiteboardPoint[] = [];
  const seg = 4;
  const arcs = [
    { cx: b.maxX - r, cy: b.minY + r, a0: -Math.PI / 2, a1: 0 },
    { cx: b.maxX - r, cy: b.maxY - r, a0: 0, a1: Math.PI / 2 },
    { cx: b.minX + r, cy: b.maxY - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: b.minX + r, cy: b.minY + r, a0: Math.PI, a1: Math.PI * 1.5 },
  ];
  corners.push({ x: b.minX + r, y: b.minY });
  corners.push({ x: b.maxX - r, y: b.minY });
  for (const arc of arcs) {
    for (let i = 1; i <= seg; i++) {
      const a = arc.a0 + ((arc.a1 - arc.a0) * i) / seg;
      corners.push({ x: arc.cx + r * Math.cos(a), y: arc.cy + r * Math.sin(a) });
    }
    if (arc.a1 === 0) corners.push({ x: b.maxX, y: b.minY + r });
    if (arc.a1 === Math.PI / 2) corners.push({ x: b.maxX - r, y: b.maxY });
    if (arc.a1 === Math.PI) corners.push({ x: b.minX + r, y: b.maxY });
  }
  return corners;
}

/** Fill a native shape: solid or hachure/cross-hatch clipped to x/y/w/h. */
export function fillNativeShape(
  ctx: CanvasRenderingContext2D,
  type: "rectangle" | "ellipse" | "diamond",
  el: ExcalidrawElement,
): void {
  const fill = (el as { fillStyle?: unknown }).fillStyle;
  if (fill === "transparent" || fill == null) return;
  const bg = (el as { backgroundColor?: unknown }).backgroundColor;
  const paint = typeof bg === "string" && bg.length > 0 ? bg : "transparent";
  if (paint === "transparent") return;
  const b = normalizeXYWH(el.x, el.y, el.width, el.height);
  ctx.save();
  traceNativeShapePath(ctx, type, el.x, el.y, el.width, el.height, el.roundness);
  if (fill === "solid") {
    ctx.fillStyle = paint;
    ctx.fill();
  } else {
    ctx.clip();
    ctx.strokeStyle = paint;
    const sw = nativeStrokeWidth(el);
    ctx.lineWidth = Math.max(1, sw / 2);
    ctx.setLineDash([]);
    const step = Math.max(7, sw * 3);
    const diag = b.maxX - b.minX + (b.maxY - b.minY);
    ctx.beginPath();
    for (let d = -diag; d < diag; d += step) {
      ctx.moveTo(b.minX + d, b.minY);
      ctx.lineTo(b.minX + d + (b.maxY - b.minY), b.maxY);
    }
    if (fill === "cross-hatch") {
      for (let d = -diag; d < diag; d += step) {
        ctx.moveTo(b.minX + d, b.maxY);
        ctx.lineTo(b.minX + d + (b.maxY - b.minY), b.minY);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Stroke a native shape outline with seeded roughness. */
function strokeNativeShape(
  ctx: CanvasRenderingContext2D,
  type: "rectangle" | "ellipse" | "diamond",
  el: ExcalidrawElement,
): void {
  const roughness = nativeRoughness(el);
  const seed = nativeSeed(el);
  const sw = nativeStrokeWidth(el);
  if (roughness === 0) {
    traceNativeShapePath(ctx, type, el.x, el.y, el.width, el.height, el.roundness);
    ctx.stroke();
    return;
  }
  const outline = nativeShapeOutline(type, el.x, el.y, el.width, el.height, el.roundness);
  if (outline.length === 0) return;
  const amp = roughnessAmplitude(roughness, sw);
  void amp;
  strokeRoughPolyline(ctx, outline, { roughness, seed, strokeWidth: sw }, true);
}

/** Absolute connector points for a native arrow/line (x/y origin + relative). */
function nativeLinePoints(
  el: Extract<ExcalidrawElement, { type: "arrow" | "line" }>,
): WhiteboardPoint[] {
  return connectorAbsolutePoints(el);
}

export function textFontEx(el: { fontSize: number; fontFamily: number | string }): string {
  const size = Number.isFinite(el.fontSize) ? el.fontSize : 20;
  return `${size}px ${fontStackFor(el.fontFamily)}`;
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

export interface PaintOpts {
  /** Precomputed binding-aware connector paths (render/hit-test/selection agree). */
  paths?: Map<string, WhiteboardPoint[]>;
  textAnchors?: Map<string, WhiteboardPoint>;
  /** Text ids (arrow labels) that render on a board-colored pill. */
  pillIds?: Set<string>;
  /** Pre-wrapped text layouts so render == bounds == hit-test. */
  textLayouts?: Map<string, TextLayout>;
  /** Label boxes per connector id: the stroke leaves a gap behind them. */
  labelGaps?: Map<string, BoundingBox[]>;
}

/** Centered native label text with optional pill. */
function drawNativeLabelText(
  ctx: CanvasRenderingContext2D,
  el: ExcalidrawTextElement,
  lines: string[],
  estimatedWidth: number,
  anchor: WhiteboardPoint,
  pill: boolean,
): void {
  ctx.save();
  ctx.font = textFontEx({ fontSize: el.fontSize, fontFamily: el.fontFamily });
  ctx.textAlign = "center";
  const w = Math.max(estimatedWidth, 8);
  const fontSize = Number.isFinite(el.fontSize) ? el.fontSize : 20;
  const lineH = fontSize * sanitizeLineHeight(el.lineHeight);
  const h = lineH * Math.max(lines.length, 1);
  if (pill) {
    const padX = 6;
    const padY = 3;
    const x = anchor.x - w / 2 - padX;
    const y = anchor.y - h / 2 - padY;
    const pw = w + padX * 2;
    const ph = h + padY * 2;
    const r = 4;
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
  const rawColor = (el as { strokeColor?: unknown }).strokeColor;
  ctx.fillStyle = typeof rawColor === "string" ? rawColor : "#e5e5e5";
  const top = anchor.y - h / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(typeof line === "string" ? line : "", anchor.x, top + i * lineH);
  });
  ctx.restore();
}

/** Free native text: top-left origin, honors width/align/verticalAlign. */
function drawNativeFreeText(
  ctx: CanvasRenderingContext2D,
  el: ExcalidrawTextElement,
  lines: string[],
  estimatedWidth: number,
): void {
  ctx.save();
  ctx.font = textFontEx({ fontSize: el.fontSize, fontFamily: el.fontFamily });
  const rawColor = (el as { strokeColor?: unknown }).strokeColor;
  ctx.fillStyle = typeof rawColor === "string" ? rawColor : "#e5e5e5";
  const fontSize = Number.isFinite(el.fontSize) ? el.fontSize : 20;
  const lineH = fontSize * sanitizeLineHeight(el.lineHeight);
  const boxW = Math.max(estimatedWidth, el.width > 0 ? el.width : estimatedWidth);
  const boxH = Math.max(lineH * lines.length, el.height > 0 ? el.height : 0);
  let y0 = el.y;
  if (el.verticalAlign === "middle") y0 = el.y + (boxH - lineH * lines.length) / 2;
  if (el.verticalAlign === "bottom") y0 = el.y + boxH - lineH * lines.length;
  if (el.textAlign === "center" || el.textAlign === "right") {
    ctx.textAlign = el.textAlign;
    const cx = el.textAlign === "center" ? el.x + boxW / 2 : el.x + boxW;
    lines.forEach((line, i) => {
      ctx.fillText(typeof line === "string" ? line : "", cx, y0 + lineH / 2 + i * lineH);
    });
  } else {
    ctx.textAlign = "left";
    lines.forEach((line, i) => {
      ctx.fillText(typeof line === "string" ? line : "", el.x, y0 + lineH / 2 + i * lineH);
    });
  }
  ctx.restore();
}

/** Draw one native Excalidraw element (x/y/w/h, seeded roughness). */
export function drawNativeElement(
  ctx: CanvasRenderingContext2D,
  el: ExcalidrawElement,
  opts?: PaintOpts,
): void {
  const rawColor = (el as { strokeColor?: unknown }).strokeColor;
  const color = typeof rawColor === "string" && rawColor.length > 0 ? rawColor : "#e5e5e5";
  const strokeWidth = nativeStrokeWidth(el);
  const opacity = nativeOpacity(el);
  const roughness = nativeRoughness(el);
  const seed = nativeSeed(el);
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = el.roundness != null && el.roundness.type === 0 ? "miter" : "round";
  applyStrokeDashStyle(ctx, (el as { strokeStyle?: unknown }).strokeStyle);

  switch (el.type) {
    case "rectangle":
    case "ellipse":
    case "diamond": {
      fillNativeShape(ctx, el.type, el);
      strokeNativeShape(ctx, el.type, el);
      break;
    }
    case "freedraw": {
      const abs = freedrawAbsolutePoints(el as Extract<ExcalidrawElement, { type: "freedraw" }>);
      if (abs.length < 2) {
        const p = abs[0];
        if (p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, strokeWidth / 2), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      if (roughness === 0) {
        ctx.beginPath();
        ctx.moveTo(abs[0].x, abs[0].y);
        for (let i = 1; i < abs.length; i++) ctx.lineTo(abs[i].x, abs[i].y);
        ctx.stroke();
      } else {
        strokeRoughPolyline(ctx, abs, { roughness, seed, strokeWidth });
      }
      break;
    }
    case "line":
    case "arrow": {
      const linear = el as Extract<ExcalidrawElement, { type: "arrow" | "line" }>;
      const stored = nativeLinePoints(linear);
      const precomputed = opts?.paths?.get(el.id);
      const pts = precomputed ?? stored;
      const flat = flattenSmoothPath(pts);
      const gapBoxes = opts?.labelGaps?.get(el.id);
      let runs: WhiteboardPoint[][] = [flat];
      if (gapBoxes && gapBoxes.length > 0 && flat.length >= 2) {
        const pad = strokeWidth / 2 + 4;
        let cur = [flat];
        for (const gap of gapBoxes) {
          const next: WhiteboardPoint[][] = [];
          for (const run of cur) next.push(...splitPathAtBox(run, gap, pad));
          cur = next;
          if (cur.length === 0) break;
        }
        runs = cur;
      }
      if (roughness === 0) {
        for (const run of runs) {
          if (run.length === 0) continue;
          ctx.beginPath();
          ctx.moveTo(run[0].x, run[0].y);
          for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
          ctx.stroke();
        }
      } else {
        for (const run of runs) {
          if (run.length < 2) continue;
          strokeRoughPolyline(ctx, run, { roughness, seed, strokeWidth });
        }
      }
      if (flat.length >= 2) {
        const s = flat[0];
        const sNext = flat[1] ?? s;
        const e = flat[flat.length - 1];
        const ePrev = flat[flat.length - 2] ?? e;
        const startHead = (linear as { startArrowhead?: unknown }).startArrowhead;
        const endHead = (linear as { endArrowhead?: unknown }).endArrowhead;
        if (startHead === "arrow" || startHead === "triangle" || startHead === "bar") {
          drawHead(ctx, s, Math.atan2(s.y - sNext.y, s.x - sNext.x), "arrow", strokeWidth, color);
        } else if (startHead === "dot") {
          drawHead(ctx, s, 0, "dot", strokeWidth, color);
        }
        const wantsEnd = el.type === "arrow" ? endHead !== null : endHead != null;
        if (el.type === "arrow" && endHead == null) {
          drawHead(ctx, e, Math.atan2(e.y - ePrev.y, e.x - ePrev.x), "arrow", strokeWidth, color);
        } else if (wantsEnd && (endHead === "arrow" || endHead === "triangle" || endHead === "bar")) {
          drawHead(ctx, e, Math.atan2(e.y - ePrev.y, e.x - ePrev.x), "arrow", strokeWidth, color);
        } else if (wantsEnd && endHead === "dot") {
          drawHead(ctx, e, 0, "dot", strokeWidth, color);
        }
      }
      break;
    }
    case "text": {
      const t = el as ExcalidrawTextElement;
      const anchor = opts?.textAnchors?.get(el.id);
      ctx.font = textFontEx({ fontSize: t.fontSize, fontFamily: t.fontFamily });
      ctx.textBaseline = "middle";
      const layout = opts?.textLayouts?.get(el.id);
      const wrap = layout?.wrap ?? (t.autoResize ? null : t.width);
      const rawText = typeof t.text === "string" ? t.text : "";
      const block =
        layout ??
        measureTextBlock(rawText, Number.isFinite(t.fontSize) ? t.fontSize : 20, wrap, {
          fontFamily: t.fontFamily,
        });
      const lines = block.lines.slice(0, TEXT_MAX_LINES);
      if (anchor) {
        drawNativeLabelText(ctx, t, lines, block.width, anchor, opts?.pillIds?.has(el.id) ?? false);
      } else {
        drawNativeFreeText(ctx, t, lines, block.width);
      }
      break;
    }
    default: {
      break;
    }
  }
  ctx.restore();
}
