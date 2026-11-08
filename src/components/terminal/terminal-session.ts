import { FitAddon, Terminal } from "ghostty-web";
import { createEffect, onCleanup, untrack } from "solid-js";

import { ensureGhosttyReady } from "~/lib/ghostty-init";
import { asString } from "~/lib/guards";
import { mapInvokeError } from "~/services/tauri/utils";

import { stableErrorMessage } from "~/lib/invoke-error";
import { useI18n } from "~/lib/i18n-context";
import {
  attachTerminalWindowRepaint,
  clearTerminalResize,
  fitAndPushTerminalSize,
  scheduleTerminalResize,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  type TerminalResizeTimer,
} from "~/lib/terminal-repaint";
import {
  appendTerminalChunk,
  getTerminalReplay,
  clearTerminalBuffer,
  hasTerminalContent,
} from "~/features/project-detail/lib/terminal-buffer";
import {
  embeddedTerminalKill,
  embeddedTerminalResize,
  embeddedTerminalIsAlive,
  embeddedTerminalGetBuffer,
} from "~/services/tauri/terminal";
import {
  decodeTerminalChunk,
  ensureTerminalListeners,
  isTerminalInput,
  queueTerminalWrite,
  subscribeTerminalData,
  subscribeTerminalExit,
} from "./terminal-io";
import type { Result } from "neverthrow";
import type { StableError } from "~/types/error";
import { resolveEnteredCommandTitle } from "./parse-command-title";
import { attachTauriLinkHandler } from "./terminal-links";
import { attachTerminalClipboard } from "./terminal-clipboard";

const ESC_BLUR_WINDOW_MS = 450;

export type TerminalSpawnFn = (
  shell?: string,
  rows?: number,
  cols?: number,
) => PromiseLike<Result<string, StableError>>;

export type TerminalSessionOptions = {
  container: () => HTMLDivElement | null;
  instanceId: () => string;
  instanceShell: () => string | undefined;
  attachSessionId: () => string | undefined;
  existingSessionId: () => string | undefined;
  spawnFn: () => TerminalSpawnFn;
  onSessionId: () => (id: string, sessionId: string) => void;
  onError: () => (msg: string | null) => void;
  onProcessExit: () => ((id: string, hasContent: boolean) => void) | undefined;
  onCommandEntered: () => ((id: string, command: string) => void) | undefined;
  emitBlurred: () => void;
  setTerminalReady: (ready: boolean) => void;
};

export type TerminalSessionHandle = {
  getTerm: () => Terminal | null;
  getFit: () => FitAddon | null;
  doResize: () => boolean;
};

/**
 * Spawn/session/replay lifecycle for one terminal pane (P2-4 split from
 * `TerminalHost.tsx`, verbatim move — zero behavior change).
 *
 * Owns the terminal instance, its PTY session id, the spawn-or-attach flow,
 * replay, input wiring, clipboard/ESC shortcuts, link handling and resize
 * plumbing. The component keeps render plus the activation/focus effects,
 * which reach in through the returned handle.
 */
