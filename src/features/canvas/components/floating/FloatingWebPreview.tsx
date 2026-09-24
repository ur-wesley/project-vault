import { Show, createSignal, createEffect, type Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createQuery } from "@tanstack/solid-query";
import { listAllProcesses } from "~/services/tauri/sessions";
import { webPreviewPing } from "~/services/tauri/canvas";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "../nodes/CanvasNodeContainer";
import { useCanvasLive } from "../../live/canvasLive";
import { linkedToolsId, emitWebPreviewEvent } from "../../webview/webToolsBus";
import { normalizePreviewUrl } from "../../webview/previewUrl";

export const FloatingWebPreview: Component<CanvasNodeComponentProps> = (props) => {
  const nodeId = () => props.node.id;

  const defaultPortForProject = () => {
    const stack = props.project().stack?.toLowerCase() ?? "";
    const taskLabels = (props.project().tasks ?? []).map((t) => t.label.toLowerCase());

    if (
      stack.includes("bun") ||
      stack.includes("vite") ||
      taskLabels.some((l) => l.includes("vite"))
    ) {
      return 5173;
    }
    if (stack.includes("dotnet")) return 5000;
    if (stack.includes("go")) return 8080;
    return 3000;
  };

  // `committed` drives the iframe src; `draft` is the address-bar text until committed (Enter/Go).
  const [port, setPort] = createSignal(defaultPortForProject());
  const [committed, setCommitted] = createSignal(`http://localhost:${defaultPortForProject()}`);
  const [draft, setDraft] = createSignal(committed());
  const [cacheBuster, setCacheBuster] = createSignal("");
  const [liveStatus, setLiveStatus] = createSignal<number | null>(null);
  const [flushNotice, setFlushNotice] = createSignal(false);
  // Once the user navigates manually, stop auto-following the detected dev port.
  let manualNav = false;

  let iframeEl: HTMLIFrameElement | undefined;

  // Shared liveness scope (one 3s poll per canvas, not per node). The
  // fallback keeps standalone renders working outside a CanvasLiveProvider.
  const sharedLive = useCanvasLive();
  const fallbackProcsQ = createQuery(() => ({
    queryKey: ["processes", "list"],
    queryFn: async () => {
      const res = await listAllProcesses();
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 3000,
    enabled: !sharedLive,
  }));

  createEffect(() => {
    if (manualNav) return;
    const procs = sharedLive?.processes() ?? fallbackProcsQ.data ?? [];
    const projProc = procs.find(
      (p) => p.projectId === props.project().id && p.ports && p.ports.length > 0,
    );
    if (projProc?.ports[0]) {
      const detectedPort = projProc.ports[0];
      setPort(detectedPort);
      const next = `http://localhost:${detectedPort}`;
      setCommitted(next);
      setDraft(next);
    }
  });

  const computedSrc = () => {
    const base = committed();
    if (!cacheBuster()) return base;
    return base.includes("?") ? `${base}&_cb=${cacheBuster()}` : `${base}?_cb=${cacheBuster()}`;
  };

  const pingAndEmit = async (target: string) => {
    try {
      const res = await webPreviewPing(target);
      if (res.isOk()) {
        setLiveStatus(res.value.status);
        emitWebPreviewEvent({
          kind: "ping",
          targetId: nodeId(),
          atMs: Date.now(),
          url: res.value.url,
          method: "GET",
          status: res.value.status,
          durationMs: res.value.durationMs,
          ok: res.value.ok,
        });
      } else {
        setLiveStatus(null);
        emitWebPreviewEvent({
          kind: "console",
          targetId: nodeId(),
          atMs: Date.now(),
          level: "error",
          message: `Ping failed for ${target}: ${res.error.message}`,
        });
      }
    } catch (e) {
      setLiveStatus(null);
      emitWebPreviewEvent({
        kind: "console",
        targetId: nodeId(),
        atMs: Date.now(),
        level: "error",
        message: `Ping failed for ${target}: ${String(e)}`,
      });
    }
  };

  // Committed URL changes (address-bar commit, port detect, reload) → ping.
  // The iframe src is reactive; typing only touches `draft`, so no reloads while typing.
  createEffect(() => {
    const target = computedSrc();
    const id = nodeId();
    emitWebPreviewEvent({ kind: "navigate", targetId: id, atMs: Date.now(), url: target });
    void pingAndEmit(target);
  });

  const commit = async (raw: string) => {
    const next = normalizePreviewUrl(raw);
    if (!next) return;
    manualNav = true;
    setDraft(next);
    if (next !== committed()) setCommitted(next);
    else {
      // Same URL → treat as reload.
      await handleRefresh();
    }
  };

  const handleHistory = async (dir: "back" | "forward") => {
    try {
      if (dir === "back") iframeEl?.contentWindow?.history.back();
      else iframeEl?.contentWindow?.history.forward();
    } catch {
      // cross-origin fallback: no-op
    }
  };

  const handleRefresh = async () => {
    // New cache-buster forces a fresh iframe load (same-URL reload).
    setCacheBuster(Date.now().toString());
  };

  const handleClearCacheAndCookies = async () => {
    setCacheBuster(Date.now().toString());
    emitWebPreviewEvent({
      kind: "flush",
      targetId: nodeId(),
      atMs: Date.now(),
      url: computedSrc(),
    });
    setFlushNotice(true);
    setTimeout(() => setFlushNotice(false), 2500);
    // cacheBuster change re-runs the committed effect (ping).
  };

  const handleOpenBrowser = async () => {
    try {
      await openUrl(committed());
    } catch {
      window.open(committed(), "_blank");
    }
  };

  /** Ensures the single linked WebTools sibling exists (state caps at 1:1). */
  const ensureToolsSibling = () => {
    try {
      if (!linkedToolsId(props.allNodes ?? [], nodeId())) {
        window.dispatchEvent(
          new CustomEvent("pv:add-web-tools", { detail: { targetId: nodeId() } }),
        );
      }
    } catch {
      // preview without canvas context — nothing to link
    }
  };

  const badge = () => {
    const s = liveStatus();
    if (s !== null) return `:${port()} · ${s}`;
    return `:${port()} · iframe`;
  };

  return (
    <CanvasNodeContainer
      node={{
        ...props.node,
        width: props.node.width || 480,
        height: props.node.height || 400,
      }}
      icon="mdi--web"
      badge={badge()}
      badgeVariant={(() => {
        const s = liveStatus();
        return s !== null && (s < 200 || s >= 400) ? "amber" : "nominal";
      })()}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
    >
      <div class="flex h-full flex-col gap-2">
        {/* Browser Bar: history, address, reload, tools */}
        <div class="flex items-center gap-1 rounded-lg border border-border/50 bg-background/70 px-1.5 py-1 text-xs">
          <button
            type="button"
            onClick={() => void handleHistory("back")}
            title="Go back"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span class="iconify mdi--arrow-left size-3" />
          </button>
          <button
            type="button"
            onClick={() => void handleHistory("forward")}
            title="Go forward"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span class="iconify mdi--arrow-right size-3" />
          </button>
          <span class="iconify mdi--lock-outline size-3 text-emerald-400 shrink-0" />
          <input
            type="text"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit(e.currentTarget.value);
              e.stopPropagation();
            }}
            spellcheck={false}
            class="flex-1 bg-transparent font-mono text-[11px] text-foreground focus:outline-none truncate"
          />
          <button
            type="button"
            onClick={() => void commit(draft())}
            title="Go to URL"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span class="iconify mdi--arrow-right-circle-outline size-3" />
          </button>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            title="Reload preview"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span class="iconify mdi--refresh size-3" />
          </button>

          <button
            type="button"
            onClick={() => void handleClearCacheAndCookies()}
            title="Reload bypassing cache"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-amber-500/20 hover:text-amber-400 border border-transparent hover:border-amber-500/30 transition-all"
          >
            <span class="iconify mdi--broom size-3" />
            <span class="hidden sm:inline">Flush</span>
          </button>

          <button
            type="button"
            onClick={ensureToolsSibling}
            title="Open WebTools — one sibling per preview"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
          >
            <span class="iconify mdi--tools size-3" />
            <span class="hidden sm:inline">DevTools</span>
          </button>

          <button
            type="button"
            onClick={() => void handleOpenBrowser()}
            title="Open in default browser"
            class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span class="iconify mdi--open-in-new size-3" />
          </button>
        </div>

        <Show when={flushNotice()}>
          <div class="flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-300 border border-amber-500/30 animate-in fade-in">
            <span class="iconify mdi--check size-3" />
            <span>Cache bypassed. Preview reloaded.</span>
          </div>
        </Show>

        {/* Page */}
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="relative min-h-[120px] w-full flex-1 overflow-hidden rounded-lg border border-border/50 bg-white">
            <iframe
              ref={(el) => {
                iframeEl = el;
              }}
              src={computedSrc()}
              title="Local Web Preview"
              class="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
              allowfullscreen
            />
          </div>
        </div>
      </div>
    </CanvasNodeContainer>
  );
};
