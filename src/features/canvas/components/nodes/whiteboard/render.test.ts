import { describe, it, expect } from "vitest";
import { renderBoard } from "./render";
import { resolveEndpoints } from "./bindings";
import { newElement } from "./excalidrawDefaults";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "./excalidrawTypes";

function stubCtx() {
  const calls: string[] = [];
  const canvas = { width: 800, height: 600 };
  const ctx = new Proxy(
    { canvas },
    {
      get(_target, prop: string) {
        if (prop === "canvas") return canvas;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          void args;
          if (prop === "measureText") return { width: 10 };
          return undefined;
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("renderBoard smoke", () => {
  it("renders a mixed native board without throwing", () => {
    const shape = newElement("rectangle", {
      id: "s",
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      boundElements: [{ type: "text", id: "t1" }],
    });
    const arrow = newElement("arrow", {
      id: "a",
      x: 0,
      y: 0,
      width: 300,
      height: 80,
      points: [
        [0, 0],
        [150, 80],
        [300, 30],
      ],
      startBinding: { elementId: "s", gap: 4, focus: 0, side: "e" },
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
    }) as ExcalidrawArrowElement;
    const label = newElement("text", {
      id: "t1",
      x: 0,
      y: 0,
      text: "hello",
      fontSize: 14,
      containerId: "s",
      textAlign: "center",
    });
    const arrowLabel = newElement("text", {
      id: "t2",
      x: 0,
      y: 0,
      text: "edge",
      fontSize: 14,
      containerId: "a",
      textAlign: "center",
    });
    const els: ExcalidrawElement[] = [shape, arrow, label, arrowLabel];
    const ends = new Map([["a", resolveEndpoints(els, arrow)]]);
    const { ctx, calls } = stubCtx();
    expect(() =>
      renderBoard(ctx, els, null, ["s"], {
        selectedIds: ["s"],
        resolvedEnds: ends,
        textAnchors: new Map([
          ["t1", { x: 60, y: 35 }],
          ["t2", { x: 150, y: 15 }],
        ]),
        pillIds: new Set(["t2"]),
      }),
    ).not.toThrow();
    expect(calls).toContain("strokeRect");
    expect(calls).toContain("fillText");
  });

  it("renders drafts, marquees, multi-selection and bind highlights", () => {
    const { ctx, calls } = stubCtx();
    const draft = newElement("freedraw", {
      id: "d",
      x: 1,
      y: 1,
      points: [
        [0, 0],
        [4, 4],
      ],
    });
    expect(() =>
      renderBoard(ctx, [], draft, [], {
        selectedIds: [],
        marquee: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        bindHighlightId: null,
      }),
    ).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("paints frames, images (with files), and free text", () => {
    const frame = newElement("frame", { id: "f", x: 0, y: 0, width: 200, height: 200, name: "A" });
    const image = newElement("image", { id: "img", x: 10, y: 10, width: 40, height: 40 });
    const free = newElement("text", { id: "t", x: 0, y: 220, text: "caption" });
    const { ctx, calls } = stubCtx();
    expect(() => renderBoard(ctx, [frame, image, free], null, ["img"], {
      selectedIds: ["img"],
    })).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });
});
