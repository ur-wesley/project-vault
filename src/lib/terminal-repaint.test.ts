// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitAddon, Terminal } from "ghostty-web";

import {
  clearTerminalResize,
  fitAndPushTerminalSize,
  forceTerminalRedraw,
  proposeTerminalDimensions,
  repaintTerminal,
  scheduleTerminalResize,
  type TerminalResizeTimer,
} from "~/lib/terminal-repaint";

type MutableTerm = {
  cols: number;
  rows: number;
  element: HTMLElement;
  resize?: (cols: number, rows: number) => void;
  getViewportY: () => number;
  getScrollbackLength: () => number;
  wasmTerm?: Record<string, unknown>;
  scrollbarOpacity?: number;
  renderer?: {
    getMetrics: () => { width: number; height: number };
    remeasureFont: () => void;
    resize: (cols: number, rows: number) => void;
    render: (
      wasmTerm: unknown,
      forceAll?: boolean,
      viewportY?: number,
      term?: unknown,
      scrollbarOpacity?: number,
    ) => void;
  };
};

function mockTerm(opts: {
  width: number;
  height: number;
  cols: number;
  rows: number;
  charWidth?: number;
  charHeight?: number;
  parentWidth?: number;
  parentHeight?: number;
}): {
  term: MutableTerm;
  asTerminal: Terminal;
} {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: opts.width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: opts.height, configurable: true });
  el.getBoundingClientRect = () =>
    ({
      width: opts.width,
      height: opts.height,
      top: 0,
      left: 0,
      bottom: opts.height,
      right: opts.width,
      x: 0,
      y: 0,
      toJSON: () => {},
    }) as DOMRect;

  if (opts.parentWidth != null || opts.parentHeight != null) {
    const parent = document.createElement("div");
    Object.defineProperty(parent, "clientWidth", {
      value: opts.parentWidth ?? opts.width,
      configurable: true,
    });
    Object.defineProperty(parent, "clientHeight", {
      value: opts.parentHeight ?? opts.height,
      configurable: true,
    });
    parent.appendChild(el);
  }

  const term: MutableTerm = {
    cols: opts.cols,
    rows: opts.rows,
    element: el,
    resize: vi.fn((c: number, r: number) => {
      term.cols = c;
      term.rows = r;
    }),
    getViewportY: () => 0,
    getScrollbackLength: () => 0,
    wasmTerm: {},
    scrollbarOpacity: 0,
    renderer: {
      getMetrics: vi.fn(() => ({
        width: opts.charWidth ?? 8,
        height: opts.charHeight ?? 16,
      })),
      remeasureFont: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
    },
  };
  return { term, asTerminal: term as unknown as Terminal };
}

function mockFit(term: MutableTerm, fittedCols: number, fittedRows: number): FitAddon {
  return {
    fit: () => {
      term.cols = fittedCols;
      term.rows = fittedRows;
    },
  } as unknown as FitAddon;
}

function mockFitWithPropose(fittedCols: number, fittedRows: number): FitAddon {
  return {
    proposeDimensions: () => ({ cols: fittedCols, rows: fittedRows }),
    fit: vi.fn(),
  } as unknown as FitAddon;
}

describe("proposeTerminalDimensions", () => {
  it("computes full columns and rows without phantom scrollbar padding", () => {
    // 800px width with 8px charWidth = exactly 100 columns (no 15px penalty)
    const { asTerminal } = mockTerm({ width: 800, height: 480, cols: 80, rows: 24, charWidth: 8, charHeight: 16 });
    const dims = proposeTerminalDimensions(asTerminal);
    expect(dims).toEqual({ cols: 100, rows: 30 });
  });

  it("measures parentElement when parent is wider than element to prevent one-way ratchet", () => {
    // Element clamped at 500px, but parent expanded to 960px
    const { asTerminal } = mockTerm({
      width: 500,
      height: 400,
      cols: 62,
      rows: 25,
      charWidth: 8,
      charHeight: 16,
      parentWidth: 960,
      parentHeight: 480,
    });
    const dims = proposeTerminalDimensions(asTerminal);
    expect(dims).toEqual({ cols: 120, rows: 30 });
  });

  it("returns undefined for hidden or zero-size container", () => {
    const { asTerminal } = mockTerm({ width: 0, height: 0, cols: 80, rows: 24 });
    const dims = proposeTerminalDimensions(asTerminal);
    expect(dims).toBeUndefined();
  });
});

