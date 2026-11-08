/**
 * Kept separate under the minimum-viable-module (~80-line) exception
 * (spec ghostty-web-review-fixes §P2-3 + §8 OQ-2 DECIDED keep separate):
 * distinct WASM-lifecycle responsibility — idempotent initPromise with
 * reset-on-catch so a retry reloads ghostty-vt.wasm — shared by 2 consumers
 * (TerminalHost + TaskStreamTerminal in task-stream-dialog). Stable, no
 * growth planned. Do NOT fold into terminal-repaint.ts (sizing/repaint
 * geometry) or terminal-links.ts, and do NOT pad artificially to 80 lines.
 */
import { init } from "ghostty-web";

let initPromise: Promise<void> | null = null;

/**
 * Idempotent initializer for the Ghostty WebAssembly core module.
 * Loads ghostty-vt.wasm once per application lifetime.
 */
export function ensureGhosttyReady(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((err: unknown) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
