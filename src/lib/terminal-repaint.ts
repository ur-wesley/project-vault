import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FitAddon, Terminal } from "ghostty-web";

import { isRecord } from "~/lib/guards";

export const TERMINAL_MIN_WIDTH = 200;
export const TERMINAL_MIN_HEIGHT = 100;

/** Repaint delay after focus/visibility restore (see attachTerminalWindowRepaint). */
export const TERMINAL_REPAINT_MS = 50;

/** Debounce for ResizeObserver / window-resize size pushes. */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 120;

/** Post-activation settle delay (background tab kept 80x24 until layout settles). */
export const TERMINAL_ACTIVATION_DELAY_MS = 150;

/** Focus-restore settle delay (terminal:focus event, dialog re-activation). */
export const TERMINAL_FOCUS_DELAY_MS = 150;

/** Dialog initial size push after open (lets the dialog layout settle first). */
export const TERMINAL_DIALOG_PUSH_DELAY_MS = 200;

/** Box-model padding for one element, in CSS pixels. */
export type BoxPadding = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const ZERO_PADDING: BoxPadding = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Single home for CSS box-padding reads on the terminal sizing path (P2-2).
 * Returns `{left,right,top,bottom}` in px, `0` per side when unavailable.
 */
export function readBoxPadding(el: Element): BoxPadding {
  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function" ||
    !(el instanceof Element)
  ) {
    return { ...ZERO_PADDING };
  }
  const style = window.getComputedStyle(el);
  const read = (prop: string): number => Number.parseInt(style.getPropertyValue(prop), 10) || 0;
  return {
    left: read("padding-left"),
    right: read("padding-right"),
    top: read("padding-top"),
    bottom: read("padding-bottom"),
  };
}

/** Minimum terminal geometry ever forwarded to the backend PTY. */
export const TERMINAL_MIN_COLS = 20;
export const TERMINAL_MIN_ROWS = 5;

/**
 * Narrow structural read for the one Terminal field ghostty-web 0.4.0 keeps
 * private with no public getter (`private scrollbarOpacity`, no accessor in
 * the shipped types). Everything else in forceTerminalRedraw is public API.
 * Falls back to 0 (fully transparent) so a forced frame never flashes the
 * scrollbar at full opacity mid-fade.
 */
function readScrollbarOpacity(term: Terminal): number {
  const raw: unknown = term;
  if (!isRecord(raw)) return 0;
  const value = raw["scrollbarOpacity"];
  return typeof value === "number" ? value : 0;
}

export function terminalHasMinSize(term: Terminal): boolean {
  const rect = term.element?.getBoundingClientRect();
  return !!rect && rect.width >= TERMINAL_MIN_WIDTH && rect.height >= TERMINAL_MIN_HEIGHT;
}

export type TerminalSizePush = (rows: number, cols: number) => void;

/**
 * Force a full canvas redraw across all rows and remeasure font/canvas geometry.
 * Ghostty-web uses two-pass canvas rendering with dirty tracking; this forces
 * all rows to clear their cell background and paint text cleanly.
 *
 * P1-2 (ghostty-web 0.4.0, exact pin): Terminal has no `refresh()` method, so
 * the old `refresh?.()` call was a dead no-op and is deleted (not papered
 * over). `renderer`/`wasmTerm` are public fields in the 0.4.0 typings and
 * `remeasureFont`/`resize`/`render` are public CanvasRenderer methods, so this
 * stays cast-free; `wasmTerm` (GhosttyTerminal) satisfies `IRenderable` and
 * `term` satisfies `IScrollbackProvider` structurally. Only `scrollbarOpacity`
 * needs the narrow documented read above (no public getter in 0.4.0).
 */
export function forceTerminalRedraw(term: Terminal): void {
  const renderer = term.renderer;
  const wasmTerm = term.wasmTerm;
  if (!renderer || !wasmTerm) return;

  renderer.remeasureFont();
  renderer.resize(term.cols, term.rows);
  renderer.render(wasmTerm, true, term.getViewportY(), term, readScrollbarOpacity(term));
}

/**
 * Propose columns and rows directly from the container and font metrics.
 * Ghostty-web's FitAddon subtracts 15px for an xterm-style DOM scrollbar that
 * doesn't exist in ghostty-web (which renders on canvas), leaving an empty margin
 * on the right. In addition, ghostty-web sets fixed pixel widths on its canvas
 * child, which can clamp the terminal container's clientWidth when widening the
 * window; we inspect parentElement when it is wider or taller to prevent a
 * one-way shrinking ratchet.
 */
