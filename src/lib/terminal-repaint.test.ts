// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import {
  clearTerminalResize,
  fitAndPushTerminalSize,
  scheduleTerminalResize,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  type TerminalResizeTimer,
} from "~/lib/terminal-repaint";

type MutableTerm = {
  cols: number;
  rows: number;
  element: { getBoundingClientRect: () => { width: number; height: number } };
  refresh: () => void;
};

function mockTerm(opts: { width: number; height: number; cols: number; rows: number }): {
  term: MutableTerm;
  asXterm: Terminal;
} {
  const term: MutableTerm = {
    cols: opts.cols,
    rows: opts.rows,
    element: {
      getBoundingClientRect: () => ({ width: opts.width, height: opts.height }),
    },
    refresh: () => {},
  };
  return { term, asXterm: term as unknown as Terminal };
}

function mockFit(term: MutableTerm, fittedCols: number, fittedRows: number): FitAddon {
  return {
    fit: () => {
      term.cols = fittedCols;
      term.rows = fittedRows;
    },
  } as unknown as FitAddon;
}

describe("fitAndPushTerminalSize", () => {
  it("returns false without pushing when term or fit is missing", () => {
    const push = vi.fn();
    const { asXterm } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    const { term } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    expect(fitAndPushTerminalSize(null, mockFit(term, 100, 30), push)).toBe(false);
    expect(fitAndPushTerminalSize(asXterm, null, push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("returns false without pushing when the container is hidden", () => {
    const push = vi.fn();
    const { term, asXterm } = mockTerm({ width: 0, height: 0, cols: 80, rows: 24 });
    expect(fitAndPushTerminalSize(asXterm, mockFit(term, 100, 30), push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("never pushes below the column/row minimums", () => {
    const push = vi.fn();
    const { term, asXterm } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    expect(
      fitAndPushTerminalSize(asXterm, mockFit(term, TERMINAL_MIN_COLS - 1, 30), push),
    ).toBe(false);
    expect(
      fitAndPushTerminalSize(asXterm, mockFit(term, 100, TERMINAL_MIN_ROWS - 1), push),
    ).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("fits and pushes the real geometry when visible", () => {
    const push = vi.fn();
    const { term, asXterm } = mockTerm({ width: 800, height: 600, cols: 80, rows: 24 });
    expect(fitAndPushTerminalSize(asXterm, mockFit(term, 120, 32), push)).toBe(true);
    expect(push).toHaveBeenCalledWith(32, 120);
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
