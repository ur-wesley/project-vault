/** Color derivation for Excalidraw-like background tints. */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(raw: unknown): raw is string {
  return typeof raw === "string" && HEX_RE.test(raw);
}

export function normalizeHex(raw: unknown, fallback = "#e5e5e5"): string {
  return isHexColor(raw) ? raw.toLowerCase() : fallback;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function channel(v: number): string {
  return Math.min(255, Math.max(0, Math.round(v)))
    .toString(16)
    .padStart(2, "0");
}

export function rgbToHex(c: Rgb): string {
  return `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
}

/** Mix two hex colors: `weight` 0..1 is the share of `b`. */
export function mixHex(a: string, b: string, weight: number): string {
  const w = Math.min(1, Math.max(0, weight));
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * w,
    g: ca.g + (cb.g - ca.g) * w,
    b: ca.b + (cb.b - ca.b) * w,
  });
}

/** Lighten toward white by `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  return mixHex(hex, "#ffffff", amount);
}

/** Darken toward black by `amount` (0..1). */
export function darken(hex: string, amount: number): string {
  return mixHex(hex, "#000000", amount);
}

export interface FillVariant {
  id: string;
  label: string;
  value: string;
}

/**
 * Background swatches derived from a stroke color: two lighter tints and
 * one darker shade, Excalidraw-style. Transparent stays a background-type
 * choice, not a color.
 */
export function backgroundVariants(stroke: string): FillVariant[] {
  const base = normalizeHex(stroke);
  return [
    { id: "light", label: `Fill light (${base})`, value: lighten(base, 0.85) },
    { id: "soft", label: `Fill soft (${base})`, value: lighten(base, 0.6) },
    { id: "tone", label: `Fill tone (${base})`, value: lighten(base, 0.35) },
    { id: "dark", label: `Fill dark (${base})`, value: darken(base, 0.25) },
  ];
}

/** Default auto fill for a fresh stroke color (soft light tint). */
export function defaultFillForStroke(stroke: string): string {
  return lighten(normalizeHex(stroke), 0.8);
}

/** Excalidraw stroke palette (dark + neutrals + accents). */
export const EXCALIDRAW_STROKE_COLORS = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#0c8599",
  "#e5e5e5",
] as const;

/** Excalidraw background palette: "transparent" + tints. */
export const EXCALIDRAW_BACKGROUND_COLORS = [
  "transparent",
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#e5dbff",
  "#99e9f2",
  "#e5e5e5",
] as const;

export type ExcalidrawFillStyle = "transparent" | "solid" | "hachure" | "cross-hatch";
export const EXCALIDRAW_FILL_STYLES: ExcalidrawFillStyle[] = [
  "transparent",
  "solid",
  "hachure",
  "cross-hatch",
];

/** Excalidraw stroke widths: thin / base / bold. */
export const EXCALIDRAW_STROKE_WIDTHS = [1, 2, 4] as const;
export type ExcalidrawStrokeWidth = (typeof EXCALIDRAW_STROKE_WIDTHS)[number];

export type ExcalidrawStrokeStyle = "solid" | "dashed" | "dotted";
export const EXCALIDRAW_STROKE_STYLES: ExcalidrawStrokeStyle[] = ["solid", "dashed", "dotted"];

/** Roughness 0 Architect / 1 Artist / 2 Cartoonist. */
export const ROUGHNESS_LEVELS = [
  { value: 0, label: "Architect", hint: "Clean straight lines" },
  { value: 1, label: "Artist", hint: "Hand-drawn wobble" },
  { value: 2, label: "Cartoonist", hint: "Heavy double stroke" },
] as const;
export type RoughnessLevel = (typeof ROUGHNESS_LEVELS)[number]["value"];

/** Clamp to a valid Excalidraw stroke width (nearest of 1/2/4). */
export function sanitizeExStrokeWidth(raw: unknown): ExcalidrawStrokeWidth {
  if (raw === 1 || raw === 2 || raw === 4) return raw;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 2;
  if (raw <= 1.5) return 1;
  if (raw >= 3) return 4;
  return 2;
}

/** Clamp opacity to Excalidraw 0..100. */
export function sanitizeOpacityEx(raw: unknown, fallback = 100): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export function sanitizeFillStyle(raw: unknown): ExcalidrawFillStyle {
  if (raw === "solid" || raw === "hachure" || raw === "cross-hatch") return raw;
  return "transparent";
}

/**
 * Auto-follow for background fills: a strokeColor change derives a
 * backgroundColor tint while auto is on.
 */
export function withAutoBackground(
  patch: { strokeColor?: string; backgroundColor?: string },
  auto: boolean,
): { strokeColor?: string; backgroundColor?: string } {
  if (patch.backgroundColor !== undefined || patch.strokeColor === undefined || !auto) {
    return patch;
  }
  return { ...patch, backgroundColor: defaultFillForStroke(patch.strokeColor) };
}
