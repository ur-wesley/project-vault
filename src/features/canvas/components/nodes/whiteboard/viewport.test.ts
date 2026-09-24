import { describe, it, expect } from "vitest";
import {
  WB_MAX_ZOOM,
  WB_MIN_ZOOM,
  clampZoom,
  screenToWorld,
  worldToScreen,
  zoomAtScreen,
} from "./viewport";

describe("viewport math", () => {
  it("clamps zoom to canvas bounds", () => {
    expect(clampZoom(0)).toBe(WB_MIN_ZOOM);
    expect(clampZoom(99)).toBe(WB_MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("round-trips screen<->world", () => {
    const w = screenToWorld(100, 60, 20, 10, 2);
    expect(w).toEqual({ x: 40, y: 25 });
    expect(worldToScreen(w.x, w.y, 20, 10, 2)).toEqual({ x: 100, y: 60 });
  });

  it("keeps the world point under the cursor when zooming", () => {
    const before = screenToWorld(100, 60, 0, 0, 1);
    const step = zoomAtScreen(0, 0, 1, 100, 60, true);
    expect(step.zoom).toBeGreaterThan(1);
    const after = screenToWorld(100, 60, step.panX, step.panY, step.zoom);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});
