import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardTool } from "./types";
import { roundnessForToggle, isRoundRoundnessFor } from "./excalidrawDefaults";
import { defaultFillForStroke, withAutoBackground } from "./colors";
import { fontFamilyIdEx, fontFamilyNameEx } from "./textMeasure";
import { isConnector, isShapeElement, isTextElement } from "./geometry";

/**
 * Board style vocabulary (Excalidraw-native field names). The panel commits
 * these keys; {@link applyStylePatch} maps the UI unions (roundness toggle,
 * font names, arrowhead names) onto element fields. There are no legacy
 * `color`/`fillColor`/`background` aliases — one key per field.
 */

export type RoundnessName = "sharp" | "round";
export type FontName = "hand" | "normal" | "code";
export type ArrowheadName = "none" | "arrow" | "dot";
export type TextAlignName = "left" | "center" | "right";

export interface StylePatch {
  strokeColor?: string;
  strokeWidth?: number;
  fillStyle?: "transparent" | "solid" | "hachure" | "cross-hatch";
  backgroundColor?: string;
  strokeStyle?: "solid" | "dashed" | "dotted";
  opacity?: number;
  roundness?: RoundnessName;
  roughness?: 0 | 1 | 2;
  fontSize?: number;
  fontFamily?: FontName;
  textAlign?: TextAlignName;
  startArrowhead?: ArrowheadName;
  endArrowhead?: ArrowheadName;
}

export function defaultStyleFor(tool: WhiteboardTool): StylePatch {
  const base: StylePatch = {
    strokeColor: "#e5e5e5",
    strokeWidth: 2,
    fillStyle: "transparent",
    backgroundColor: "#3b82f6",
    strokeStyle: "solid",
    opacity: 100,
    roundness: "round",
    roughness: 1,
  };
  if (tool === "arrow") return { ...base, startArrowhead: "none", endArrowhead: "arrow" };
  if (tool === "line") return { ...base, startArrowhead: "none", endArrowhead: "none" };
  if (tool === "text") return { ...base, fontSize: 16, fontFamily: "normal", textAlign: "left" };
  return base;
}

/** Arrowhead name → native field (none = null). */
export function arrowheadToNative(h: ArrowheadName): "arrow" | "dot" | null {
  if (h === "arrow") return "arrow";
  if (h === "dot") return "dot";
  return null;
}

/** Native arrowhead field → panel name. */
export function arrowheadNameOf(raw: unknown, fallback: ArrowheadName): ArrowheadName {
  if (raw === "arrow" || raw === "triangle" || raw === "bar") return "arrow";
  if (raw === "dot") return "dot";
  if (raw === null || raw === undefined) return fallback;
  return "none";
}

/** Apply a style patch to one element; ignores fields that don't apply to its type. */
export function applyStylePatch(el: ExcalidrawElement, patch: StylePatch): ExcalidrawElement {
  const next = { ...el };
  if (patch.strokeColor !== undefined) next.strokeColor = patch.strokeColor;
  if (patch.strokeWidth !== undefined) next.strokeWidth = patch.strokeWidth;
  if (patch.strokeStyle !== undefined) next.strokeStyle = patch.strokeStyle;
  if (patch.opacity !== undefined) next.opacity = patch.opacity;
  if (patch.roughness !== undefined) next.roughness = patch.roughness;
  if (patch.roundness !== undefined) {
    next.roundness = roundnessForToggle(el.type, patch.roundness === "round");
  }
  if (isShapeElement(next)) {
    if (patch.fillStyle !== undefined) next.fillStyle = patch.fillStyle;
    if (patch.backgroundColor !== undefined) next.backgroundColor = patch.backgroundColor;
  }
  if (isConnector(next)) {
    if (patch.startArrowhead !== undefined) next.startArrowhead = arrowheadToNative(patch.startArrowhead);
    if (patch.endArrowhead !== undefined) next.endArrowhead = arrowheadToNative(patch.endArrowhead);
  }
  if (isTextElement(next)) {
    if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) next.fontFamily = fontFamilyIdEx(patch.fontFamily);
    if (patch.textAlign !== undefined) next.textAlign = patch.textAlign;
  }
  return next;
}

/**
 * Merged style of a selection: a field is present when every selected
 * element that supports it shares the same value, otherwise undefined
 * (mixed — toolbar shows indeterminate).
 */
