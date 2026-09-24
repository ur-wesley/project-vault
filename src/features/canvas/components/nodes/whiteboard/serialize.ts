import { parseNodeData } from "../../../nodes/base/parseNodeData";
import type { WhiteboardData, WhiteboardElement, WhiteboardPoint } from "./types";
import {
  WHITEBOARD_SCHEMA_VERSION,
  baseElement,
  DEFAULT_ELEMENT_STYLE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_CONNECTOR_ARROWS,
} from "./types";
import type { Arrowhead, BackgroundStyle, FontFamily, Roundness, StrokeStyleKind } from "./types";
import {
  sanitizeBool,
  sanitizeFontFamily,
  sanitizeTextAlign,
  sanitizeTextWidth,
} from "./textMeasure";

/** Hard caps so one whiteboard can't blow up the persisted layout. */
export const MAX_ELEMENTS = 2000;
export const MAX_JSON_BYTES = 200_000;
/** Max bend vertices per connector. */
export const MAX_WAYPOINTS = 24;

const COLORS = new Set([
  "#e5e5e5",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
]);

function isPoint(p: unknown): p is WhiteboardPoint {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    Number.isFinite(o.x) &&
    typeof o.y === "number" &&
    Number.isFinite(o.y)
  );
}

function sanitizeColor(c: unknown): string {
  return typeof c === "string" && (COLORS.has(c) || /^#[0-9a-fA-F]{6}$/.test(c)) ? c : "#e5e5e5";
}

function sanitizeWidth(w: unknown): number {
  return typeof w === "number" && Number.isFinite(w) ? Math.min(32, Math.max(1, Math.round(w))) : 2;
}

function sanitizeBackground(raw: unknown): BackgroundStyle {
  return raw === "solid" || raw === "hachure" || raw === "cross-hatch"
    ? raw
    : DEFAULT_ELEMENT_STYLE.background;
}

function sanitizeStrokeStyle(raw: unknown): StrokeStyleKind {
  return raw === "dashed" || raw === "dotted" ? raw : "solid";
}

function sanitizeRoundness(raw: unknown): Roundness {
  return raw === "sharp" ? "sharp" : "round";
}

function sanitizeOpacity(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(100, Math.max(10, Math.round(raw)))
    : 100;
}

function sanitizeArrowhead(raw: unknown, fallback: Arrowhead): Arrowhead {
  return raw === "arrow" || raw === "dot" || raw === "none" ? raw : fallback;
}

function sanitizeFontSize(raw: unknown, fallback = DEFAULT_TEXT_STYLE.fontSize): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(96, Math.max(8, Math.round(raw)))
    : fallback;
}

function sanitizeId(id: unknown): string | null {
  return typeof id === "string" && id.length > 0 ? id.slice(0, 64) : null;
}

function sanitizeGroupIds(raw: unknown): string[] {
  // Accept legacy plain-string groupId as well as arrays.
  let arr: unknown[];
  if (typeof raw === "string") arr = [raw];
  else if (Array.isArray(raw)) arr = raw;
  else arr = [];
  // v1 enforces single-level grouping.
  const first = arr.find((g) => typeof g === "string");
  return typeof first === "string" ? [first.slice(0, 64)] : [];
}

function sanitizeBoundElements(raw: unknown): { type: "text"; id: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { type: "text"; id: string }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = sanitizeId(o.id);
    if (o.type === "text" && id) out.push({ type: "text", id });
  }
  return out;
}

function sanitizeWaypoints(raw: unknown, legacyElbow: unknown): WhiteboardPoint[] {
  if (Array.isArray(raw)) {
    return raw.filter(isPoint).slice(0, MAX_WAYPOINTS);
  }
  // Legacy single-elbow boards (v1–v3): migrate the elbow into one waypoint.
  if (isPoint(legacyElbow)) return [legacyElbow];
  return [];
}

function sanitizeBinding(
  raw: unknown,
): {
  elementId: string;
  gap: number;
  side: "n" | "s" | "e" | "w" | null;
  focus: number | null;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const elementId = sanitizeId(o.elementId);
  if (!elementId) return null;
  const gap =
    typeof o.gap === "number" && Number.isFinite(o.gap) ? Math.min(64, Math.max(0, o.gap)) : 4;
  const side = o.side === "n" || o.side === "s" || o.side === "e" || o.side === "w" ? o.side : null;
  const focus =
    typeof o.focus === "number" && Number.isFinite(o.focus)
      ? Math.min(1, Math.max(-1, o.focus))
      : null;
  return { elementId, gap, side, focus };
}

