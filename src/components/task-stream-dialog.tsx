import { FitAddon, Terminal } from "ghostty-web";
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";

import { ensureGhosttyReady } from "~/lib/ghostty-init";
import { asString } from "~/lib/guards";
import { stableErrorMessage } from "~/lib/invoke-error";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useI18n } from "~/lib/i18n-context";
import {
  attachTerminalWindowRepaint,
  clearTerminalResize,
  fitAndPushTerminalSize,
  scheduleTerminalResize,
  TERMINAL_DIALOG_PUSH_DELAY_MS,
  TERMINAL_FOCUS_DELAY_MS,
  TERMINAL_RESIZE_DEBOUNCE_MS,
  type TerminalResizeTimer,
} from "~/lib/terminal-repaint";
import {
  embeddedTerminalResize,
  embeddedTerminalGetBuffer,
} from "~/services/tauri/terminal";
import {
  decodeTerminalChunk,
  isTerminalInput,
  queueTerminalWrite,
  subscribeTerminalData,
  subscribeTerminalExit,
} from "~/components/terminal/terminal-io";
import { mapInvokeError } from "~/services/tauri/utils";
import { attachTauriLinkHandler } from "~/components/terminal/terminal-links";
import { attachTerminalClipboard } from "~/components/terminal/terminal-clipboard";

function TaskStreamTerminal(props: { sessionId: string; active: boolean }) {
  const [host, setHost] = createSignal<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const { t } = useI18n();
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
    const resizeTimer: TerminalResizeTimer = { id: undefined };
    let linkProvider: { dispose: () => void } | null = null;
    let detachClipboard: (() => void) | undefined;
    let detachWindowRepaint: (() => void) | undefined;

    const pushResize = () => {
      fitAndPushTerminalSize(term, fit, (rows, cols) => {
        void embeddedTerminalResize(sid, rows, cols);
      });
    };

    void (async () => {
      try {
        // ensureGhosttyReady() resets initPromise on failure, so a retry reloads WASM.
        await ensureGhosttyReady();
        if (cancelled) return;

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
        term.open(el);
        // Hidden helper-textarea styling is single-sourced in src/App.css
        // ([data-shortcut-scope="terminal"] textarea) — no TS inline styles.
        linkProvider = attachTauriLinkHandler(term, el);
        // P2-5.4 (OQ-4) copy/paste parity: the dialog consumes the shared
        // clipboard module (copy on selection + paste), not a paste-only
        // inline handler — clipboard errors surface via console.error.
        detachClipboard = attachTerminalClipboard(el, () => term);

        window.setTimeout(() => {
          if (!cancelled) pushResize();
        }, TERMINAL_DIALOG_PUSH_DELAY_MS);

        if (cancelled) {
          term.dispose();
          return;
        }

        let replaying = false;
        term.onData((data) => {
          if (replaying || !isTerminalInput(data)) return;
          queueTerminalWrite(sid, data);
        });

        const bufferResult = await embeddedTerminalGetBuffer(sid);
        if (cancelled) return;
        if (bufferResult.isOk() && bufferResult.value.length > 0) {
          replaying = true;
          for (const chunk of bufferResult.value) {
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

        // Display-only: shared bus owns the single buffer append.
        unData = subscribeTerminalData(sid, (chunk) => {
          if (!term) return;
          const decoded = decodeTerminalChunk(chunk);
          if (decoded.length === 0) return;
          term.write(decoded);
        });

        unExit = subscribeTerminalExit(sid, () => {
          if (!term) return;
          term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
        });

        detachWindowRepaint = attachTerminalWindowRepaint(
          () => term,
          () => fit,
          pushResize,
        );

        ro = new ResizeObserver(() => {
          // Unified on TERMINAL_RESIZE_DEBOUNCE_MS (was 150ms here vs 120ms in
          // TerminalHost) — same debounce purpose, one tuning knob.
          scheduleTerminalResize(resizeTimer, pushResize, TERMINAL_RESIZE_DEBOUNCE_MS);
        });
        ro.observe(el);
        if (el.parentElement) {
          ro.observe(el.parentElement);
        }
      } catch (err: unknown) {
        console.error("[TaskStreamTerminal] ghostty init failed:", err);
        if (cancelled) return;
        setLoadError(stableErrorMessage(t, mapInvokeError(err)));
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
      unData?.();
      unExit?.();
      linkProvider?.dispose();
      detachClipboard?.();
      // OQ-1 detach-and-keep-alive: dialog close only disposes the viewer —
      // the PTY keeps running. Killing stays behind explicit onStopTask.
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
          }, TERMINAL_FOCUS_DELAY_MS);
        }
      },
      { defer: true },
    ),
  );

  return (
    <Show
      when={loadError()}
      fallback={
        <div
          class="border-border bg-card mt-2 min-h-[400px] min-w-0 w-full overflow-hidden rounded-md border p-2"
          data-shortcut-scope="terminal"
          ref={setHost}
        />
      }
    >
      {(message) => (
        <div
          class="border-destructive/50 bg-destructive/10 mt-2 min-h-[400px] w-full rounded-md border p-4 text-sm text-destructive"
          role="alert"
        >
          {message()}
        </div>
      )}
    </Show>
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
          <DialogTitle>{asString(t("projectDetail.taskOutputTitle"))}</DialogTitle>
          <DialogDescription class="space-y-2">
            <Show when={props.commandLine}>
              <p class="break-all font-mono text-[11px] text-foreground/90">{props.commandLine}</p>
            </Show>
            <p>{asString(t("projectDetail.taskOutputHint"))}</p>
          </DialogDescription>
        </DialogHeader>
        <Show when={props.sessionId}>
          {(id) => <TaskStreamTerminal sessionId={id()} active={props.open} />}
        </Show>
      </DialogContent>
    </Dialog>
  );
}
