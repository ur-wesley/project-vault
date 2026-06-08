import { listen } from "@tauri-apps/api/event";
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

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  attachTerminalWindowRepaint,
  repaintTerminal,
  terminalHasMinSize,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
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
  embeddedTerminalWrite,
  embeddedTerminalIsAlive,
  embeddedTerminalGetBuffer,
} from "~/services/tauri/terminal";
import type { Result } from "neverthrow";

const WEB_LINK_REGEX = /https?:\/\/[^\s"<>|`{}[\]^]+/g;

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

function decodeChunk(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export type TerminalHostInstance = {
  id: string;
  name: string;
  shell?: string;
  icon?: string;
  sessionId?: string;
  attachSessionId?: string;
};

export function TerminalHost(props: {
  instance: TerminalHostInstance;
  activeId: Accessor<string | null>;
  isActivePane: boolean;
  spawnFn: (shell?: string) => PromiseLike<Result<string, any>>;
  onSessionId: (id: string, sessionId: string) => void;
  onError: (msg: string | null) => void;
  onProcessExit?: (id: string, hasContent: boolean) => void;
}) {
  const active = createMemo(() => props.isActivePane && props.activeId() === props.instance.id);
  const { t } = useI18n();
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = createSignal(false);

  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let sessionId: string | null = null;

  const MIN_COLS = 20;
  const MIN_ROWS = 5;

  const doResize = () => {
    if (!sessionId || !term || !fit) return;
    if (!terminalHasMinSize(term)) return;
    fit.fit();
    if (term.cols >= MIN_COLS && term.rows >= MIN_ROWS) {
      void embeddedTerminalResize(sessionId, term.rows, term.cols);
    }
  };

  createEffect(() => {
    if (!active() || !terminalReady()) return;
    const currentTerm = term;
    if (!currentTerm) return;

    let raf = 0;
    let timer = 0;

    raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (!active() || !currentTerm.element) return;
        if (currentTerm.element.offsetParent !== null) {
          currentTerm.focus();
          repaintTerminal(currentTerm, fit, doResize);
        }
      }, 150);
    });

    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    });
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
    let resizeT: number | undefined;
    let onWindowResize: (() => void) | null = null;
    let linkProvider: { dispose: () => void } | null = null;
    let cleanupOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let detachWindowRepaint: (() => void) | undefined;
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

      cleanupOnKeyDown = (e: KeyboardEvent) => {
        const isPaste = (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
        const isCopy = (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");

        if (isPaste && term) {
          e.preventDefault();
          e.stopPropagation();
          readText()
            .then((text) => {
              if (term) term.paste(text);
            })
            .catch((err) => {
              console.error("clipboard read failed:", err);
            });
          return;
        }

        if (isCopy && term && term.hasSelection()) {
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
      if (!sid) {
        const spawn = await spawnFn(instanceShell);
        if (spawn.isErr()) {
          onError(stableErrorMessage(t, spawn.error));
          term.dispose();
          term = null;
          return;
        }
        sid = spawn.value;
        spawnedByThisEffect = true;
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
          term.writeln("\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m");
          setTerminalReady(true);
          detachWindowRepaint = attachTerminalWindowRepaint(() => term, () => fit, doResize);
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
          for (const chunk of bufferResult.value) {
            if (!term) break;
            term.write(decodeChunk(chunk));
          }
        }
      }
      const replay = getTerminalReplay(sessionId);
      for (const chunk of replay) {
        if (!term) break;
        term.write(decodeChunk(chunk));
      }

      term.onData((data) => {
        if (!sessionId) return;
        const result = embeddedTerminalWrite(sessionId, data);
        result.mapErr((err) => {
          console.error("terminal write error:", err);
        });
      });

      unData = await listen<{ sessionId: string; chunk: string }>(
        "embedded-terminal-data",
        (ev) => {
          if (ev.payload.sessionId !== sessionId) return;
          appendTerminalChunk(ev.payload.sessionId, ev.payload.chunk);
          if (!term) return;
          const data = decodeChunk(ev.payload.chunk);
          term.write(data);
        },
      );

      unExit = await listen<{ sessionId: string }>("embedded-terminal-exit", (ev) => {
        if (ev.payload.sessionId !== sessionId || !term) return;
        const hasContent = hasTerminalContent(ev.payload.sessionId);
        if (!hasContent) {
          props.onProcessExit?.(instanceId, false);
          return;
        }
        term.writeln("\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m");
      });

      doResize();
      detachWindowRepaint = attachTerminalWindowRepaint(() => term, () => fit, doResize);

      ro = new ResizeObserver(() => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(() => doResize(), 120);
      });
      ro.observe(node);

      onWindowResize = () => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(() => doResize(), 30); // Fast response during drag
      };
      window.addEventListener("resize", onWindowResize);
    })();

    onCleanup(() => {
      cancelled = true;
      detachWindowRepaint?.();
      window.clearTimeout(resizeT);
      ro?.disconnect();
      if (onWindowResize) window.removeEventListener("resize", onWindowResize);
      unData?.();
      unExit?.();
      linkProvider?.dispose();
      if (cleanupOnKeyDown) node.removeEventListener("keydown", cleanupOnKeyDown, { capture: true });
      term?.dispose();
      term = null;
      fit = null;
      sessionId = null;
    });
  });

  return (
    <div
      ref={setContainer}
      class={cn(
        "flex-1 min-h-0 outline-none",
        active() ? "block" : "hidden",
      )}
    />
  );
}
