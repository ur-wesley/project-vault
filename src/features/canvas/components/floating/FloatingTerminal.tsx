import { Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { toast } from "solid-sonner";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "../nodes/CanvasNodeContainer";
import { TerminalHost } from "~/components/terminal/TerminalHost";
import { embeddedTerminalKill, embeddedTerminalSpawn } from "~/services/tauri/terminal";

type StoredTerminalData = {
  sessionId?: string;
  shell?: string;
};

function parseTerminalData(raw: string | null | undefined): StoredTerminalData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredTerminalData;
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      shell: typeof parsed.shell === "string" ? parsed.shell : undefined,
    };
  } catch {
    return {};
  }
}

export const FloatingTerminal: Component<CanvasNodeComponentProps> = (props) => {
  const stored = createMemo(() => parseTerminalData(props.node.dataJson));
  const [liveSessionId, setLiveSessionId] = createSignal<string | null>(null);
  const [mounted, setMounted] = createSignal(true);
  const [exited, setExited] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const instanceId = () => props.node.id;
  const shell = () => stored().shell;
  const currentSessionId = () => liveSessionId() ?? stored().sessionId;

  // TerminalHost only reports exits without buffered content; listen directly so
  // the Restart banner also appears when a session with output exits.
  createEffect(() => {
    const sid = currentSessionId();
    if (!sid) return;
    let unlisten: (() => void) | undefined;
    void listen<{ sessionId: string }>("embedded-terminal-exit", (ev) => {
      if (ev.payload.sessionId === currentSessionId()) setExited(true);
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  const persistSession = (sessionId: string) => {
    setLiveSessionId(sessionId);
    props.onDataChange?.(props.node.id, JSON.stringify({ sessionId, shell: shell() ?? null }));
  };

  const clearStoredSession = () => {
    setLiveSessionId(null);
    props.onDataChange?.(props.node.id, shell() ? JSON.stringify({ shell: shell() }) : null);
  };

  const remount = () => {
    setMounted(false);
    window.setTimeout(() => setMounted(true), 0);
  };

  const handleRestart = () => {
    const sid = liveSessionId() ?? stored().sessionId;
    if (sid) void embeddedTerminalKill(sid);
    setExited(false);
    setError(null);
    clearStoredSession();
    remount();
  };

  return (
    <CanvasNodeContainer
      node={{ ...props.node, width: props.node.width || 420 }}
      icon="mdi--console"
      badge="Terminal"
      bodyScrollable={false}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <Show when={error()}>
          {(msg) => (
            <div class="flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              <span class="min-w-0 flex-1 truncate">{msg()}</span>
              <button
                type="button"
                class="shrink-0 rounded px-1.5 py-0.5 font-semibold hover:bg-destructive/20"
                onClick={handleRestart}
              >
                Retry
              </button>
            </div>
          )}
        </Show>
        <Show when={exited() && !error()}>
          <div class="flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400">
            <span>Shell exited</span>
            <button
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 font-semibold hover:bg-amber-500/20"
              onClick={handleRestart}
            >
              Restart
            </button>
          </div>
        </Show>
        <div
          data-xterm-container
          onWheel={(e) => e.stopPropagation()}
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-slate-800"
          style={{ "min-height": "200px", "background-color": "#111111" }}
        >
          <Show when={mounted()} fallback={<div class="flex-1" />}>
            <TerminalHost
              instance={{
                id: instanceId(),
                name: props.node.title,
                shell: shell(),
                icon: "mdi--console",
                attachSessionId: stored().sessionId,
              }}
              activeId={instanceId}
              isActivePane={true}
              autoFocus={false}
              spawnFn={(sh) => embeddedTerminalSpawn(props.project().id, sh ?? shell())}
              onSessionId={(_id, sid) => persistSession(sid)}
              onError={(msg) => {
                setError(msg);
                if (msg) toast.error(msg);
              }}
              onProcessExit={() => setExited(true)}
            />
          </Show>
        </div>
      </div>
    </CanvasNodeContainer>
  );
};
