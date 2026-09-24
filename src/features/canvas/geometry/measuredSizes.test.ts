import { describe, expect, it } from "vitest";
import { DEFAULT_NODE_SIZE, isCollapsedGeometry, resolveRenderGeometry } from "./measuredSizes";
import { FALLBACK_HEADER_H } from "../layout/portLayout";

describe("resolveRenderGeometry", () => {
  it("prefers measured sizes over DTO dimensions", () => {
    const g = resolveRenderGeometry(
      { id: "n1", x: 60, y: 80, width: 280, height: 220 },
      { n1: { width: 280, height: 164 } },
    );
    expect(g).toEqual({ x: 60, y: 80, width: 280, height: 164 });
  });

  it("falls back to DTO dimensions before first measurement", () => {
    const g = resolveRenderGeometry({ id: "n2", x: 10, y: 20, width: 320, height: 240 }, {});
    expect(g).toEqual({ x: 10, y: 20, width: 320, height: 240 });
  });

  it("falls back to defaults when DTO dimensions are missing", () => {
    const g = resolveRenderGeometry({ id: "n3", x: 0, y: 0, width: null, height: null }, {});
    expect(g).toEqual({ x: 0, y: 0, width: 320, height: 220 });
  });

  it("keeps live DTO position even with a measured size", () => {
    const g = resolveRenderGeometry(
      { id: "n1", x: 500, y: 600, width: 280, height: 220 },
      { n1: { width: 280, height: 164 } },
    );
    expect(g.x).toBe(500);
    expect(g.y).toBe(600);
  });

  it("shares one fallback size constant", () => {
    expect(DEFAULT_NODE_SIZE).toEqual({ width: 320, height: 220 });
  });
});

describe("isCollapsedGeometry", () => {
  it("treats a header-only box as collapsed", () => {
    expect(isCollapsedGeometry({ x: 0, y: 0, width: 240, height: 37 }, FALLBACK_HEADER_H)).toBe(
      true,
    );
  });

  it("treats a full-height box as open", () => {
    expect(isCollapsedGeometry({ x: 0, y: 0, width: 320, height: 220 }, FALLBACK_HEADER_H)).toBe(
      false,
    );
  });
});
