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

function ptr(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointermove" ? 1 : 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    ...extra,
  });
}

describe("WhiteboardNode drawing", () => {
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

  it("draws a rectangle with the mouse and persists it", async () => {
    const seen: (string | null)[] = [];
    const node: CanvasNodeDto = {
      id: "n1",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson: null,
    };
    const { ctx } = stub2d();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => ctx;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
        () => {};
    }
    try {
      dispose = render(
        () =>
          WhiteboardNode({
            node,
            onDataChange: (_id: string, json: string | null) => {
              seen.push(json);
            },
            onFocusNode: () => {},
          } as never) as unknown as Element,
        document.body,
      );

      const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
      expect(canvas).not.toBeNull();
      // Realistic board size (happy-dom reports 0x0 by default).
      canvas.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 560,
          height: 300,
          top: 0,
          left: 0,
          right: 560,
          bottom: 300,
        }) as DOMRect;

      // Select the rectangle tool.
      const rectBtn = document.body.querySelector(
        'button[aria-label="Rectangle"]',
      ) as HTMLButtonElement;
      expect(rectBtn).not.toBeNull();
      rectBtn.click();
      expect(rectBtn.getAttribute("aria-pressed")).toBe("true");

      canvas.dispatchEvent(ptr("pointerdown", 10, 10));
      canvas.dispatchEvent(ptr("pointermove", 100, 80));
      canvas.dispatchEvent(ptr("pointerup", 100, 80));

      // Debounced persist (500ms).
      await new Promise((r) => setTimeout(r, 700));
      expect(seen.length).toBeGreaterThan(0);
      const last = JSON.parse(seen[seen.length - 1] as string);
      expect(last.version).toBe(5);
      expect(last.elements).toHaveLength(1);
      expect(last.elements[0]).toMatchObject({
        kind: "rectangle",
        start: { x: 10, y: 10 },
        end: { x: 100, y: 80 },
      });

      // Tool smart-reverts to select: dragging the shape now moves it.
      canvas.dispatchEvent(ptr("pointerdown", 50, 40));
      canvas.dispatchEvent(ptr("pointermove", 70, 60));
      canvas.dispatchEvent(ptr("pointerup", 70, 60));
      await new Promise((r) => setTimeout(r, 700));
      const moved = JSON.parse(seen[seen.length - 1] as string);
      expect(moved.elements[0]).toMatchObject({
        start: { x: 30, y: 30 },
        end: { x: 120, y: 100 },
      });
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it("bends an arrow by dragging its bend handle", async () => {
    const seen: (string | null)[] = [];
    const node: CanvasNodeDto = {
      id: "n2",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson: null,
    };
    const { ctx } = stub2d();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => ctx;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
        () => {};
    }
    try {
      dispose = render(
        () =>
          WhiteboardNode({
            node,
            onDataChange: (_id: string, json: string | null) => {
              seen.push(json);
            },
            onFocusNode: () => {},
          } as never) as unknown as Element,
        document.body,
      );
      const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
      canvas.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 560,
          height: 300,
          top: 0,
          left: 0,
          right: 560,
          bottom: 300,
        }) as DOMRect;

      const arrowBtn = document.body.querySelector(
        'button[aria-label="Arrow (binds to shapes)"]',
      ) as HTMLButtonElement;
      arrowBtn.click();

      canvas.dispatchEvent(ptr("pointerdown", 10, 10));
      canvas.dispatchEvent(ptr("pointermove", 100, 10));
      canvas.dispatchEvent(ptr("pointerup", 100, 10));
      await new Promise((r) => setTimeout(r, 700));
      expect(seen.length).toBeGreaterThan(0);
      const drawn = JSON.parse(seen[seen.length - 1] as string);
      expect(drawn.elements[0]).toMatchObject({ kind: "arrow", waypoints: [] });

      // Bend handle sits at the segment midpoint (55, 10).
      canvas.dispatchEvent(ptr("pointerdown", 55, 10));
      canvas.dispatchEvent(ptr("pointermove", 55, 50));
      canvas.dispatchEvent(ptr("pointerup", 55, 50));
      await new Promise((r) => setTimeout(r, 700));
      const bent = JSON.parse(seen[seen.length - 1] as string);
      expect(bent.elements[0]).toMatchObject({ waypoints: [{ x: 55, y: 50 }] });
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it("adds and removes arrow bend points with double-click", async () => {
    const seen: (string | null)[] = [];
    const node: CanvasNodeDto = {
      id: "n3",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson: null,
    };
    const { ctx } = stub2d();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => ctx;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
        () => {};
    }
    const dbl = (x: number, y: number) =>
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    try {
      dispose = render(
        () =>
          WhiteboardNode({
            node,
            onDataChange: (_id: string, json: string | null) => {
              seen.push(json);
            },
            onFocusNode: () => {},
          } as never) as unknown as Element,
        document.body,
      );
      const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
      canvas.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 560,
          height: 300,
          top: 0,
          left: 0,
          right: 560,
          bottom: 300,
        }) as DOMRect;

      const arrowBtn = document.body.querySelector(
        'button[aria-label="Arrow (binds to shapes)"]',
      ) as HTMLButtonElement;
      arrowBtn.click();

      canvas.dispatchEvent(ptr("pointerdown", 10, 10));
      canvas.dispatchEvent(ptr("pointermove", 100, 10));
      canvas.dispatchEvent(ptr("pointerup", 100, 10));
      await new Promise((r) => setTimeout(r, 700));

      // Off-midpoint double-click (midpoint opens the label editor instead).
      canvas.dispatchEvent(dbl(80, 10));
      await new Promise((r) => setTimeout(r, 700));
      const bent = JSON.parse(seen[seen.length - 1] as string);
      expect(bent.elements[0].waypoints).toHaveLength(1);
      expect(bent.elements[0].waypoints[0].x).toBeCloseTo(80, 0);

      // Double-clicking the bend point itself removes it again.
      canvas.dispatchEvent(dbl(80, 10));
      await new Promise((r) => setTimeout(r, 700));
      const straight = JSON.parse(seen[seen.length - 1] as string);
      expect(straight.elements[0].waypoints).toHaveLength(0);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it("pans with middle-drag and zooms with the wheel without touching elements", async () => {
    const seen: (string | null)[] = [];
    const node: CanvasNodeDto = {
      id: "n4",
      nodeType: "whiteboard",
      title: "WB",
      x: 0,
      y: 0,
      width: 560,
      height: 420,
      dataJson: null,
    };
    const { ctx } = stub2d();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => ctx;
    if (!HTMLCanvasElement.prototype.setPointerCapture) {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
        () => {};
    }
    try {
      dispose = render(
        () =>
          WhiteboardNode({
            node,
            onDataChange: (_id: string, json: string | null) => {
              seen.push(json);
            },
            onFocusNode: () => {},
          } as never) as unknown as Element,
        document.body,
      );
      const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
      canvas.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 560,
          height: 300,
          top: 0,
          left: 0,
          right: 560,
          bottom: 300,
        }) as DOMRect;
      const wrap = canvas.parentElement as HTMLElement;
      const zoomLabel = () =>
        (document.body.querySelector('button[aria-label="Reset view"]') as HTMLButtonElement)
          .textContent;

      // Middle-drag pans the viewport: no elements, no persist.
      canvas.dispatchEvent(ptr("pointerdown", 100, 100, { button: 1, buttons: 4 }));
      canvas.dispatchEvent(ptr("pointermove", 150, 120, { button: 1, buttons: 4 }));
      canvas.dispatchEvent(ptr("pointerup", 150, 120, { button: 1, buttons: 0 }));
      await new Promise((r) => setTimeout(r, 700));
      expect(seen).toHaveLength(0);
      expect(zoomLabel()).toBe("100%");

      // Drawing after the pan stores world coords (screen minus pan).
      const rectBtn = document.body.querySelector(
        'button[aria-label="Rectangle"]',
      ) as HTMLButtonElement;
      rectBtn.click();
      canvas.dispatchEvent(ptr("pointerdown", 60, 30));
      canvas.dispatchEvent(ptr("pointermove", 160, 110));
      canvas.dispatchEvent(ptr("pointerup", 160, 110));
      await new Promise((r) => setTimeout(r, 700));
      const drawn = JSON.parse(seen[seen.length - 1] as string);
      expect(drawn.elements[0]).toMatchObject({
        kind: "rectangle",
        start: { x: 10, y: 10 },
        end: { x: 110, y: 90 },
      });

      // Wheel over the board zooms to the cursor (canvas behavior).
      wrap.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -120,
          clientX: 280,
          clientY: 150,
        }),
      );
      expect(zoomLabel()).toBe("110%");

      // Zoom-out button restores 100%.
      (document.body.querySelector('button[aria-label="Zoom out"]') as HTMLButtonElement).click();
      expect(zoomLabel()).toBe("100%");
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});