export function useTerminalSession(opts: TerminalSessionOptions): TerminalSessionHandle {
  const { t } = useI18n();
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: string | null = null;
  let lastRows = 0;
  let lastCols = 0;

  const doResize = (): boolean => {
    if (!sessionId) return false;
    const sid: string = sessionId;
    return fitAndPushTerminalSize(term, fit, (rows, cols) => {
      if (rows === lastRows && cols === lastCols) return;
      lastRows = rows;
      lastCols = cols;
      void embeddedTerminalResize(sid, rows, cols);
    });
  };

  createEffect(() => {
    const node = opts.container();
    if (!node) return;

    const stopFocus = (e: FocusEvent) => {
      e.stopPropagation();
    };
    node.addEventListener("focusin", stopFocus, { capture: true });
    node.addEventListener("focusout", stopFocus, { capture: true });

    onCleanup(() => {
      node.removeEventListener("focusin", stopFocus, { capture: true });
      node.removeEventListener("focusout", stopFocus, { capture: true });
    });

    const emitBlurred = opts.emitBlurred;
    const setTerminalReady = opts.setTerminalReady;
    const instanceId = untrack(() => opts.instanceId());
    const instanceShell = untrack(() => opts.instanceShell());
    const attachSid = untrack(() => opts.attachSessionId());
    const existingSessionId = untrack(() => opts.existingSessionId());
    const spawnFn = untrack(() => opts.spawnFn());
    const onSessionId = untrack(() => opts.onSessionId());
    const onError = untrack(() => opts.onError());

    let cancelled = false;
    let spawnedByThisEffect = false;
    let unData: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let ro: ResizeObserver | null = null;
    const resizeTimer: TerminalResizeTimer = { id: undefined };
    let onWindowResize: (() => void) | null = null;
    let linkProvider: { dispose: () => void } | null = null;
    let detachClipboard: (() => void) | undefined;
    let detachWindowRepaint: (() => void) | undefined;
    let lastEscAt = 0;
    const existingSid = attachSid ?? existingSessionId;
    let sid = existingSid;

    void (async () => {
      try {
        // ensureGhosttyReady() resets initPromise on failure, so a retry reloads WASM.
        await ensureGhosttyReady();
        if (cancelled) return;

        term = new Terminal({
          cursorBlink: true,
          fontFamily: "ui-monospace, Consolas, monospace",
          fontSize: 13,
          theme: {
            background: "#111111",
            foreground: "#D4D4D4",
            cursor: "#FF5F5F",
          },
        });
        fit = new FitAddon();
        term.loadAddon(fit);
        term.open(node);
        // Hidden helper-textarea styling is single-sourced in src/App.css
        // ([data-shortcut-scope="terminal"] textarea) — no TS inline styles.
        linkProvider = attachTauriLinkHandler(term, node);

        term.attachCustomKeyEventHandler((event) => {
          // ghostty-web attachCustomKeyEventHandler expects:
          // true = prevent default handling (handled by custom code)
          // false = proceed with default terminal handling
          if (event.type !== "keydown" || event.key !== "Escape") return false;
          const now = Date.now();
          if (now - lastEscAt < ESC_BLUR_WINDOW_MS) {
            lastEscAt = 0;
            event.preventDefault();
            term!.blur();
            emitBlurred();
            return true;
          }
          lastEscAt = now;
          return false;
        });

        detachClipboard = attachTerminalClipboard(node, () => term);
        // P2-5.7 DECIDED: spawn at the post-open geometry (80x24 until a real
        // fit lands) is acceptable — hidden/background tabs measure 0, so
        // forcing proposeTerminalDimensions pre-spawn would push stale dims.
        // The backend clamps invalid values to 80x24, doResize() below pushes
        // the real size once visible, and the activation effect retries after
        // layout settles (TerminalHost.tsx).
        const openRect = node.getBoundingClientRect();
        if (openRect.width >= TERMINAL_MIN_WIDTH && openRect.height >= TERMINAL_MIN_HEIGHT) {
          fit.fit();
        }

        let isReady = false;
        let exitFired = false;

        // Display-only subscriptions: the shared bus appends each chunk to the
        // replay buffer exactly once no matter how many tabs are mounted.
        const subscribeSession = (id: string) => {
          unData?.();
          unExit?.();
          unData = subscribeTerminalData(id, (chunk) => {
            if (!isReady || !term) return;
            const decoded = decodeTerminalChunk(chunk);
            if (decoded.length === 0) return;
            term.write(decoded);
          });
          unExit = subscribeTerminalExit(id, () => {
            exitFired = true;
            if (!isReady || !term) return;
            const hasContent = hasTerminalContent(id);
            const onProcessExit = opts.onProcessExit();
            if (!hasContent) {
              onProcessExit?.(instanceId, false);
              return;
            }
            term.writeln(
              "\r\n\x1b[90m" + asString(t("projectDetail.terminalProcessExited")) + "\x1b[0m",
            );
          });
        };

        // Buffer early output even before the fresh sid exists.
        ensureTerminalListeners();
        if (sid) subscribeSession(sid);

        if (!sid) {
          // Measure after open+fit so the backend PTY starts at the real
          // ghostty-web geometry; the backend clamps invalid values back to 80x24.
          const spawn = await spawnFn(instanceShell, term.rows, term.cols);
          if (spawn.isErr()) {
            onError(stableErrorMessage(t, spawn.error));
            term.dispose();
            term = null;
            return;
          }
          sid = spawn.value;
          lastRows = term.rows;
          lastCols = term.cols;
          spawnedByThisEffect = true;
          subscribeSession(sid);
        } else {
          const aliveResult = await embeddedTerminalIsAlive(sid);
          if (cancelled) {
            term.dispose();
            return;
          }
          const alive = aliveResult.isOk() ? aliveResult.value : false;
          if (!alive) {
            sessionId = sid;
            const hasContent = hasTerminalContent(sid);
            const onProcessExit = opts.onProcessExit();
            if (!hasContent) {
              onProcessExit?.(instanceId, false);
              term.dispose();
              term = null;
              return;
            }
            term.writeln(
              "\r\n\x1b[90m" + asString(t("projectDetail.terminalProcessExited")) + "\x1b[0m",
            );
            setTerminalReady(true);
            detachWindowRepaint = attachTerminalWindowRepaint(
              () => term,
              () => fit,
              doResize,
            );
            return;
          }
        }

        if (cancelled) {
          if (spawnedByThisEffect && sid) {
            void embeddedTerminalKill(sid);
          }
          term.dispose();
          return;
        }
        sessionId = sid!;
        if (!existingSid) {
          onSessionId(instanceId, sessionId);
        }
        setTerminalReady(true);

        let replaying = false;
        if (existingSid) {
          const bufferResult = await embeddedTerminalGetBuffer(sessionId);
          if (cancelled) return;
          if (bufferResult.isOk() && bufferResult.value.length > 0) {
            replaying = true;
            clearTerminalBuffer(sessionId);
            for (const chunk of bufferResult.value) {
              appendTerminalChunk(sessionId, chunk);
              if (!term) break;
              const decoded = decodeTerminalChunk(chunk);
              if (decoded.length === 0) continue;
              term.write(decoded);
            }
            // Empty write = ghostty-web flush callback: fires after queued writes drain.
            term?.write("", () => {
              replaying = false;
            });
          }
        } else {
          const replay = getTerminalReplay(sessionId);
          if (replay.length > 0) {
            replaying = true;
            for (const chunk of replay) {
              if (!term) break;
              const decoded = decodeTerminalChunk(chunk);
              if (decoded.length === 0) continue;
              term.write(decoded);
            }
            // Empty write = ghostty-web flush callback: fires after queued writes drain.
            term?.write("", () => {
              replaying = false;
            });
          }
        }

        isReady = true;

        if (exitFired && !existingSid) {
          const hasContent = hasTerminalContent(sessionId);
          const onProcessExit = opts.onProcessExit();
          if (!hasContent) {
            onProcessExit?.(instanceId, false);
            return;
          }
          term?.writeln(
            "\r\n\x1b[90m" + asString(t("projectDetail.terminalProcessExited")) + "\x1b[0m",
          );
        }

        term.onData((data) => {
          if (replaying || !isTerminalInput(data)) return;
          queueTerminalWrite(sessionId, data);
          if (!data.includes("\r") || !term) return;
          const buffer = term.buffer.active;
          const currentLine = buffer.getLine(buffer.cursorY);
          let lineText = "";
          if (currentLine) {
            const endX = buffer.cursorX;
            for (let x = 0; x < endX; x++) {
              const cell = currentLine.getCell(x);
              lineText += cell?.getChars() ?? "";
            }
          }
          const nextTitle = resolveEnteredCommandTitle(lineText);
          if (nextTitle === null) return;
          window.setTimeout(() => {
            const onCommandEntered = untrack(() => opts.onCommandEntered());
            onCommandEntered?.(instanceId, nextTitle);
          }, 0);
        });

        doResize();
        detachWindowRepaint = attachTerminalWindowRepaint(
          () => term,
          () => fit,
          doResize,
        );

        ro = new ResizeObserver(() => {
          scheduleTerminalResize(resizeTimer, doResize, TERMINAL_RESIZE_DEBOUNCE_MS);
        });
        ro.observe(node);
        if (node.parentElement) {
          ro.observe(node.parentElement);
        }

        onWindowResize = () => {
          scheduleTerminalResize(resizeTimer, doResize, TERMINAL_RESIZE_DEBOUNCE_MS);
        };
        window.addEventListener("resize", onWindowResize);
      } catch (err: unknown) {
        console.error("[TerminalHost] ghostty init failed:", err);
        if (cancelled) return;
        onError(stableErrorMessage(t, mapInvokeError(err)));
        term?.dispose();
        term = null;
        fit = null;
      }
    })();

    onCleanup(() => {
      cancelled = true;
      detachWindowRepaint?.();
      clearTerminalResize(resizeTimer);
      ro?.disconnect();
      if (onWindowResize) window.removeEventListener("resize", onWindowResize);
      unData?.();
      unExit?.();
      linkProvider?.dispose();
      detachClipboard?.();
      term?.dispose();
      term = null;
      fit = null;
      sessionId = null;
    });
  });

  return {
    getTerm: () => term,
    getFit: () => fit,
    doResize,
  };
}
