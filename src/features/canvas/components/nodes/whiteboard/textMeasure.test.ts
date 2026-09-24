import { describe, it, expect } from "vitest";
import { measureTextBlock, boundWrapWidth } from "./textMeasure";

describe("measureTextBlock", () => {
  it("measures single-line auto-width text", () => {
    const b = measureTextBlock("hi", 14, null);
    expect(b.lines).toEqual(["hi"]);
    expect(b.width).toBeCloseTo(2 * 14 * 0.55, 5);
    expect(b.height).toBeCloseTo(14 * 1.25, 5);
  });

  it("preserves newlines as separate lines", () => {
    const b = measureTextBlock("a\nb\nc", 14, null);
    expect(b.lines).toEqual(["a", "b", "c"]);
    expect(b.height).toBeCloseTo(3 * 14 * 1.25, 5);
  });

  it("wraps long paragraphs to a fixed width", () => {
    const b = measureTextBlock("hello world foo bar", 14, 60);
    expect(b.lines.length).toBeGreaterThan(1);
    for (const l of b.lines) {
      expect(l.length * 14 * 0.55).toBeLessThanOrEqual(60 + 14 * 0.55);
    }
  });

  it("hard-breaks a single long word", () => {
    const b = measureTextBlock("supercalifragilistic", 14, 40);
    expect(b.lines.length).toBeGreaterThan(1);
    expect(b.lines.join("")).toBe("supercalifragilistic");
  });

  it("keeps empty lines", () => {
    const b = measureTextBlock("a\n\nb", 14, null);
    expect(b.lines).toEqual(["a", "", "b"]);
  });
});

describe("boundWrapWidth", () => {
  it("subtracts padding with a minimum", () => {
    expect(boundWrapWidth(100)).toBe(100 - 32);
    expect(boundWrapWidth(20)).toBe(40);
  });
});