function sanitizeElement(raw: unknown): WhiteboardElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = sanitizeId(o.id);
  if (!id || typeof o.kind !== "string") return null;
  const base = {
    ...baseElement(id, sanitizeColor(o.color), sanitizeWidth(o.strokeWidth), {
      background: sanitizeBackground(o.background),
      fillColor: sanitizeColor((o.fillColor ?? o.color) as unknown),
      strokeStyle: sanitizeStrokeStyle(o.strokeStyle),
      opacity: sanitizeOpacity(o.opacity),
      roundness: sanitizeRoundness(o.roundness),
    }),
    groupIds: sanitizeGroupIds(
      (o as { groupIds?: unknown }).groupIds ?? (o as { groupId?: unknown }).groupId,
    ),
    boundElements: sanitizeBoundElements(o.boundElements),
  };
  switch (o.kind) {
    case "freehand": {
      if (!Array.isArray(o.points)) return null;
      const points = (o.points as unknown[]).filter(isPoint).slice(0, 5000);
      if (points.length === 0) return null;
      return { ...base, kind: "freehand", points };
    }
    case "rectangle":
    case "ellipse":
    case "diamond": {
      if (!isPoint(o.start) || !isPoint(o.end)) return null;
      return { ...base, kind: o.kind, start: o.start, end: o.end };
    }
    case "arrow":
    case "line": {
      if (!isPoint(o.start) || !isPoint(o.end)) return null;
      const isArrow = o.kind === "arrow";
      return {
        ...base,
        kind: o.kind,
        start: o.start,
        end: o.end,
        startBinding: "startBinding" in o ? sanitizeBinding(o.startBinding) : null,
        endBinding: "endBinding" in o ? sanitizeBinding(o.endBinding) : null,
        startArrow: sanitizeArrowhead(o.startArrow, "none"),
        endArrow: sanitizeArrowhead(
          o.endArrow,
          isArrow ? DEFAULT_CONNECTOR_ARROWS.endArrow : "none",
        ),
        waypoints: sanitizeWaypoints(o.waypoints, o.elbow),
      };
    }
    case "text": {
      if (!isPoint(o.position) || typeof o.text !== "string") return null;
      const fontSize = sanitizeFontSize(o.fontSize, 14);
      const containerId = "containerId" in o ? sanitizeId(o.containerId) : null;
      const fontFamily: FontFamily = sanitizeFontFamily(o.fontFamily);
      return {
        ...base,
        kind: "text",
        position: o.position,
        text: o.text.slice(0, 2000),
        fontSize,
        fontFamily,
        bold: sanitizeBool(o.bold),
        italic: sanitizeBool(o.italic),
        containerId,
        labelGroupId: "labelGroupId" in o ? sanitizeId(o.labelGroupId) : null,
        offset: isPoint(o.offset) ? o.offset : { x: 0, y: 0 },
        width: sanitizeTextWidth(o.width),
        textAlign: sanitizeTextAlign(o.textAlign, containerId ? "center" : "left"),
      };
    }
    default:
      return null;
  }
}

export function sanitizeElements(raw: unknown): WhiteboardElement[] {
  if (!Array.isArray(raw)) return [];
  const out: WhiteboardElement[] = [];
  for (const item of raw) {
    const el = sanitizeElement(item);
    if (el) out.push(el);
    if (out.length >= MAX_ELEMENTS) break;
  }
  return out;
}

export function parseWhiteboardData(raw: string | null | undefined): WhiteboardData {
  const fallback: WhiteboardData = { version: WHITEBOARD_SCHEMA_VERSION, elements: [] };
  const parsed = parseNodeData<WhiteboardData>(raw, fallback);
  if (parsed === fallback) return fallback;
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const version = (parsed as { version?: unknown }).version;
  // v1-v4 boards migrate: same element kinds, new optional style fields default out.
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== WHITEBOARD_SCHEMA_VERSION
  ) {
    // Unknown future schema — don't try to migrate, start clean rather than corrupt.
    return fallback;
  }
  return { version: WHITEBOARD_SCHEMA_VERSION, elements: sanitizeElements(parsed.elements) };
}

export function encodeWhiteboardData(data: WhiteboardData): string | null {
  const trimmed: WhiteboardData = {
    version: WHITEBOARD_SCHEMA_VERSION,
    elements: data.elements.slice(0, MAX_ELEMENTS),
  };
  let json = JSON.stringify(trimmed);
  // Shrink freehand density until it fits the byte budget.
  let stride = 2;
  while (json.length > MAX_JSON_BYTES && stride <= 16) {
    const thinned = trimmed.elements.map((el) =>
      el.kind === "freehand" ? { ...el, points: el.points.filter((_, i) => i % stride === 0) } : el,
    );
    json = JSON.stringify({ ...trimmed, elements: thinned });
    stride *= 2;
  }
  return json;
}
