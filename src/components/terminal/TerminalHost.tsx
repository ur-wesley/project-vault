import { openUrl } from "@tauri-apps/plugin-opener";
import { readText } from "tauri-plugin-clipboard-api";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkProvider, Terminal as XTermTerminal } from "@xterm/xterm";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import "@xterm/xterm/css/xterm.css";

import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  attachTerminalWindowRepaint,
  clearTerminalResize,
  fitAndPushTerminalSize,
  repaintTerminal,
  scheduleTerminalResize,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  type TerminalResizeTimer,
} from "~/lib/terminal-repaint";
import { cn } from "~/lib/utils";
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
import { formatCommandTitle, parseCommandFromLine } from "./parse-command-title";

const WEB_LINK_REGEX = /https?:\/\/[^\s"<>|`{}[\]^]+/g;
const ESC_BLUR_WINDOW_MS = 450;

function registerTauriWebLinks(term: XTermTerminal): { dispose: () => void } {
  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      let text = "";
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        text += cell?.getChars() || "";
      }

      const links: ILink[] = [];
      let match: RegExpExecArray | null;
      WEB_LINK_REGEX.lastIndex = 0;

      while ((match = WEB_LINK_REGEX.exec(text)) !== null) {
        const uri = match[0];
        const startX = match.index;
        const endX = startX + uri.length;

        links.push({
          text: uri,
          range: {
            start: { x: startX + 1, y },
            end: { x: endX, y },
          },
          activate(event, text) {
            if (!event.ctrlKey && !event.metaKey) return;
            void openUrl(text);
          },
        });
      }

      callback(links);
    },
  };

  return term.registerLinkProvider(provider);
}

export type TerminalHostInstance = {
  id: string;
  name: string;
  defaultName?: string;
  shell?: string;
  icon?: string;
  sessionId?: string;
  attachSessionId?: string;
};

