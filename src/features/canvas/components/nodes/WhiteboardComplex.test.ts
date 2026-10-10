// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "solid-js/web";
import { WhiteboardNode } from "./WhiteboardNode";
import type { CanvasNodeDto } from "~/types/dto";

function stub2d() {
  const calls: string[] = [];
  const ctx = new Proxy(
    { canvas: { width: 300, height: 300 } },
    {
      get(target, prop: string) {
        if (prop === "canvas") {
          return (target as unknown as { canvas: unknown }).canvas;
        }
        if (prop === "measureText") return () => ({ width: 10 });
        calls.push(String(prop));
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("WhiteboardNode complex-board regression", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
      (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  it("paints a complex v2 board: bound text, bound arrow, freedraw, group + frame", async () => {
    const dataJson = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "project-vault",
      elements: [
        {
          id: "s1",
          type: "rectangle",
          x: 10,
          y: 10,
          width: 110,
          height: 60,
          strokeColor: "#ef4444",
          strokeWidth: 4,
          groupIds: ["g1"],
          frameId: "fr1",
          boundElements: [{ type: "text", id: "bt1" }],
        },
        {
          id: "s2",
          type: "ellipse",
          x: 150,
          y: 10,
          width: 90,
          height: 60,
          strokeColor: "#22c55e",
          groupIds: ["g1"],
          frameId: "fr1",
        },
        {
          id: "bt1",
          type: "text",
          x: 40,
          y: 30,
          text: "bound",
          fontSize: 14,
          fontFamily: 2,
          textAlign: "center",
          containerId: "s1",
        },
        {
          id: "fr1",
          type: "frame",
          x: 0,
          y: 0,
          width: 260,
          height: 90,
          name: "Group",
        },
        {
          id: "a1",
          type: "arrow",
          x: 120,
          y: 10,
          width: 30,
          height: 30,
          points: [
            [0, 30],
            [15, 0],
            [30, 30],
          ],
          strokeColor: "#3b82f6",
          boundElements: [{ type: "text", id: "al1" }],
          startBinding: { elementId: "s1", gap: 4, focus: 0, side: "e" },
          endBinding: { elementId: "s2", gap: 4, focus: 0, side: "w" },
          endArrowhead: "arrow",
        },
        {
          id: "al1",
          type: "text",
          x: 130,
          y: 16,
          text: "edge",
          fontSize: 14,
          textAlign: "center",
          containerId: "a1",
        },
        {
          id: "f1",
          type: "freedraw",
          x: 10,
          y: 100,
          width: 100,
          height: 20,
          strokeColor: "#eab308",
          points: [
            [0, 0],
            [50, 20],
            [100, 0],
          ],
        },
        {
          id: "ft1",
          type: "text",
          x: 10,
          y: 150,
          width: 120,
          text: "free text here",
          fontSize: 14,
          autoResize: false,
          textAlign: "left",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    });
    const node: CanvasNodeDto = {
      id: "n-complex",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson,
    };
    const { ctx, calls } = stub2d();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => ctx;
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = (() =>
      ({
        x: 0,
        y: 0,
        width: 560,
        height: 300,
        top: 0,
        left: 0,
        right: 560,
        bottom: 300,
      }) as DOMRect) as typeof origRect;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
        () => {};
    }
    try {
      dispose = render(
        () =>
          WhiteboardNode({
            node,
            onDataChange: () => {},
            onFocusNode: () => {},
          } as never) as unknown as Element,
        document.body,
      );
      expect(document.body.querySelector("[data-whiteboard-canvas]")).not.toBeNull();
      (
        document.body.querySelector('button[aria-label="Select / move"]') as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 100));

      expect(document.body.textContent ?? "").toMatch(/8 elements/);
      expect(calls).toContain("stroke");
      expect(calls).toContain("fillText");
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      Element.prototype.getBoundingClientRect = origRect;
    }
  });
});
