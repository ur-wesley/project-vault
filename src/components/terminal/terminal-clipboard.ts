import { readText } from "tauri-plugin-clipboard-api";
import type { Terminal } from "ghostty-web";

import { isTerminalInput } from "./terminal-io";

/**
 * Clipboard shortcuts for the embedded terminal (P2-4 split from
 * `TerminalHost.tsx`, verbatim move — zero behavior change).
 *
 * Single home for Ctrl+C / Ctrl+V (Cmd on macOS) plus Shift+Insert paste.
 * Both the host (`terminal-session.ts`) and the task-stream dialog
 * (`task-stream-dialog.tsx`) consume this module (P2-5.4 copy parity, OQ-4:
 * dialog gets copy, not paste-only). Clipboard failures unify on
 * `console.error` (P2-5.6, OQ-4).
 */
export function createTerminalClipboardHandler(
  getTerm: () => Terminal | null,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const isPaste =
      ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) ||
      (e.shiftKey && e.key === "Insert");
    const isCopy = (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");
    if (!isPaste && !isCopy) return;
    const term = getTerm();
    if (!term) return;
    // Scope clipboard shortcuts to the ghostty-web surface so tab-bar focus
    // and global hotkeys keep working. Enter is intentionally untouched here —
    // tab renames go through onData after ghostty-web accepted the key.
    const target: unknown = e.target;
    const surface = term.element;
    const inSurface =
      !!surface && target instanceof Node && (target === term.textarea || surface.contains(target));
    if (!inSurface) return;

    if (isPaste) {
      e.preventDefault();
      e.stopPropagation();
      readText()
        .then((text) => {
          const live = getTerm();
          if (!isTerminalInput(text) || !live) return;
          live.paste(text);
        })
        .catch((err) => {
          console.error("clipboard read failed:", err);
        });
      return;
    }

    if (isCopy && term.hasSelection()) {
      e.preventDefault();
      e.stopPropagation();
      const text = term.getSelection();
      // P2-5.6 (OQ-4): clipboard errors unify on console.error, never swallowed.
      void navigator.clipboard.writeText(text).catch((err: unknown) => {
        console.error("clipboard write failed:", err);
      });
      return;
    }
  };
}

/**
 * Capture-phase Ctrl+C / Ctrl+V listener scoped to the terminal surface.
 * Returns the detach function for the owner effect's `onCleanup`.
 */
export function attachTerminalClipboard(
  node: HTMLElement,
  getTerm: () => Terminal | null,
): () => void {
  const handler = createTerminalClipboardHandler(getTerm);
  node.addEventListener("keydown", handler, { capture: true });
  return () => {
    node.removeEventListener("keydown", handler, { capture: true });
  };
}
