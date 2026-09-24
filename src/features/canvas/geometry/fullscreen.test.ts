import { describe, expect, it } from "vitest";
import { computeFullscreenLayout } from "./fullscreen";

describe("computeFullscreenLayout", () => {
  it("pins the node top-left to the padded origin at zoom 1", () => {
    const layout = computeFullscreenLayout(100, 200, 1000, 800);
    expect(layout).toEqual({
      zoom: 1,
      panX: 16 - 100,
      panY: 64 - 200,
      width: 1000 - 32,
      height: 800 - 64 - 16,
    });
  });

  it("keeps node x/y out of the equation except for the pan offset", () => {
    const a = computeFullscreenLayout(0, 0, 1200, 900);
    const b = computeFullscreenLayout(-500, 3000, 1200, 900);
    expect(a?.width).toBe(b?.width);
    expect(a?.height).toBe(b?.height);
    expect(b?.panX).toBe(16 + 500);
    expect(b?.panY).toBe(64 - 3000);
  });

  it("clamps to usable minimums on tiny containers", () => {
    const layout = computeFullscreenLayout(0, 0, 100, 100);
    expect(layout?.width).toBe(240);
    expect(layout?.height).toBe(140);
  });

  it("returns null for degenerate containers", () => {
    expect(computeFullscreenLayout(0, 0, 0, 800)).toBeNull();
    expect(computeFullscreenLayout(0, 0, 800, 0)).toBeNull();
  });
});
