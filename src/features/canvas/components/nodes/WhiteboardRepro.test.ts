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

describe("WhiteboardNode saved-board regression", () => {
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

  it("paints a persisted v2 board on mount", async () => {
    const dataJson = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "project-vault",
      elements: [
        {
          id: "s",
          type: "rectangle",
          x: 10,
          y: 10,
          width: 100,
          height: 50,
          strokeColor: "#ef4444",
          strokeWidth: 4,
        },
        {
          id: "a",
          type: "arrow",
          x: 0,
          y: 0,
          width: 200,
          height: 20,
          points: [
            [0, 0],
            [200, 20],
          ],
          endArrowhead: "arrow",
        },
        {
          id: "t",
          type: "text",
          x: 5,
          y: 80,
          text: "hello",
          fontSize: 14,
          fontFamily: 2,
          textAlign: "left",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    });
    const node: CanvasNodeDto = {
      id: "n-repro",
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
      const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
      expect(canvas).not.toBeNull();

      // Switch to select so later gestures can't create elements.
      (
        document.body.querySelector('button[aria-label="Select / move"]') as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 100));

      const body = document.body.textContent ?? "";
      expect(body).toMatch(/3 elements/);
      // The saved rectangle + text must actually paint.
      expect(calls).toContain("stroke");
      expect(calls).toContain("fillText");
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      Element.prototype.getBoundingClientRect = origRect;
    }
  });

  it("wipes legacy custom boards on mount (dev-mode, no migration)", async () => {
    const dataJson = JSON.stringify({
      version: 4,
      elements: [{ id: "s", kind: "rectangle", start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }],
    });
    const node: CanvasNodeDto = {
      id: "n-repro-wipe",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson,
    };
    const { ctx } = stub2d();
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
      (
        document.body.querySelector('button[aria-label="Select / move"]') as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 100));

      expect(document.body.textContent ?? "").toMatch(/0 elements/);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      Element.prototype.getBoundingClientRect = origRect;
    }
  });
});
