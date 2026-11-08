import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import { useEventHub } from "~/lib/event-hub-context";
import {
  repaintTerminal,
  TERMINAL_ACTIVATION_DELAY_MS,
  TERMINAL_FOCUS_DELAY_MS,
} from "~/lib/terminal-repaint";
import { cn } from "~/lib/utils";
import { useTerminalSession, type TerminalSpawnFn } from "./terminal-session";

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
  spawnFn: TerminalSpawnFn;
  onSessionId: (id: string, sessionId: string) => void;
  onError: (msg: string | null) => void;
  onProcessExit?: (id: string, hasContent: boolean) => void;
  onCommandEntered?: (id: string, command: string) => void;
  /** When false, the terminal never grabs keyboard focus on mount/activation. Defaults to true. */
  autoFocus?: boolean;
}) {
  const active = createMemo(() => props.isActivePane && props.activeId() === props.instance.id);
  const hub = useEventHub();
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = createSignal(false);

  // Spawn/session/replay lifecycle (P2-4: extracted to ./terminal-session).
  // Focus effects below reach the live terminal through this handle.
  const session = useTerminalSession({
    container: () => container(),
    instanceId: () => props.instance.id,
    instanceShell: () => props.instance.shell,
    attachSessionId: () => props.instance.attachSessionId,
    existingSessionId: () => props.instance.sessionId,
    spawnFn: () => props.spawnFn,
    onSessionId: () => props.onSessionId,
    onError: () => props.onError,
    onProcessExit: () => props.onProcessExit,
    onCommandEntered: () => props.onCommandEntered,
    emitBlurred: () => hub.emit("terminal:blurred"),
    setTerminalReady,
  });

  createEffect(() => {
    if (!active() || !terminalReady()) return;
    const currentTerm = session.getTerm();
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
          repaintTerminal(currentTerm, session.getFit(), () => {
            pushed = session.doResize();
          });
          if (!pushed) {
            retryTimer = window.setTimeout(() => {
              if (!active()) return;
              repaintTerminal(currentTerm, session.getFit(), session.doResize);
            }, TERMINAL_ACTIVATION_DELAY_MS);
          }
        }
      }, TERMINAL_ACTIVATION_DELAY_MS);
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
      const currentTerm = session.getTerm();
      if (!currentTerm?.element) return;

      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!active() || !currentTerm.element) return;
          if (currentTerm.element.offsetParent !== null) {
            currentTerm.focus();
            repaintTerminal(currentTerm, session.getFit(), session.doResize);
          }
        }, TERMINAL_FOCUS_DELAY_MS);
      });
    });
    onCleanup(unsubFocus);
  });

  return (
    <div
      ref={setContainer}
      data-shortcut-scope="terminal"
      class={cn(
        "relative w-full h-full min-w-0 min-h-0 flex-1 overflow-hidden outline-none bg-[#111111]",
        active() ? "block" : "hidden",
      )}
    />
  );
}