export function selectionStyleFor(
  elements: ExcalidrawElement[],
  ids: readonly string[],
): StylePatch {
  const sel = elements.filter((el) => ids.includes(el.id));
  if (sel.length === 0) return {};
  const first = sel[0];
  const out: StylePatch = {};
  const same = <K extends keyof ExcalidrawElement>(k: K): boolean =>
    sel.every((el) => el[k] === first[k]);
  if (same("strokeColor")) out.strokeColor = first.strokeColor;
  if (same("strokeWidth")) out.strokeWidth = first.strokeWidth;
  if (same("strokeStyle")) out.strokeStyle = first.strokeStyle;
  if (same("opacity")) out.opacity = first.opacity;
  if (same("roughness")) out.roughness = first.roughness;
  const roundNames = sel.map((el) => (isRoundRoundnessFor(el.roundness) ? "round" : "sharp"));
  if (roundNames.every((r) => r === roundNames[0])) out.roundness = roundNames[0];
  if (sel.every(isShapeElement)) {
    if (same("fillStyle")) out.fillStyle = first.fillStyle;
    if (same("backgroundColor")) out.backgroundColor = first.backgroundColor;
  }
  if (sel.every(isConnector)) {
    const s = sel as Extract<ExcalidrawElement, { type: "arrow" | "line" }>[];
    const starts = s.map((el) => arrowheadNameOf(el.startArrowhead, "none"));
    const ends = s.map((el) => arrowheadNameOf(el.endArrowhead, el.type === "arrow" ? "arrow" : "none"));
    if (starts.every((h) => h === starts[0])) out.startArrowhead = starts[0];
    if (ends.every((h) => h === ends[0])) out.endArrowhead = ends[0];
  }
  if (sel.every(isTextElement)) {
    const t = sel as Extract<ExcalidrawElement, { type: "text" }>[];
    if (t.every((el) => el.fontSize === t[0].fontSize)) out.fontSize = t[0].fontSize;
    const families = t.map((el) => fontFamilyNameEx(el.fontFamily));
    if (families.every((f) => f === families[0])) out.fontFamily = families[0];
    if (t.every((el) => el.textAlign === t[0].textAlign)) out.textAlign = t[0].textAlign;
  }
  return out;
}

/**
 * True when every selected id resolves to a text bound to an arrow/line.
 * Those labels inherit the connector's styling — only size is settable.
 */
export function isArrowLabelOnly(
  elements: ExcalidrawElement[],
  ids: readonly string[],
): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el || !isTextElement(el) || !el.containerId) return false;
    const container = elements.find((e) => e.id === el.containerId);
    return !!container && isConnector(container);
  });
}

/**
 * Narrow a style patch for an arrow-label-only selection down to the
 * settable fields (font size). Returns the patch unchanged otherwise.
 */
export function scopePatchForSelection(
  elements: ExcalidrawElement[],
  ids: readonly string[],
  patch: StylePatch,
): StylePatch {
  if (!isArrowLabelOnly(elements, ids)) return patch;
  if (patch.fontSize === undefined) return {};
  return { fontSize: patch.fontSize };
}

/**
 * Inherit connector styling live: when selected arrows/lines are restyled,
 * their bound labels follow stroke color, opacity, and size. Pure — caller commits.
 */
export function propagateConnectorStyle(
  elements: ExcalidrawElement[],
  ids: readonly string[],
  patch: StylePatch,
): ExcalidrawElement[] {
  if (
    patch.strokeColor === undefined &&
    patch.opacity === undefined &&
    patch.fontSize === undefined
  ) {
    return elements;
  }
  const selected = new Set(ids);
  const styled = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    if (selected.has(el.id) && isConnector(el)) styled.set(el.id, el);
  }
  if (styled.size === 0) return elements;
  return elements.map((el) => {
    if (!isTextElement(el) || !el.containerId) return el;
    const container = styled.get(el.containerId);
    if (!container) return el;
    const next = { ...el };
    if (patch.strokeColor !== undefined) next.strokeColor = patch.strokeColor;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.fontSize !== undefined) {
      next.fontSize = Math.min(96, Math.max(8, Math.round(patch.fontSize)));
    }
    return next;
  });
}

/**
 * Auto-follow background (Excalidraw-like): while a tool's fill is still
 * automatic, changing its stroke color derives a lighter background tint.
 * Carried per tool by the store; this folds the rule into a patch.
 */
export function expandPatchAuto(patch: StylePatch, auto: boolean): StylePatch {
  if (patch.backgroundColor !== undefined) return patch;
  if (patch.strokeColor === undefined || !auto) return patch;
  return withAutoBackground(patch, true);
}

/** Reset tint for a stroke color (auto-fill re-enable). */
export function autoTintFor(stroke: string): string {
  return defaultFillForStroke(stroke);
}
