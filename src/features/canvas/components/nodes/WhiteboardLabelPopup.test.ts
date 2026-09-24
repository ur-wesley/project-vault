// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "solid-js/web";
import { WhiteboardNode } from "./WhiteboardNode";
import type { CanvasNodeDto } from "~/types/dto";

function stub2d() {
  const ctx = new Proxy(
    { canvas: { width: 300, height: 300 } },
    {
      get(target, prop: string) {
        if (prop === "canvas") {
          return (target as unknown as { canvas: unknown }).canvas;
        }
        if (prop === "measureText") return () => ({ width: 10 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx };
}

const ARROW_ID = "a1";
const LABEL_ID = "t1";

function arrowEl(partial?: Record<string, unknown>) {
  return {
    id: ARROW_ID,
    kind: "arrow",
    color: "#e5e5e5",
    strokeWidth: 2,
    background: "transparent",
    fillColor: "#3b82f6",
    strokeStyle: "solid",
    opacity: 100,
    roundness: "round",
    groupIds: [],
    boundElements: [{ type: "text", id: LABEL_ID }],
    start: { x: 10, y: 10 },
    end: { x: 100, y: 10 },
    startBinding: null,
    endBinding: null,
    startArrow: "none",
    endArrow: "arrow",
    waypoints: [],
    ...partial,
  };
}

function labelEl(partial?: Record<string, unknown>) {
  return {
    id: LABEL_ID,
    kind: "text",
    color: "#ef4444",
    strokeWidth: 2,
    background: "transparent",
    fillColor: "#3b82f6",
    strokeStyle: "solid",
    opacity: 100,
    roundness: "round",
    position: { x: 0, y: 0 },
    text: "line one\nline two is longer",
    fontSize: 20,
    fontFamily: "code",
    bold: true,
    italic: false,
    containerId: ARROW_ID,
    labelGroupId: null,
    offset: { x: 0, y: 0 },
    width: null,
    textAlign: "center",
    ...partial,
  };
}

function boardWith(elements: unknown[]): CanvasNodeDto {
  return {
    id: "n-popup",
    nodeType: "whiteboard",
    title: "WB",
    x: 0,
    y: 0,
    width: 560,
    height: 420,
    dataJson: JSON.stringify({ version: 5, elements }),
  };
}

function board(): CanvasNodeDto {
  return boardWith([arrowEl(), labelEl()]);
}

async function mountBoard(
  node: CanvasNodeDto,
  onDataChange: (id: string, json: string | null) => void,
  setDispose: (d: () => void) => void,
) {
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
  if (!HTMLCanvasElement.prototype.setPointerCapture) {
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture =
      () => {};
  }
  setDispose(
    render(
      () =>
        WhiteboardNode({
          node,
          onDataChange,
          onFocusNode: () => {},
        } as never) as unknown as Element,
      document.body,
    ),
  );
  const canvas = document.body.querySelector("[data-whiteboard-canvas]") as HTMLCanvasElement;
  // Let mount effects flush so the saved board is loaded before interacting.
  await new Promise((r) => setTimeout(r, 50));
  return {
    canvas,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      Element.prototype.getBoundingClientRect = origRect;
    },
  };
}

function dblMid(canvas: HTMLCanvasElement) {
  canvas.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 55, clientY: 10 }),
  );
}

