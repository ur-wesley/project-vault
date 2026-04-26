import { listen } from "@tauri-apps/api/event";
import { createQuery } from "@tanstack/solid-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  on,
  untrack,
  type Accessor,
} from "solid-js";

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
  embeddedTerminalKill,
  embeddedTerminalResize,
  embeddedTerminalSpawn,
  embeddedTerminalWrite,
  getSetting,
  listAvailableShells,
} from "~/services/tauri";

function decodeChunk(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

type TerminalInstance = {
  id: string;
  name: string;
  shell?: string;
  icon?: string;
  sessionId?: string;
  attachSessionId?: string;
  term?: Terminal;
  fit?: FitAddon;
  host?: HTMLDivElement;
};

// Icon map for shells
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
  onExternalShell?: () => void;
  attachRequest?: Accessor<{ sessionId: string; label: string } | null>;
}) {
  const { t } = useI18n();
  const [instances, setInstances] = createSignal<TerminalInstance[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [banner, setBanner] = createSignal<string | null>(null);

  // Handle attach requests
  createEffect(() => {
    const req = props.attachRequest?.();
    if (!req) return;

    untrack(() => {
      // Check if already attached
      const list = instances();
      const existing = list.find(
        (i) => i.attachSessionId === req.sessionId || i.sessionId === req.sessionId,
      );
      if (existing) {
        setActiveId(existing.id);
        return;
      }

      const id = Math.random().toString(36).substring(2, 11);
      const newInstance: TerminalInstance = {
        id,
        name: req.label,
        icon: "mdi--application-variable-outline",
        attachSessionId: req.sessionId,
      };
      setInstances([...list, newInstance]);
      setActiveId(id);
    });
  });

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
    const id = Math.random().toString(36).substring(2, 11);
    const targetShell = shell || defaultShellQ.data || undefined;
    
    // Find shell info for label/icon
    const shellInfo = shellsQ.data?.find(s => s.executable === targetShell);
    const label = name || shellInfo?.label || (targetShell ? "Terminal" : "Default Shell");
    const icon = shellInfo ? (SHELL_ICON_MAP[shellInfo.id.toLowerCase()] || "mdi--console") : "mdi--terminal";

    const newInstance: TerminalInstance = {
      id,
      name: label,
      shell: targetShell,
      icon,
    };
    setInstances([...instances(), newInstance]);
    setActiveId(id);
  };

  const closeInstance = (id: string) => {
    const inst = instances().find((i) => i.id === id);
    if (inst?.sessionId) {
      void embeddedTerminalKill(inst.sessionId);
    }
    inst?.term?.dispose();

    const next = instances().filter((i) => i.id !== id);
    setInstances(next);
    if (activeId() === id) {
      setActiveId(next.length > 0 ? next[next.length - 1]!.id : null);
    }
  };

  onMount(() => {
    void createInstance();
  });

  onCleanup(() => {
    for (const inst of instances()) {
      if (inst.sessionId) {
        void embeddedTerminalKill(inst.sessionId);
      }
      inst.term?.dispose();
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Show when={banner()}>
        <p class="mb-2 shrink-0 text-sm text-destructive">{banner()}</p>
      </Show>

      <div class="mb-1 flex shrink-0 items-center justify-between border-b border-border/40 pb-1">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden px-1 scrollbar-none">
          <For each={instances()}>
            {(inst) => (
              <div
                class={cn(
                  "flex h-7 min-w-24 max-w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-x border-t px-2 text-xs transition-colors",
                  activeId() === inst.id
                    ? "border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => setActiveId(inst.id)}
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
          <DropdownMenu>
            <DropdownMenuTrigger
              as={Button}
              variant="ghost"
              size="icon"
              class="size-7"
              title="New Terminal"
            >
              <span class="iconify mdi--plus size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => void createInstance()}>
                <span class="iconify mdi--terminal mr-2 size-4" />
                <span>Default Shell</span>
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

      <div class="relative min-h-0 flex-1 bg-card">
        <For each={instances()}>
          {(inst) => (
            <TerminalHost
              instance={inst}
              active={props.active && activeId() === inst.id}
              projectId={props.projectId}
              shell={inst.shell}
              onSessionId={(sid) => {
                inst.sessionId = sid;
              }}
              onError={(err) => setBanner(err)}
            />
          )}
        </For>
        <Show when={instances().length === 0}>
          <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Button variant="outline" size="sm" onClick={() => void createInstance()}>
              {(t("projectDetail.openTerminal") as string) || "Open Terminal"}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function TerminalHost(props: {
  instance: TerminalInstance;
  active: boolean;
  projectId: string;
  shell?: string;
  attachSessionId?: string;
  onSessionId: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const { t } = useI18n();
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);

  createEffect(() => {
    const node = container();
    if (!node) return;

    // DEFINITIVE FIX: Use a capturing listener to stop focus events
    // from reaching parent components (Kobalte/Solid) that cause focus loops.
    const stopFocus = (e: FocusEvent) => {
      e.stopPropagation();
    };
    node.addEventListener("focusin", stopFocus, { capture: true });
    node.addEventListener("focusout", stopFocus, { capture: true });

    onCleanup(() => {
      node.removeEventListener("focusin", stopFocus, { capture: true });
      node.removeEventListener("focusout", stopFocus, { capture: true });
    });

    let cancelled = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let sessionId: string | null = null;
    let unData: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let ro: ResizeObserver | null = null;
    let resizeT: number | undefined;

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
      term.open(node);
      fit.fit();

      props.instance.term = term;
      props.instance.fit = fit;
      props.instance.host = node;

      let sid = props.attachSessionId;
      if (!sid) {
        const spawn = await embeddedTerminalSpawn(props.projectId, props.shell);
        if (spawn.isErr()) {
          props.onError(stableErrorMessage(t, spawn.error));
          term.dispose();
          term = null;
          return;
        }
        sid = spawn.value;
      }

      if (cancelled) {
        if (!props.attachSessionId) void embeddedTerminalKill(sid!);
        term.dispose();
        return;
      }
      sessionId = sid!;
      props.onSessionId(sessionId);

      term.onData((data) => {
        if (!sessionId) return;
        void embeddedTerminalWrite(sessionId, data);
      });

      unData = await listen<{ sessionId: string; chunk: string }>(
        "embedded-terminal-data",
        (ev) => {
          if (ev.payload.sessionId !== sessionId || !term) return;
          const data = decodeChunk(ev.payload.chunk);
          term.write(data);
        },
      );

      unExit = await listen<{ sessionId: string }>("embedded-terminal-exit", (ev) => {
        if (ev.payload.sessionId !== sessionId || !term) return;
        term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
      });

      const pushResize = () => {
        if (!sessionId || !term) return;
        fit?.fit();
        void embeddedTerminalResize(sessionId, term.rows, term.cols);
      };
      pushResize();

      ro = new ResizeObserver(() => {
        window.clearTimeout(resizeT);
        resizeT = window.setTimeout(() => pushResize(), 120);
      });
      ro.observe(node);
    })();

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(resizeT);
      ro?.disconnect();
      unData?.();
      unExit?.();
      // Only kill if we spawned it ourselves
      if (sessionId && !props.attachSessionId) {
        void embeddedTerminalKill(sessionId);
      }
      term?.dispose();
    });
  });

  createEffect(
    on(
      () => props.active,
      (active) => {
        const t = props.instance.term;
        if (active && t) {
          // Significant delay to ensure DOM is settled and other focus logic has finished
          const timer = window.setTimeout(() => {
            if (!props.active || document.activeElement === t.textarea) return;
            if (t.element?.offsetParent !== null) {
              t.focus();
              props.instance.fit?.fit();
            }
          }, 100);
          onCleanup(() => window.clearTimeout(timer));
        }
      },
      { defer: true },
    ),
  );

  return (
    <div
      ref={setContainer}
      class={cn(
        "absolute inset-0 size-full p-2 outline-none",
        props.active ? "z-10 visible" : "z-0 invisible",
      )}
    />
  );
}