export function TerminalHost(props: {
  instance: TerminalHostInstance;
  activeId: Accessor<string | null>;
  isActivePane: boolean;
  spawnFn: (shell?: string, rows?: number, cols?: number) => PromiseLike<Result<string, any>>;
  onSessionId: (id: string, sessionId: string) => void;
  onError: (msg: string | null) => void;
  onProcessExit?: (id: string, hasContent: boolean) => void;
  onCommandEntered?: (id: string, command: string) => void;
  /** When false, the terminal never grabs keyboard focus on mount/activation. Defaults to true. */
  autoFocus?: boolean;
}) {
  const active = createMemo(() => props.isActivePane && props.activeId() === props.instance.id);
  const hub = useEventHub();
  const { t } = useI18n();
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = createSignal(false);

  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: string | null = null;

  const doResize = (): boolean => {
    if (!sessionId) return false;
    const sid: string = sessionId;
    return fitAndPushTerminalSize(term, fit, (rows, cols) => {
      void embeddedTerminalResize(sid, rows, cols);
    });
  };

  createEffect(() => {
    if (!active() || !terminalReady()) return;
    const currentTerm = term;
    if (!currentTerm) return;
    const noAutoFocus = props.autoFocus === false;

    let raf = 0;
    let timer = 0;
    let retryTimer: number | undefined;

    raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (!active() || !currentTerm.element) return;
        if (currentTerm.element.offsetParent !== null) {
          if (!noAutoFocus) currentTerm.focus();
          // The first post-activation resize must never be silently dropped:
          // background tabs kept the 80x24 spawn size, so retry once after
          // layout settles when no valid dims could be pushed yet.
          let pushed = false;
          repaintTerminal(currentTerm, fit, () => {
            pushed = doResize();
          });
          if (!pushed) {
            retryTimer = window.setTimeout(() => {
              if (!active()) return;
              repaintTerminal(currentTerm, fit, doResize);
            }, 150);
          }
        }
      }, 150);
    });

    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    });
  });

  createEffect(() => {
    const unsubFocus = hub.on("terminal:focus", () => {
      if (props.autoFocus === false) return;
      if (!active() || !terminalReady()) return;
      const currentTerm = term;
      if (!currentTerm?.element) return;

      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!active() || !currentTerm.element) return;
          if (currentTerm.element.offsetParent !== null) {
            currentTerm.focus();
            repaintTerminal(currentTerm, fit, doResize);
          }
        }, 150);
      });
    });
    onCleanup(unsubFocus);
  });

  createEffect(() => {
    const node = container();
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

    const instanceId = untrack(() => props.instance.id);
    const instanceShell = untrack(() => props.instance.shell);
    const attachSid = untrack(() => props.instance.attachSessionId);
    const existingSessionId = untrack(() => props.instance.sessionId);
    const spawnFn = untrack(() => props.spawnFn);
    const onSessionId = untrack(() => props.onSessionId);
    const onError = untrack(() => props.onError);

    let cancelled = false;
    let spawnedByThisEffect = false;
    let unData: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let ro: ResizeObserver | null = null;
    const resizeTimer: TerminalResizeTimer = { id: undefined };
    let onWindowResize: (() => void) | null = null;
    let linkProvider: { dispose: () => void } | null = null;
    let cleanupOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let detachWindowRepaint: (() => void) | undefined;
    let lastEscAt = 0;
    const existingSid = attachSid ?? existingSessionId;
    let sid = existingSid;

    void (async () => {
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
      linkProvider = registerTauriWebLinks(term);
      term.open(node);

      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || event.key !== "Escape") return true;
        const now = Date.now();
        if (now - lastEscAt < ESC_BLUR_WINDOW_MS) {
          lastEscAt = 0;
          event.preventDefault();
          term!.blur();
          hub.emit("terminal:blurred");
          return false;
        }
        lastEscAt = now;
        return true;
      });

      cleanupOnKeyDown = (e: KeyboardEvent) => {
        const isPaste = (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
        const isCopy = (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");
        if (!isPaste && !isCopy) return;
        if (!term) return;
        // Scope clipboard shortcuts to the xterm surface so tab-bar focus and
        // global hotkeys keep working. Enter is intentionally untouched here —
        // tab renames go through onData after xterm accepted the key.
        const target = e.target as Node | null;
        const surface = term.element;
        const inSurface =
          !!surface && !!target && (target === term.textarea || surface.contains(target));
        if (!inSurface) return;

        if (isPaste) {
          e.preventDefault();
          e.stopPropagation();
          readText()
            .then((text) => {
              if (!isTerminalInput(text) || !term) return;
              term.paste(text);
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
          void navigator.clipboard.writeText(text);
          return;
        }
      };
      node.addEventListener("keydown", cleanupOnKeyDown, { capture: true });
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
          term.write(decodeTerminalChunk(chunk));
        });
        unExit = subscribeTerminalExit(id, () => {
          exitFired = true;
          if (!isReady || !term) return;
          const hasContent = hasTerminalContent(id);
          if (!hasContent) {
            props.onProcessExit?.(instanceId, false);
            return;
          }
          term.writeln(
            "\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m",
          );
        });
      };

      // Buffer early output even before the fresh sid exists.
      ensureTerminalListeners();
      if (sid) subscribeSession(sid);

      if (!sid) {
        // Measure after open+fit so the backend PTY starts at the real xterm
        // geometry; the backend clamps invalid values back to 80x24.
        const spawn = await spawnFn(instanceShell, term.rows, term.cols);
        if (spawn.isErr()) {
          onError(stableErrorMessage(t, spawn.error));
          term.dispose();
          term = null;
          return;
        }
        sid = spawn.value;
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
          if (!hasContent) {
            props.onProcessExit?.(instanceId, false);
            term.dispose();
            term = null;
            return;
          }
          term.writeln(
            "\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m",
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

      if (existingSid) {
        const bufferResult = await embeddedTerminalGetBuffer(sessionId);
        if (cancelled) return;
        if (bufferResult.isOk()) {
          clearTerminalBuffer(sessionId);
          for (const chunk of bufferResult.value) {
            appendTerminalChunk(sessionId, chunk);
            if (!term) break;
            term.write(decodeTerminalChunk(chunk));
          }
        }
      } else {
        const replay = getTerminalReplay(sessionId);
        for (const chunk of replay) {
          if (!term) break;
          term.write(decodeTerminalChunk(chunk));
        }
      }

      isReady = true;

      if (exitFired && !existingSid) {
        const hasContent = hasTerminalContent(sessionId);
        if (!hasContent) {
          props.onProcessExit?.(instanceId, false);
          return;
        }
        term?.writeln(
          "\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m",
        );
      }

      term.onData((data) => {
        if (!isTerminalInput(data)) return;
        queueTerminalWrite(sessionId, data);
        if (!data.includes("\r")) return;
        // Tab rename off the keydown hot path: xterm has accepted the key by
        // now, so a sync store update can no longer swallow the first Enter
        // in raw-mode prompts. Deferred one macrotask for extra safety.
        window.setTimeout(() => {
          if (!term) return;
          const onCommandEntered = untrack(() => props.onCommandEntered);
          if (!onCommandEntered) return;
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
          const command = parseCommandFromLine(lineText);
          onCommandEntered(instanceId, command ? formatCommandTitle(command) : "");
        }, 0);
      });

      doResize();
      detachWindowRepaint = attachTerminalWindowRepaint(
        () => term,
        () => fit,
        doResize,
      );

      ro = new ResizeObserver(() => {
        scheduleTerminalResize(resizeTimer, doResize, 120);
      });
      ro.observe(node);

      onWindowResize = () => {
        scheduleTerminalResize(resizeTimer, doResize, 30); // Fast response during drag
      };
      window.addEventListener("resize", onWindowResize);
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
      if (cleanupOnKeyDown)
        node.removeEventListener("keydown", cleanupOnKeyDown, { capture: true });
      term?.dispose();
      term = null;
      fit = null;
      sessionId = null;
    });
  });

  return (
    <div
      ref={setContainer}
      class={cn("flex-1 min-h-0 outline-none", active() ? "block" : "hidden")}
    />
  );
}
