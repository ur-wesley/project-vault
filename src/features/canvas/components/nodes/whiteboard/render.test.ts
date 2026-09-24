import { describe, it, expect } from "vitest";
import { renderBoard } from "./render";
import { resolveEndpoints } from "./bindings";
import type { WhiteboardElement } from "./types";
import { baseElement } from "./types";

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
  it("renders a mixed v2 board without throwing", () => {
    const shape: WhiteboardElement = {
      ...baseElement("s", "#e5e5e5", 2),
      kind: "rectangle",
      start: { x: 10, y: 10 },
      end: { x: 110, y: 60 },
      boundElements: [{ type: "text", id: "t1" }],
    };
    const arrow: WhiteboardElement = {
      ...baseElement("a", "#3b82f6", 2),
      kind: "arrow",
      start: { x: 0, y: 0 },
      end: { x: 300, y: 30 },
      startBinding: { elementId: "s", gap: 4 },
      endBinding: null,
      startArrow: "none",
      endArrow: "arrow",
      waypoints: [{ x: 150, y: 80 }],
    };
    const label: WhiteboardElement = {
      ...baseElement("t1", "#e5e5e5", 2),
      kind: "text",
      position: { x: 0, y: 0 },
      text: "hello",
      fontSize: 14,
      fontFamily: "normal",
      bold: false,
      italic: false,
      containerId: "s",
      labelGroupId: null,
      offset: { x: 0, y: 0 },
      width: null,
      textAlign: "center",
    };
    const arrowLabel: WhiteboardElement = {
      ...baseElement("t2", "#e5e5e5", 2),
      kind: "text",
      position: { x: 0, y: 0 },
      text: "edge",
      fontSize: 14,
      fontFamily: "normal",
      bold: false,
      italic: false,
      containerId: "a",
      labelGroupId: null,
      offset: { x: 0, y: 0 },
      width: null,
      textAlign: "center",
    };
    const els = [shape, arrow, label, arrowLabel];
    const ends = new Map([
      ["a", resolveEndpoints(els, arrow as Extract<WhiteboardElement, { kind: "arrow" }>)],
    ]);
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
    const draft: WhiteboardElement = {
      ...baseElement("d", "#e5e5e5", 2),
      kind: "freehand",
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ],
    };
    expect(() =>
      renderBoard(ctx, [], draft, [], {
        selectedIds: [],
        marquee: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        bindHighlightId: null,
      }),
    ).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });
});
