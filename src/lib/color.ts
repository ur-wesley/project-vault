/**
 * Normalize a user-entered hex color to lowercase `#rrggbb`.
 * Returns `fallback` for empty/invalid input.
 * (Extracted from PluginDashboard's config form; single home for color input.)
 */
export function normalizeHexColor(value: string, fallback = "#000000"): string {
  let hex = value.trim();
  if (!hex) return fallback;
  if (!hex.startsWith("#")) hex = `#${hex}`;
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(hex);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  return fallback;
}