describe("fitAndPushTerminalSize", () => {
  it("returns false without pushing when term or fit is missing", () => {
    const push = vi.fn();
    const { asTerminal } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    const { term } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    expect(fitAndPushTerminalSize(null, mockFit(term, 100, 30), push)).toBe(false);
    expect(fitAndPushTerminalSize(asTerminal, null, push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("returns false without pushing when the container is hidden", () => {
    const push = vi.fn();
    const { term, asTerminal } = mockTerm({ width: 0, height: 0, cols: 80, rows: 24 });
    expect(fitAndPushTerminalSize(asTerminal, mockFit(term, 100, 30), push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("never pushes below the column/row minimums", () => {
    const push = vi.fn();
    const { asTerminal } = mockTerm({ width: 100, height: 100, cols: 80, rows: 24, charWidth: 8, charHeight: 16 });
    const fit = { fit: vi.fn() } as unknown as FitAddon;
    expect(fitAndPushTerminalSize(asTerminal, fit, push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("fits and pushes the full-width geometry when visible", () => {
    const push = vi.fn();
    const { term, asTerminal } = mockTerm({ width: 800, height: 480, cols: 80, rows: 24, charWidth: 8, charHeight: 16 });
    const fit = mockFit(term, 80, 24);
    expect(fitAndPushTerminalSize(asTerminal, fit, push)).toBe(true);
    expect(term.resize).toHaveBeenCalledWith(100, 30);
    expect(push).toHaveBeenCalledWith(30, 100);
  });
});

describe("forceTerminalRedraw", () => {
  it("triggers remeasureFont, renderer.resize, and full render with scrollbarOpacity=0 by default", () => {
    const { term, asTerminal } = mockTerm({ width: 800, height: 600, cols: 90, rows: 30 });
    forceTerminalRedraw(asTerminal);
    expect(term.renderer?.remeasureFont).toHaveBeenCalled();
    expect(term.renderer?.resize).toHaveBeenCalledWith(90, 30);
    expect(term.renderer?.render).toHaveBeenCalledWith(term.wasmTerm, true, 0, asTerminal, 0);
  });

  it("preserves active scrollbarOpacity when scrolling", () => {
    const { term, asTerminal } = mockTerm({ width: 800, height: 600, cols: 90, rows: 30 });
    term.scrollbarOpacity = 0.8;
    forceTerminalRedraw(asTerminal);
    expect(term.renderer?.render).toHaveBeenCalledWith(term.wasmTerm, true, 0, asTerminal, 0.8);
  });
});

describe("repaintTerminal", () => {
  it("forces redraw and invokes onAfterFit callback", () => {
    const { term, asTerminal } = mockTerm({ width: 800, height: 480, cols: 80, rows: 24, charWidth: 8, charHeight: 16 });
    const fit = mockFitWithPropose(100, 28);
    const onAfter = vi.fn();
    expect(repaintTerminal(asTerminal, fit, onAfter)).toBe(true);
    expect(term.resize).toHaveBeenCalledWith(100, 30);
    expect(term.renderer?.render).toHaveBeenCalledWith(term.wasmTerm, true, 0, asTerminal, 0);
    expect(onAfter).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleTerminalResize / clearTerminalResize", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid triggers into a single push", () => {
    vi.useFakeTimers();
    const timer: TerminalResizeTimer = { id: undefined };
    const push = vi.fn();
    scheduleTerminalResize(timer, push, 120);
    scheduleTerminalResize(timer, push, 120);
    scheduleTerminalResize(timer, push, 120);
    expect(push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending push", () => {
    vi.useFakeTimers();
    const timer: TerminalResizeTimer = { id: undefined };
    const push = vi.fn();
    scheduleTerminalResize(timer, push, 30);
    clearTerminalResize(timer);
    vi.advanceTimersByTime(100);
    expect(push).not.toHaveBeenCalled();
    expect(timer.id).toBeUndefined();
  });
});
