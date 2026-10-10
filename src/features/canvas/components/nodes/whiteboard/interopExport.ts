import type { ExcalidrawElement, ExcalidrawFiles, ExcalidrawScene } from "./excalidrawTypes";
import {
  connectorAbsolutePoints,
  freedrawAbsolutePoints,
  getElementBounds,
  unionBounds,
  type BoundingBox,
} from "./geometry";
import { INTEROP_EXPORT_PAD } from "./interop";
import { drawNativeElement } from "./paint";

/**
 * Phase 4 export side: canonical `.excalidraw` JSON, standalone SVG,
 * canvas paint for PNG, plus the browser download/clipboard helpers the
 * toolbar uses. Import/parse lives in `./interop`.
 */

/** Canonical `.excalidraw` file content for a scene. */
export function exportSceneJson(scene: ExcalidrawScene): string {
  const full: ExcalidrawScene = {
    type: "excalidraw",
    version: scene.version,
    source: scene.source,
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
  };
  return JSON.stringify(full, null, 2);
}

/** Union bounds of the visible scene (null when empty — exporters pad it). */
export function sceneBounds(scene: ExcalidrawScene): BoundingBox | null {
  const live = scene.elements.filter((el) => !el.isDeleted);
  if (live.length === 0) return null;
  return unionBounds(live.map((el) => getElementBounds(el)));
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}

function dashFor(style: unknown): string {
  if (style === "dashed") return ` stroke-dasharray="10 7"`;
  if (style === "dotted") return ` stroke-dasharray="2.5 7"`;
  return "";
}

function headPolygon(tip: { x: number; y: number }, angle: number, size: number): string {
  const x2 = tip.x - size * Math.cos(angle - Math.PI / 6);
  const y2 = tip.y - size * Math.sin(angle - Math.PI / 6);
  const x3 = tip.x - size * Math.cos(angle + Math.PI / 6);
  const y3 = tip.y - size * Math.sin(angle + Math.PI / 6);
  return `${num(tip.x)},${num(tip.y)} ${num(x2)},${num(y2)} ${num(x3)},${num(y3)}`;
}

const FONT_FOR: Record<number, string> = {
  1: `"Segoe Print", "Bradley Hand", cursive`,
  2: "system-ui, sans-serif",
  3: `ui-monospace, monospace`,
};

function arrowTipHead(
  tip: { x: number; y: number },
  from: { x: number; y: number },
  stroke: string,
  size: number,
): string {
  return `<polygon points="${headPolygon(tip, Math.atan2(tip.y - from.y, tip.x - from.x), size)}" fill="${escXml(stroke)}"/>`;
}

function endHeadSvg(
  kind: "arrow" | "line",
  endArrowhead: unknown,
  end: { x: number; y: number },
  prev: { x: number; y: number },
  stroke: string,
  size: number,
  sw: number,
): string {
  const arrowTip = endArrowhead === "arrow" || endArrowhead === "triangle" || endArrowhead === "bar";
  if (kind === "arrow") {
    if (endArrowhead === null || arrowTip) {
      return arrowTipHead(end, prev, stroke, size);
    }
    if (endArrowhead === "dot") {
      return `<circle cx="${num(end.x)}" cy="${num(end.y)}" r="${num(Math.max(4, sw + 2))}" fill="${escXml(stroke)}"/>`;
    }
    return "";
  }
  if (endArrowhead == null) return "";
  if (arrowTip) return arrowTipHead(end, prev, stroke, size);
  if (endArrowhead === "dot") {
    return `<circle cx="${num(end.x)}" cy="${num(end.y)}" r="${num(Math.max(4, sw + 2))}" fill="${escXml(stroke)}"/>`;
  }
  return "";
}

