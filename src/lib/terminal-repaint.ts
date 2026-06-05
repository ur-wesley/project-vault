import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export const TERMINAL_MIN_WIDTH = 200;
export const TERMINAL_MIN_HEIGHT = 100;

export function terminalHasMinSize(term: Terminal): boolean {
  const rect = term.element?.getBoundingClientRect();
  return !!rect && rect.width >= TERMINAL_MIN_WIDTH && rect.height >= TERMINAL_MIN_HEIGHT;
}

export function repaintTerminal(
  term: Terminal | null,
  fit: FitAddon | null,
  onAfterFit?: () => void,
): boolean {
  if (!term || !fit) return false;
  if (!terminalHasMinSize(term)) return false;
  fit.fit();
  term.refresh(0, term.rows - 1);
  onAfterFit?.();
  return true;
}

export function attachTerminalWindowRepaint(
  getTerm: () => Terminal | null,
  getFit: () => FitAddon | null,
  onRepaint?: () => void,
): () => void {
  let raf = 0;
  let timer = 0;

  const scheduleRepaint = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        repaintTerminal(getTerm(), getFit(), onRepaint);
      }, 50);
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
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) scheduleRepaint();
      })
      .then((unlisten) => {
        tauriCleanup = unlisten;
      })
      .catch(() => {});
  }

  return () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    tauriCleanup?.();
  };
}
