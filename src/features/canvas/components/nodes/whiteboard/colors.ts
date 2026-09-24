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

/**
 * Pure helper for auto-follow fills: when the patch changes the stroke
 * color without an explicit fill and `auto` is on, derive the fill tint.
 * Returns the patch to apply (original when no expansion needed).
 */
export function withAutoFill(
  patch: { color?: string; fillColor?: string },
  auto: boolean,
): { color?: string; fillColor?: string } {
  if (patch.fillColor !== undefined || patch.color === undefined || !auto) return patch;
  return { ...patch, fillColor: defaultFillForStroke(patch.color) };
}