describe("WhiteboardNode arrow-label popup", () => {
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

  it("opens the editor on the arrow midpoint with the label's own style and fitting height", async () => {
    const { canvas, restore } = await mountBoard(
      board(),
      () => {},
      (d) => {
        dispose = d;
      },
    );
    try {
      expect(canvas).not.toBeNull();

      // Double-click the arrow midpoint (straight arrow 10,10 -> 100,10).
      dblMid(canvas);
      await new Promise((r) => setTimeout(r, 50));

      expect(document.body.textContent ?? "").toMatch(/2 elements/);
      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      // Positioned on the arrow midpoint (zoom 1, no pan).
      expect(area?.style.left).toBe("55px");
      expect(area?.style.top).toBe("10px");
      // Uses the label's own style, not the text-tool default (16px).
      expect(area?.style.fontSize).toBe("20px");
      expect(area?.style.fontWeight).toBe("700");
      // Height fits both lines (2 rows at 20px * 1.25 = 50px minimum).
      expect(Number.parseFloat(area?.style.height ?? "0")).toBeGreaterThanOrEqual(50);
    } finally {
      restore();
    }
  });

  it("opens a new label at the arrow center (midpoint), not at the click point", async () => {
    const bare = boardWith([arrowEl({ boundElements: [] })]);
    const { canvas, restore } = await mountBoard(
      bare,
      () => {},
      (d) => {
        dispose = d;
      },
    );
    try {
      dblMid(canvas);
      await new Promise((r) => setTimeout(r, 50));

      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      expect(area?.value).toBe("");
      // Midpoint of the straight 10,10 -> 100,10 arrow.
      expect(area?.style.left).toBe("55px");
      expect(area?.style.top).toBe("10px");
    } finally {
      restore();
    }
  });

  it("heals duplicate arrow labels to a single text, keeping the first", async () => {
    const seen: (string | null)[] = [];
    const dup = boardWith([
      arrowEl({
        boundElements: [
          { type: "text", id: "t1" },
          { type: "text", id: "t2" },
        ],
      }),
      labelEl({ id: "t1", text: "first" }),
      labelEl({ id: "t2", text: "second" }),
    ]);
    const { canvas, restore } = await mountBoard(
      dup,
      (_id, json) => {
        seen.push(json);
      },
      (d) => {
        dispose = d;
      },
    );
    try {
      expect(document.body.textContent ?? "").toMatch(/3 elements/);
      dblMid(canvas);
      await new Promise((r) => setTimeout(r, 50));

      // Survivor (first in document order) opens for editing.
      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      expect(area?.value).toBe("first");

      // Commit and let the debounced persist fire.
      area?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      await new Promise((r) => setTimeout(r, 900));
      expect(seen.length).toBeGreaterThan(0);
      const last = JSON.parse(seen[seen.length - 1] as string) as {
        elements: { id: string; kind: string; containerId?: string | null; text?: string }[];
      };
      expect(
        last.elements
          .filter((el) => el.kind === "text" && el.containerId === ARROW_ID)
          .map((el) => el.id),
      ).toEqual(["t1"]);
      // The extra survives as a free text (content preserved).
      expect(last.elements.find((el) => el.id === "t2")).toMatchObject({
        containerId: null,
        text: "second",
      });
    } finally {
      restore();
    }
  });

  function textClick(canvas: HTMLCanvasElement, x: number, y: number) {
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
    const up = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(up);
  }

  it("text tool on an arrow opens the bound label instead of a free text", async () => {
    const { canvas, restore } = await mountBoard(board(), () => {}, (d) => {
      dispose = d;
    });
    try {
      (document.body.querySelector('button[aria-label="Text"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 50));

      textClick(canvas, 55, 10);
      await new Promise((r) => setTimeout(r, 50));

      // Existing bound label opens (no second text created).
      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      expect(area?.value).toBe("line one\nline two is longer");
      expect(document.body.textContent ?? "").toMatch(/2 elements/);
    } finally {
      restore();
    }
  });

  it("text tool on a bare arrow opens an empty bound label at the center", async () => {
    const bare = boardWith([arrowEl({ boundElements: [] })]);
    const { canvas, restore } = await mountBoard(bare, () => {}, (d) => {
      dispose = d;
    });
    try {
      (document.body.querySelector('button[aria-label="Text"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 50));

      textClick(canvas, 55, 10);
      await new Promise((r) => setTimeout(r, 50));

      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      expect(area?.value).toBe("");
      expect(area?.style.left).toBe("55px");
      expect(area?.style.top).toBe("10px");
    } finally {
      restore();
    }
  });

  function selectClick(canvas: HTMLCanvasElement, x: number, y: number) {
    textClick(canvas, x, y);
  }

  it("clicking the pill selects the arrow (label inseparable), Delete removes both", async () => {
    const seen: (string | null)[] = [];
    const { canvas, restore } = await mountBoard(
      board(),
      (_id, json) => {
        seen.push(json);
      },
      (d) => {
        dispose = d;
      },
    );
    try {
      (document.body.querySelector('button[aria-label="Select / move"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 50));

      // Click the pill (on the arrow line): selects the arrow, not the text.
      selectClick(canvas, 55, 10);
      await new Promise((r) => setTimeout(r, 50));
      expect(document.body.textContent ?? "").toMatch(/1 selected/);

      // Delete removes arrow and label together.
      const wrap = document.body.querySelector("[data-whiteboard-canvas]")
        ?.parentElement as HTMLElement;
      wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      expect(seen.length).toBeGreaterThan(0);
      const last = JSON.parse(seen[seen.length - 1] as string) as { elements: unknown[] };
      expect(last.elements).toEqual([]);
    } finally {
      restore();
    }
  });

  it("empty commit keeps an arrow label instead of deleting it", async () => {
    const { canvas, restore } = await mountBoard(board(), () => {}, (d) => {
      dispose = d;
    });
    try {
      dblMid(canvas);
      await new Promise((r) => setTimeout(r, 50));
      const area = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(area).not.toBeNull();
      area!.value = "";
      area!.dispatchEvent(new Event("input", { bubbles: true }));
      area!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      // Editor closed, label kept (still 2 elements, not 1).
      expect(document.body.querySelector("textarea")).toBeNull();
      expect(document.body.textContent ?? "").toMatch(/2 elements/);
    } finally {
      restore();
    }
  });

  it("dragging the pill moves the arrow with the label glued to center", async () => {
    const seen: (string | null)[] = [];
    const { canvas, restore } = await mountBoard(
      board(),
      (_id, json) => {
        seen.push(json);
      },
      (d) => {
        dispose = d;
      },
    );
    try {
      (document.body.querySelector('button[aria-label="Select / move"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 50));

      const down = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 55,
        clientY: 10,
        pointerId: 1,
      });
      canvas.dispatchEvent(down);
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 75,
          clientY: 30,
          pointerId: 1,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 75,
          clientY: 30,
          pointerId: 1,
        }),
      );
      await new Promise((r) => setTimeout(r, 900));
      expect(seen.length).toBeGreaterThan(0);
      const last = JSON.parse(seen[seen.length - 1] as string) as {
        elements: {
          id: string;
          kind: string;
          start?: { x: number; y: number };
          end?: { x: number; y: number };
          containerId?: string | null;
          offset?: { x: number; y: number };
        }[];
      };
      expect(last.elements.find((el) => el.id === "a1")).toMatchObject({
        start: { x: 30, y: 30 },
        end: { x: 120, y: 30 },
      });
      expect(last.elements.find((el) => el.id === "t1")).toMatchObject({
        containerId: "a1",
        offset: { x: 0, y: 0 },
      });
    } finally {
      restore();
    }
  });
});
