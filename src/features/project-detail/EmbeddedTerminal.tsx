import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText } from "tauri-plugin-clipboard-api";
import { createQuery } from "@tanstack/solid-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkProvider, Terminal as XTermTerminal } from "@xterm/xterm";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";
import { toast } from "solid-sonner";

import "@xterm/xterm/css/xterm.css";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { cn } from "~/lib/utils";
import { queryKeys } from "~/services/query-keys";
import {
  appendTerminalChunk,
  getTerminalReplay,
  clearTerminalBuffer,
} from "./lib/terminal-buffer";
import {
  embeddedTerminalKill,
  embeddedTerminalResize,
  embeddedTerminalSpawn,
  embeddedTerminalWrite,
  getSetting,
  listAvailableShells,
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

export type EmbeddedTerminalInstance = {
  id: string;
  name: string;
  shell?: string;
  icon?: string;
  sessionId?: string;
  attachSessionId?: string;
};

const SHELL_ICON_MAP: Record<string, string> = {
  powershell: "mdi--powershell",
  pwsh: "mdi--powershell",
  cmd: "mdi--console",
  nu: "mdi--nix",
  bash: "mdi--bash",
  zsh: "mdi--bash",
  fish: "mdi--fish",
  sh: "mdi--console-line",
};

export function EmbeddedTerminalPane(props: {
  projectId: string;
  active: boolean;
  instances: Accessor<readonly EmbeddedTerminalInstance[]>;
  activeId: Accessor<string | null>;
  onOpenTerminal: (instance: Pick<EmbeddedTerminalInstance, "name" | "shell" | "icon">) => void;
  onCloseTerminal: (id: string) => void | Promise<void>;
  onSelectTerminal: (id: string) => void;
  onUpdateSessionId: (id: string, sessionId: string) => void;
  onExternalShell?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const { t } = useI18n();

  const shellsQ = createQuery(() => ({
    queryKey: queryKeys.availableShells,
    queryFn: async () => {
      const r = await listAvailableShells();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const defaultShellQ = createQuery(() => ({
    queryKey: ["settings", "default_shell_path"] as const,
    queryFn: async () => {
      const r = await getSetting("default_shell_path");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const createInstance = async (name?: string, shell?: string) => {
    const targetShell = shell || defaultShellQ.data || undefined;
    const shellInfo = shellsQ.data?.find(s => s.executable === targetShell);
    const label = name || shellInfo?.label || (targetShell ? (t("projectDetail.tabTerminal") as string) : (t("projectDetail.terminalDefaultShell") as string));
    const icon = shellInfo ? (SHELL_ICON_MAP[shellInfo.id.toLowerCase()] || "mdi--console") : "mdi--terminal";

    props.onOpenTerminal({
      name: label,
      shell: targetShell,
      icon,
    });
  };

  const closeInstance = (id: string) => {
    void props.onCloseTerminal(id);
  };

  return (
    <div
      class={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card",
        props.fullscreen && "fixed inset-x-0 bottom-0 top-9 z-50 rounded-none border-0",
      )}
    >
      <div class="flex shrink-0 items-center justify-between px-3 pt-2 pb-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden scrollbar-none">
          <For each={props.instances()}>
            {(inst) => (
              <div
                class={cn(
                  "flex h-7 min-w-24 max-w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-sm px-2 text-xs transition-colors",
                  props.activeId() === inst.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => props.onSelectTerminal(inst.id)}
              >
                <span class={cn("iconify size-3.5 shrink-0", inst.icon || "mdi--terminal")} />
                <span class="min-w-0 flex-1 truncate">{inst.name}</span>
                <button
                  type="button"
                  class="flex size-4 items-center justify-center rounded-sm hover:bg-muted hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeInstance(inst.id);
                  }}
                >
                  <span class="iconify mdi--close size-3" />
                </button>
              </div>
            )}
          </For>
        </div>

        <div class="flex shrink-0 items-center gap-1 pl-2">
          <div class="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              class="size-7 rounded-r-none"
              onClick={() => void createInstance()}
              title={t("projectDetail.terminalNew") as string}
            >
              <span class="iconify mdi--plus size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                variant="ghost"
                size="icon"
                class="size-7 -ml-px rounded-l-none"
                title={t("projectDetail.terminalNew") as string}
              >
                <span class="iconify mdi--chevron-down size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => void createInstance()}>
                  <span class="iconify mdi--terminal mr-2 size-4" />
                  <span>{t("projectDetail.terminalDefaultShell") as string}</span>
                </DropdownMenuItem>
                <Show when={shellsQ.data && shellsQ.data.length > 0}>
                  <For each={shellsQ.data}>
                    {(shell) => (
                      <DropdownMenuItem
                        onSelect={() => void createInstance(shell.label, shell.executable)}
                      >
                        <span class="iconify mdi--console mr-2 size-4" />
                        <span>{shell.label}</span>
                      </DropdownMenuItem>
                    )}
                  </For>
                </Show>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Show when={props.onToggleFullscreen}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7"
              onClick={() => props.onToggleFullscreen?.()}
              title={props.fullscreen ? "Exit Fullscreen" : "Fullscreen Terminal"}
            >
              <span class={cn("iconify size-4", props.fullscreen ? "mdi--fullscreen-exit" : "mdi--fullscreen")} />
            </Button>
          </Show>

          <Show when={props.onExternalShell}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7"
              onClick={() => props.onExternalShell?.()}
              title={t("projectDetail.openExternalTerminal") as string}
            >
              <span class="iconify mdi--open-in-new size-4" />
            </Button>
          </Show>
        </div>
      </div>

      <div class="min-h-0 flex-1 p-3">
        <div class="relative h-full overflow-hidden rounded-sm" style={{ "background-color": "#111111" }}>
          <For each={props.instances()}>
            {(inst) => (
              <TerminalHost
                instance={inst}
                activeId={props.activeId}
                isActivePane={props.active}
                projectId={props.projectId}
                onSessionId={(id, sid) => props.onUpdateSessionId(id, sid)}
                onError={(err) => toast.error(err)}
              />
            )}
          </For>
          <Show when={props.instances().length === 0}>
            <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Button variant="outline" size="sm" onClick={() => void createInstance()}>
                {(t("projectDetail.openTerminal") as string)}
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function TerminalHost(props: {
  instance: EmbeddedTerminalInstance;
  activeId: Accessor<string | null>;
  isActivePane: boolean;
  projectId: string;
  onSessionId: (id: string, sessionId: string) => void;
  onError: (msg: string | null) => void;
}) {
  const active = createMemo(() => props.isActivePane && props.activeId() === props.instance.id);
  const { t } = useI18n();
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = createSignal(false);

  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let hasInitialized = false;
  let sessionId: string | null = null;

  const MIN_COLS = 20;
  const MIN_ROWS = 5;

  const doResize = () => {
    if (!sessionId || !term || !fit) return;
    const rect = term.element?.getBoundingClientRect();
    // Bail out if the terminal is hidden or hasn't finished layout yet.
    // Resizing xterm to a tiny width corrupts the buffer (lines get wrapped
    // at 1–2 columns) and that damage persists even after resizing back up.
    if (!rect || rect.width < 200 || rect.height < 100) return;
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

    // Wait for the browser to finish layout after the tab becomes visible
    // before measuring and resizing, to avoid corrupting the buffer with
    // a tiny intermediate size.
    raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (!active() || !currentTerm.element) return;
        if (currentTerm.element.offsetParent !== null) {
          currentTerm.focus();
          doResize();
          // Force a full refresh so lines corrupted while hidden repaint correctly
          currentTerm.refresh(0, currentTerm.rows - 1);
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
    if (!node || hasInitialized) return;

    const stopFocus = (e: FocusEvent) => {
      e.stopPropagation();
    };
    node.addEventListener("focusin", stopFocus, { capture: true });
    node.addEventListener("focusout", stopFocus, { capture: true });

    onCleanup(() => {
      node.removeEventListener("focusin", stopFocus, { capture: true });
      node.removeEventListener("focusout", stopFocus, { capture: true });
    });

    // Capture prop values once so the effect does not re-run when the parent
    // updates the instance object (e.g. after setting the sessionId).
    const instanceId = untrack(() => props.instance.id);
    const instanceShell = untrack(() => props.instance.shell);
    const attachSid = untrack(() => props.instance.attachSessionId);
    const existingSessionId = untrack(() => props.instance.sessionId);
    const projectId = untrack(() => props.projectId);
    const onSessionId = untrack(() => props.onSessionId);
    const onError = untrack(() => props.onError);

    let cancelled = false;
    let spawnedByThisEffect = false;
    let unData: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let ro: ResizeObserver | null = null;
    let resizeT: number | undefined;
    let linkProvider: { dispose: () => void } | null = null;
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    const existingSid = attachSid ?? existingSessionId;
    let sid = existingSid;

    hasInitialized = true;

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

      const onKeyDown = (e: KeyboardEvent) => {
        const isPaste = (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
        if (!isPaste || !term) return;
        e.preventDefault();
        e.stopPropagation();
        readText()
          .then((text) => {
            if (term) term.paste(text);
          })
          .catch((err) => {
            console.error("clipboard read failed:", err);
          });
      };
      node.addEventListener("keydown", onKeyDown, { capture: true });
      // Only fit if the container is actually visible. When the terminal tab
      // is not active, the parent TabsContent is display:none and fit() would
      // resize xterm to 0x0, corrupting the buffer before any data arrives.
      const openRect = node.getBoundingClientRect();
      if (openRect.width >= 200 && openRect.height >= 100) {
        fit.fit();
      }
      if (!sid) {
        const spawn = await embeddedTerminalSpawn(projectId, instanceShell);
        if (spawn.isErr()) {
          onError(stableErrorMessage(t, spawn.error));
          term.dispose();
          term = null;
          return;
        }
        sid = spawn.value;
        spawnedByThisEffect = true;
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

      // Replay buffered output so the terminal is not empty after remounting
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
        clearTerminalBuffer(ev.payload.sessionId);
        term.writeln("\r\n\x1b[90m" + (t("projectDetail.terminalProcessExited") as string) + "\x1b[0m");
      });

      doResize();

      ro = new ResizeObserver(() => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(() => doResize(), 120);
      });
      ro.observe(node);
    })();

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(resizeT);
      ro?.disconnect();
      unData?.();
      unExit?.();
      linkProvider?.dispose();
      if (onKeyDown) node.removeEventListener("keydown", onKeyDown, { capture: true });
      // NOTE: We do NOT kill the PTY session here.
      // The session should stay alive when the user switches routes/tabs.
      // It is only killed when the user explicitly closes the terminal tab.
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
        "h-full w-full outline-none",
        active() ? "block" : "hidden",
      )}
    />
  );
}
