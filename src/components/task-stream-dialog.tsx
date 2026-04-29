import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText } from "tauri-plugin-clipboard-api";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkProvider, Terminal as XTermTerminal } from "@xterm/xterm";
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";

import "@xterm/xterm/css/xterm.css";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useI18n } from "~/lib/i18n-context";
import {
  embeddedTerminalKill,
  embeddedTerminalResize,
  embeddedTerminalWrite,
} from "~/services/tauri";

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

function TaskStreamTerminal(props: { sessionId: string; active: boolean }) {
  const [host, setHost] = createSignal<HTMLDivElement | null>(null);
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;

  createEffect(() => {
    const node = host();
    if (!node) return;

    // Use capturing listeners to stop focus events from bubbling to Solid/Kobalte
    const stopFocus = (e: FocusEvent) => {
      e.stopPropagation();
    };
    node.addEventListener("focusin", stopFocus, { capture: true });
    node.addEventListener("focusout", stopFocus, { capture: true });

    onCleanup(() => {
      node.removeEventListener("focusin", stopFocus, { capture: true });
      node.removeEventListener("focusout", stopFocus, { capture: true });
    });
  });

  createEffect(() => {
    const sid = props.sessionId;
    const node = host();
    if (!props.active || !node) return;

    const el = node;
    let cancelled = false;
    let unData: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let ro: ResizeObserver | null = null;
    let resizeT: number | undefined;
    let linkProvider: { dispose: () => void } | null = null;

    void (async () => {
      term = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, Consolas, monospace",
        fontSize: 12,
        theme: {
          background: "#111111",
          foreground: "#D4D4D4",
          cursor: "#FF5F5F",
        },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      linkProvider = registerTauriWebLinks(term);
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const isPaste = (event.ctrlKey || event.metaKey) && event.key === "v";
        if (isPaste && isTauri() && term) {
          event.preventDefault();
          readText().then((text) => {
            if (term) term.paste(text);
          }).catch(() => {});
          return false;
        }
        return true;
      });
      term.open(el);

      // Delay fit to ensure dialog animation is mostly done
      window.setTimeout(() => {
        if (!cancelled) fit?.fit();
      }, 200);

      if (cancelled) {
        term.dispose();
        return;
      }

      term.onData((data) => {
        void embeddedTerminalWrite(sid, data);
      });

      unData = await listen<{ sessionId: string; chunk: string }>(
        "embedded-terminal-data",
        (ev) => {
          if (ev.payload.sessionId !== sid || !term) return;
          term.write(decodeChunk(ev.payload.chunk));
        },
      );

      unExit = await listen<{ sessionId: string }>("embedded-terminal-exit", (ev) => {
        if (ev.payload.sessionId !== sid || !term) return;
        term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
      });

      const pushResize = () => {
        if (!term || !fit) return;
        fit.fit();
        void embeddedTerminalResize(sid, term.rows, term.cols);
      };

      ro = new ResizeObserver(() => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(() => pushResize(), 150);
      });
      ro.observe(el);
    })();

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(resizeT);
      ro?.disconnect();
      unData?.();
      unExit?.();
      linkProvider?.dispose();
      void embeddedTerminalKill(sid);
      term?.dispose();
      term = null;
      fit = null;
    });
  });

  createEffect(
    on(
      () => props.active,
      (active) => {
        if (active && term) {
          const t = term;
          window.setTimeout(() => {
            if (document.activeElement !== t.textarea) {
              t.focus();
            }
          }, 150);
        }
      },
      { defer: true },
    ),
  );

  return (
    <div
      class="border-border bg-card mt-2 min-h-[400px] min-w-0 overflow-hidden rounded-md border p-2"
      ref={setHost}
    />
  );
}

export function TaskStreamDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  commandLine?: string;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("projectDetail.taskOutputTitle") as string}</DialogTitle>
          <DialogDescription class="space-y-2">
            <Show when={props.commandLine}>
              <p class="break-all font-mono text-[11px] text-foreground/90">{props.commandLine}</p>
            </Show>
            <p>{t("projectDetail.taskOutputHint") as string}</p>
          </DialogDescription>
        </DialogHeader>
        <Show when={props.sessionId}>
          {(id) => <TaskStreamTerminal sessionId={id()} active={props.open} />}
        </Show>
      </DialogContent>
    </Dialog>
  );
}