export function proposeTerminalDimensions(
  term: Terminal,
): { cols: number; rows: number } | undefined {
  if (!term.element) return undefined;
  // P1-2: getMetrics() is a public CanvasRenderer method in ghostty-web 0.4.0
  // (documented for coordinate conversion), so no cast is needed here.
  const metrics = term.renderer?.getMetrics();
  if (!metrics || metrics.width === 0 || metrics.height === 0) return undefined;

  const el = term.element;
  const parent = el.parentElement;
  const target =
    parent && (parent.clientWidth > el.clientWidth || parent.clientHeight > el.clientHeight)
      ? parent
      : el;
  const clientWidth = target.clientWidth;
  const clientHeight = target.clientHeight;
  if (!clientWidth || !clientHeight) return undefined;

  // OQ-3 single-box fix: only the target box's padding counts. When
  // target === parent (window widened, container clamped by canvas width),
  // the target IS the measured box — adding el padding on top double-counts
  // the same box. When target === el, this is just el's own padding.
  const padding = target instanceof Element ? readBoxPadding(target) : { ...ZERO_PADDING };

  const availableWidth = clientWidth - padding.left - padding.right;
  const availableHeight = clientHeight - padding.top - padding.bottom;
  if (availableWidth <= 0 || availableHeight <= 0) return undefined;

  const cols = Math.max(TERMINAL_MIN_COLS, Math.floor(availableWidth / metrics.width));
  const rows = Math.max(TERMINAL_MIN_ROWS, Math.floor(availableHeight / metrics.height));
  return { cols, rows };
}

/**
 * P2-5.2 (OQ-3) DECIDED: custom `proposeTerminalDimensions` is canonical —
 * `FitAddon` subtracts a 15px phantom DOM scrollbar (plus fixed canvas child
 * widths) that does not exist in ghostty-web's canvas rendering, leaving an
 * empty right margin and a one-way shrinking ratchet. `proposeDimensions` /
 * `fit()` stay strictly as fallback when font metrics are unavailable.
 */
function applyFitDimensions(term: Terminal, fit: FitAddon): boolean {
  const customDims = proposeTerminalDimensions(term);
  const dims = customDims ?? (typeof fit.proposeDimensions === "function" ? fit.proposeDimensions() : undefined);
  if (dims) {
    if (dims.cols < TERMINAL_MIN_COLS || dims.rows < TERMINAL_MIN_ROWS) return false;
    if (dims.cols !== term.cols || dims.rows !== term.rows) {
      if (typeof term.resize === "function") {
        term.resize(dims.cols, dims.rows);
      } else {
        term.cols = dims.cols;
        term.rows = dims.rows;
      }
    }
    return true;
  }
  fit.fit();
  return term.cols >= TERMINAL_MIN_COLS && term.rows >= TERMINAL_MIN_ROWS;
}

/**
 * Fit terminal to its container and forward the real geometry. Returns false
 * when no valid size could be measured (hidden/zero container) — the caller
 * must retry once visible instead of pushing stale or zero dims. Never
 * pushes below TERMINAL_MIN_COLS/ROWS.
 */
export function fitAndPushTerminalSize(
  term: Terminal | null,
  fit: FitAddon | null,
  push: TerminalSizePush,
): boolean {
  if (!term || !fit) return false;
  if (!terminalHasMinSize(term)) return false;
  if (!applyFitDimensions(term, fit)) return false;
  forceTerminalRedraw(term);
  push(term.rows, term.cols);
  return true;
}

export type TerminalResizeTimer = { id: ReturnType<typeof setTimeout> | undefined };

/** Single debounce helper for the terminal resize paths (ResizeObserver, window resize, activation retry). */
export function scheduleTerminalResize(
  timer: TerminalResizeTimer,
  push: () => void,
  delayMs: number,
): void {
  clearTimeout(timer.id);
  timer.id = setTimeout(push, delayMs);
}

export function clearTerminalResize(timer: TerminalResizeTimer): void {
  clearTimeout(timer.id);
  timer.id = undefined;
}

export function repaintTerminal(
  term: Terminal | null,
  fit: FitAddon | null,
  onAfterFit?: () => void,
): boolean {
  if (!term || !fit) return false;
  if (!terminalHasMinSize(term)) return false;
  applyFitDimensions(term, fit);
  forceTerminalRedraw(term);
  onAfterFit?.();
  return true;
}

export function attachTerminalWindowRepaint(
  getTerm: () => Terminal | null,
  getFit: () => FitAddon | null,
  onRepaint?: () => void,
): () => void {
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRepaint = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        repaintTerminal(getTerm(), getFit(), onRepaint);
      }, TERMINAL_REPAINT_MS);
    });
  };

  const onFocus = () => scheduleRepaint();
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") scheduleRepaint();
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);

  let tauriCleanup: (() => void) | undefined;
  if (isTauri()) {
    const win = getCurrentWindow();
    const cleanups: (() => void)[] = [];

    win
      .onFocusChanged(({ payload: focused }) => {
        if (focused) scheduleRepaint();
      })
      .then((unlisten) => cleanups.push(unlisten))
      .catch(() => {});

    win
      .onScaleChanged(() => {
        scheduleRepaint();
      })
      .then((unlisten) => cleanups.push(unlisten))
      .catch(() => {});

    tauriCleanup = () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    tauriCleanup?.();
  };
}
