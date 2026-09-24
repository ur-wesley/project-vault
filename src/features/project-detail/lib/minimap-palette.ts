/**
 * Theme-aware minimap palette. App CSS tokens (oklch) are resolved to
 * computed `rgb()` strings through a hidden probe element, because canvas
 * `fillStyle` support for oklch varies across the system webviews Tauri
 * targets. Resolved once and cached; call `refreshMinimapPalette()` after a
 * theme switch.
 */
export type MinimapPalette = {
  bar: string;
  strong: string;
  keyword: string;
  codeString: string;
  number: string;
  comment: string;
  typeName: string;
  caret: string;
  added: string;
  removed: string;
  search: string;
  viewportFill: string;
  viewportStroke: string;
};

const FALLBACK: MinimapPalette = {
  bar: "rgb(255,255,255)",
  strong: "rgb(255,255,255)",
  keyword: "rgb(255,120,120)",
  codeString: "rgb(120,200,120)",
  number: "rgb(230,180,100)",
  comment: "rgb(140,140,150)",
  typeName: "rgb(120,180,230)",
  caret: "rgb(255,255,255)",
  added: "rgb(90,200,120)",
  removed: "rgb(230,110,110)",
  search: "rgb(230,190,90)",
  viewportFill: "rgb(255,255,255)",
  viewportStroke: "rgb(255,255,255)",
};

const TOKEN_VARS: Record<keyof MinimapPalette, string> = {
  bar: "--muted-foreground",
  strong: "--foreground",
  keyword: "--primary",
  codeString: "--success",
  number: "--warning",
  comment: "--muted-foreground",
  typeName: "--info",
  caret: "--primary",
  added: "--success",
  removed: "--destructive",
  search: "--warning",
  viewportFill: "--foreground",
  viewportStroke: "--border",
};

let cached: MinimapPalette | null = null;

function resolveVar(name: string): string | null {
  try {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed && computed !== "" ? computed : null;
  } catch {
    return null;
  }
}

export function resolveMinimapPalette(): MinimapPalette {
  if (cached) return cached;
  const next = { ...FALLBACK };
  (Object.keys(TOKEN_VARS) as Array<keyof MinimapPalette>).forEach((key) => {
    next[key] = resolveVar(TOKEN_VARS[key]) ?? FALLBACK[key];
  });
  cached = next;
  return next;
}

export function refreshMinimapPalette(): MinimapPalette {
  cached = null;
  return resolveMinimapPalette();
}