function elementSvg(el: ExcalidrawElement, files: ExcalidrawFiles): string {
  const stroke = typeof el.strokeColor === "string" ? el.strokeColor : "#1e1e1e";
  const sw = Number.isFinite(el.strokeWidth) ? el.strokeWidth : 2;
  const op = Number.isFinite(el.opacity) ? Math.min(100, Math.max(0, el.opacity)) / 100 : 1;
  const common = `stroke="${escXml(stroke)}" stroke-width="${num(sw)}" opacity="${num(op)}"${dashFor(el.strokeStyle)}`;
  switch (el.type) {
    case "rectangle": {
      const fill = el.fillStyle === "transparent" ? "none" : escXml(el.backgroundColor);
      return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}" fill="${fill}" ${common}/>`;
    }
    case "ellipse": {
      const fill = el.fillStyle === "transparent" ? "none" : escXml(el.backgroundColor);
      return `<ellipse cx="${num(el.x + el.width / 2)}" cy="${num(el.y + el.height / 2)}" rx="${num(Math.abs(el.width) / 2)}" ry="${num(Math.abs(el.height) / 2)}" fill="${fill}" ${common}/>`;
    }
    case "diamond": {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const fill = el.fillStyle === "transparent" ? "none" : escXml(el.backgroundColor);
      return `<polygon points="${num(cx)},${num(el.y)} ${num(el.x + el.width)},${num(cy)} ${num(cx)},${num(el.y + el.height)} ${num(el.x)},${num(cy)}" fill="${fill}" ${common}/>`;
    }
    case "frame": {
      const label =
        typeof el.name === "string" && el.name.length > 0
          ? `<text x="${num(el.x + 4)}" y="${num(el.y - 6)}" font-size="12" font-family="system-ui, sans-serif" fill="#888">${escXml(el.name)}</text>`
          : "";
      return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="6 4"/>${label}`;
    }
    case "image": {
      const file = el.fileId !== null ? files[el.fileId] : undefined;
      if (!file) return "";
      return `<image x="${num(el.x)}" y="${num(el.y)}" width="${num(el.width)}" height="${num(el.height)}" href="${escXml(file.dataURL)}"/>`;
    }
    case "freedraw": {
      const abs = freedrawAbsolutePoints(el);
      if (abs.length === 0) return "";
      const d = abs.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
      return `<path d="${d}" fill="none" ${common} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "line":
    case "arrow": {
      const abs = connectorAbsolutePoints(el);
      if (abs.length === 0) return "";
      const d = abs.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
      const size = Math.max(10, sw * 4);
      let heads = "";
      if (el.startArrowhead === "arrow" || el.startArrowhead === "triangle" || el.startArrowhead === "bar") {
        const s = abs[0];
        heads += arrowTipHead(s, abs[1] ?? s, stroke, size);
      }
      const end = abs[abs.length - 1];
      heads += endHeadSvg(el.type, el.endArrowhead, end, abs[abs.length - 2] ?? end, stroke, size, sw);
      return `<path d="${d}" fill="none" ${common} stroke-linecap="round"/>${heads}`;
    }
    case "text": {
      const font = FONT_FOR[el.fontFamily] ?? FONT_FOR[2];
      const lh = el.fontSize * 1.25;
      const tspans = el.text
        .split("\n")
        .map(
          (line, i) =>
            `<tspan x="${num(el.x)}" dy="${i === 0 ? 0 : num(lh)}">${escXml(line)}</tspan>`,
        )
        .join("");
      return `<text x="${num(el.x)}" y="${num(el.y + lh / 2)}" font-size="${num(el.fontSize)}" font-family="${escXml(font)}" fill="${escXml(stroke)}" opacity="${num(op)}">${tspans}</text>`;
    }
  }
}

/** Serialize a scene to standalone SVG (shape-compatible with excalidraw.com). */
export function exportSceneSvg(scene: ExcalidrawScene): string {
  const box = sceneBounds(scene);
  const minX = box ? box.minX - INTEROP_EXPORT_PAD : -INTEROP_EXPORT_PAD;
  const minY = box ? box.minY - INTEROP_EXPORT_PAD : -INTEROP_EXPORT_PAD;
  const width = box ? box.maxX - box.minX + INTEROP_EXPORT_PAD * 2 : 800;
  const height = box ? box.maxY - box.minY + INTEROP_EXPORT_PAD * 2 : 600;
  const bg =
    scene.appState.viewBackgroundColor !== "transparent"
      ? scene.appState.viewBackgroundColor
      : "#ffffff";
  const body = scene.elements
    .filter((el) => !el.isDeleted)
    .map((el) => elementSvg(el, scene.files))
    .filter((s) => s.length > 0)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="${num(minX)} ${num(minY)} ${num(width)} ${num(height)}"><rect x="${num(minX)}" y="${num(minY)}" width="${num(width)}" height="${num(height)}" fill="${escXml(bg)}"/>${body}</svg>`;
}

/** Paint a scene onto a 2d context (PNG path — callers size the canvas first). */
export function paintSceneOnCanvas(
  scene: ExcalidrawScene,
  ctx: CanvasRenderingContext2D,
  opts?: { scale?: number; background?: string },
): void {
  const scale = opts?.scale !== undefined && opts.scale > 0 ? opts.scale : 2;
  const box = sceneBounds(scene);
  const minX = (box ? box.minX : 0) - INTEROP_EXPORT_PAD;
  const minY = (box ? box.minY : 0) - INTEROP_EXPORT_PAD;
  const bg = opts?.background ?? scene.appState.viewBackgroundColor;
  ctx.save();
  ctx.scale(scale, scale);
  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    const w = box ? box.maxX - box.minX + INTEROP_EXPORT_PAD * 2 : 800;
    const h = box ? box.maxY - box.minY + INTEROP_EXPORT_PAD * 2 : 600;
    ctx.fillRect(minX, minY, w, h);
  }
  ctx.translate(-minX, -minY);
  for (const el of scene.elements) {
    if (el.isDeleted) continue;
    drawNativeElement(ctx, el);
  }
  ctx.restore();
}

/** Canvas pixel size for a PNG export at the given scale. */
export function pngExportSize(
  scene: ExcalidrawScene,
  scale = 2,
): { width: number; height: number } {
  const box = sceneBounds(scene);
  const w = box ? box.maxX - box.minX + INTEROP_EXPORT_PAD * 2 : 800;
  const h = box ? box.maxY - box.minY + INTEROP_EXPORT_PAD * 2 : 600;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Trigger a browser download for text content (`.excalidraw`/SVG/JSON). */
export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Copy text with the async clipboard API, falling back to a textarea. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Read a dropped/picked file as text (`.excalidraw`, `.json`, `.excalidrawlib`). */
export function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/** Render a scene to an offscreen canvas and download it as PNG. */
export function downloadScenePng(scene: ExcalidrawScene, filename: string, scale = 2): boolean {
  const { width, height } = pngExportSize(scene, scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  paintSceneOnCanvas(scene, ctx, { scale });
  const url = canvas.toDataURL("image/png");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
