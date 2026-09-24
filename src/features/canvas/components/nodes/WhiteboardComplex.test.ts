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

  it("paints a complex v4 board: bound text, bound arrow, freehand, group + label", async () => {
    const dataJson = JSON.stringify({
      version: 4,
      elements: [
        {
          id: "s1",
          kind: "rectangle",
          color: "#ef4444",
          strokeWidth: 4,
          groupIds: ["g1"],
          boundElements: [{ type: "text", id: "bt1" }],
          start: { x: 10, y: 10 },
          end: { x: 120, y: 70 },
        },
        {
          id: "s2",
          kind: "ellipse",
          color: "#22c55e",
          strokeWidth: 2,
          groupIds: ["g1"],
          boundElements: [],
          start: { x: 150, y: 10 },
          end: { x: 240, y: 70 },
        },
        {
          id: "bt1",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          position: { x: 0, y: 0 },
          text: "bound",
          fontSize: 14,
          containerId: "s1",
          labelGroupId: null,
          offset: { x: 0, y: 0 },
          width: null,
          textAlign: "center",
        },
        {
          id: "gl",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          position: { x: 0, y: 0 },
          text: "group",
          fontSize: 14,
          containerId: null,
          labelGroupId: "g1",
          offset: { x: 0, y: 0 },
          width: null,
          textAlign: "center",
        },
        {
          id: "a1",
          kind: "arrow",
          color: "#3b82f6",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [{ type: "text", id: "al1" }],
          start: { x: 120, y: 40 },
          end: { x: 150, y: 40 },
          startBinding: { elementId: "s1", gap: 4, side: "e", focus: 0 },
          endBinding: { elementId: "s2", gap: 4, side: "w", focus: 0 },
          waypoints: [{ x: 135, y: 10 }],
        },
        {
          id: "al1",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          position: { x: 0, y: 0 },
          text: "edge",
          fontSize: 14,
          containerId: "a1",
          labelGroupId: null,
          offset: { x: 0, y: 0 },
          width: null,
          textAlign: "center",
        },
        {
          id: "f1",
          kind: "freehand",
          color: "#eab308",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          points: [
            { x: 10, y: 100 },
            { x: 60, y: 120 },
            { x: 110, y: 100 },
          ],
        },
        {
          id: "ft1",
          kind: "text",
          color: "#e5e5e5",
          strokeWidth: 2,
          groupIds: [],
          boundElements: [],
          position: { x: 10, y: 150 },
          text: "free text here",
          fontSize: 14,
          containerId: null,
          labelGroupId: null,
          offset: { x: 0, y: 0 },
          width: 120,
          textAlign: "left",
        },
      ],
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
