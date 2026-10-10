import { describe, it, expect } from "vitest";
import {
  backgroundVariants,
  darken,
  defaultFillForStroke,
  lighten,
  mixHex,
  normalizeHex,
  sanitizeExStrokeWidth,
  sanitizeFillStyle,
  sanitizeOpacityEx,
  withAutoBackground,
} from "./colors";

describe("mixHex / lighten / darken", () => {
  it("mixes toward white and black", () => {
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lighten("#ef4444", 0)).toBe("#ef4444");
    expect(darken("#ef4444", 0)).toBe("#ef4444");
    expect(lighten("#000000", 1)).toBe("#ffffff");
    expect(darken("#ffffff", 1)).toBe("#000000");
  });

  it("falls back for invalid input", () => {
    expect(normalizeHex("nope")).toBe("#e5e5e5");
    expect(lighten("nope", 0.5)).toBe(lighten("#e5e5e5", 0.5));
  });
});

describe("backgroundVariants", () => {
  it("derives lighter tints and a darker shade of the stroke", () => {
    const [light, soft, tone, dark] = backgroundVariants("#3b82f6");
    for (const v of [light, soft, tone, dark]) {
      expect(v.value).toMatch(/^#[0-9a-f]{6}$/);
    }
    const lum = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return r + g + b;
    };
    const base = lum("#3b82f6");
    expect(lum(light.value)).toBeGreaterThan(base);
    expect(lum(soft.value)).toBeGreaterThan(base);
    expect(lum(tone.value)).toBeGreaterThan(base);
    expect(lum(dark.value)).toBeLessThan(base);
    // Ordered light -> dark.
    expect(lum(light.value)).toBeGreaterThan(lum(soft.value));
    expect(lum(soft.value)).toBeGreaterThan(lum(tone.value));
  });
});

describe("withAutoBackground", () => {
  it("derives a fill tint when stroke changes and auto is on", () => {
    const out = withAutoBackground({ strokeColor: "#ef4444" }, true);
    expect(out.backgroundColor).toBe(defaultFillForStroke("#ef4444"));
  });

  it("keeps explicit backgrounds and respects manual mode", () => {
    expect(withAutoBackground({ strokeColor: "#ef4444", backgroundColor: "#000000" }, true)).toEqual({
      strokeColor: "#ef4444",
      backgroundColor: "#000000",
    });
    expect(withAutoBackground({ strokeColor: "#ef4444" }, false)).toEqual({
      strokeColor: "#ef4444",
    });
    expect(withAutoBackground({}, true)).toEqual({});
  });
});

describe("native sanitizers", () => {
  it("clamps stroke widths to the Excalidraw set", () => {
    expect(sanitizeExStrokeWidth(1)).toBe(1);
    expect(sanitizeExStrokeWidth(3)).toBe(4);
    expect(sanitizeExStrokeWidth(Number.NaN)).toBe(2);
  });

  it("clamps opacity to 0..100", () => {
    expect(sanitizeOpacityEx(-5)).toBe(0);
    expect(sanitizeOpacityEx(150)).toBe(100);
    expect(sanitizeOpacityEx("x")).toBe(100);
  });

  it("falls back to transparent fills", () => {
    expect(sanitizeFillStyle("solid")).toBe("solid");
    expect(sanitizeFillStyle("glitter")).toBe("transparent");
  });
});
