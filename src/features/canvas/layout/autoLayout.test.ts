import { describe, expect, it } from "vitest";
import type { CanvasNodeDto } from "~/types/dto";
import { calculateAutoLayout } from "./autoLayout";

const node = (id: string, height: number | null): CanvasNodeDto => ({
  id,
  nodeType: "notes",
  title: id,
  x: 999,
  y: 999,
  width: 320,
  height,
});

describe("calculateAutoLayout", () => {
  it("stacks by DTO dimensions when no measurements exist", () => {
    const [a, b] = calculateAutoLayout([node("a", 220), node("b", 220)], {});
    expect(a.x).toBe(60);
    expect(a.y).toBe(80);
    expect(b.y).toBe(80 + 220 + 30);
  });

  it("stacks by measured sizes so auto-height nodes pack tightly", () => {
    const nodes = [node("a", 220), node("b", 220)];
    const [a, b] = calculateAutoLayout(nodes, { a: { width: 320, height: 100 } });
    expect(a.height).toBe(100);
    expect(b.y).toBe(80 + 100 + 30);
  });

  it("applies the rendered width/height to the laid-out node", () => {
    const [a] = calculateAutoLayout([node("a", 220)], { a: { width: 300, height: 100 } });
    expect(a.width).toBe(300);
    expect(a.height).toBe(100);
  });
});
