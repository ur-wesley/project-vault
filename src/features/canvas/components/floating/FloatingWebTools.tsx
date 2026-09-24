import { For, Show, createSignal, createEffect, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import type { CanvasNodeDto } from "~/types/dto";
import { listAllProcesses, listSessionsForProject } from "~/services/tauri/sessions";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "../nodes/CanvasNodeContainer";
import { useWebToolsLive } from "../../webview/useWebToolsLive";
import {
  linkedToolsId,
  parseWebToolsTarget,
  subscribeWebPreviewEvents,
} from "../../webview/webToolsBus";
import { useCanvasLive } from "../../live/canvasLive";

type DevToolTab = "console" | "network" | "storage";

function getDevToolTabLabel(
  t: DevToolTab,
  consoleCount: number,
  networkCount: number,
): string {
  if (t === "console") return `Console (${consoleCount})`;
  if (t === "network") return `Network (${networkCount})`;
  return "Storage";
}

interface Props extends CanvasNodeComponentProps {
  allNodes?: CanvasNodeDto[];
}

function defaultPortForProject(
  project: () => Props["project"] extends never ? never : ReturnType<Props["project"]>,
): number {
  const p = (project as unknown as () => { stack?: string | null; tasks?: { label: string }[] })();
  const stack = p.stack?.toLowerCase() ?? "";
  const labels = (p.tasks ?? []).map((t) => t.label.toLowerCase());
  if (stack.includes("bun") || stack.includes("vite") || labels.some((l) => l.includes("vite")))
    return 5173;
  if (stack.includes("dotnet")) return 5000;
  if (stack.includes("go")) return 8080;
  return 3000;
}

export const FloatingWebTools: Component<CanvasNodeComponentProps> = (rawProps) => {
  const props = rawProps as Props;
  const initialTarget = () => parseWebToolsTarget(props.node.dataJson);
  const [targetId, setTargetId] = createSignal<string>(initialTarget() ?? "");
  const [targetUrl, setTargetUrl] = createSignal(
    `http://localhost:${defaultPortForProject(props.project)}`,
  );
  const [tab, setTab] = createSignal<DevToolTab>("console");

  const allNodes = () => props.allNodes ?? [];
  const webPreviews = () => allNodes().filter((n) => n.nodeType === "webPreview");
  const targetNode = () => allNodes().find((n) => n.id === targetId());

  // Keep dataJson link in sync when picker changes — emits an event the
  // canvas state persists (refusing when another tools node claims the
  // target: 1:1 rule). Reverts the picker with a note in that case.
  const [linkNote, setLinkNote] = createSignal<string | null>(null);
  createEffect(() => {
    const t = targetId();
    if (t && t !== parseWebToolsTarget(props.node.dataJson)) {
      const claimedBy = linkedToolsId(allNodes(), t);
      if (claimedBy && claimedBy !== props.node.id) {
        setTargetId(parseWebToolsTarget(props.node.dataJson) ?? "");
        setLinkNote("That preview already has a linked WebTools node (1:1).");
        return;
      }
      setLinkNote(null);
      window.dispatchEvent(
        new CustomEvent("pv:link-web-tools", { detail: { nodeId: props.node.id, targetId: t } }),
      );
    }
  });

  // Learn the live URL from the sibling preview's navigate events + port detection.
  // Shared canvas scope collapses per-node polls into one fetch per interval;
  // fallbacks keep standalone renders working outside a CanvasLiveProvider.
  const sharedLive = useCanvasLive();
  const fallbackProcsQ = createQuery(() => ({
    queryKey: ["processes", "list"],
    queryFn: async () => {
      const res = await listAllProcesses();
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 5000,
    enabled: !sharedLive,
  }));

  createEffect(() => {
    const procs = sharedLive?.processes() ?? fallbackProcsQ.data ?? [];
    const hit = procs.find((p) => p.projectId === props.project().id && p.ports?.length);
    if (hit?.ports[0]) setTargetUrl(`http://localhost:${hit.ports[0]}`);
  });

  createEffect(() => {
    const t = targetId();
    if (!t) return;
    return subscribeWebPreviewEvents(t, (e) => {
      if (e.kind === "navigate" && e.url) setTargetUrl(e.url);
    });
  });

  const live = useWebToolsLive(targetId, targetUrl);

  const [consoleLevel, setConsoleLevel] = createSignal<string>("all");
  const [consoleFilter, setConsoleFilter] = createSignal("");
  const [netKind, setNetKind] = createSignal<string>("all");
  const [netFilter, setNetFilter] = createSignal("");
  const [selectedRowId, setSelectedRowId] = createSignal<string | null>(null);

  const filteredConsole = () => {
    const lvl = consoleLevel();
    const q = consoleFilter().trim().toLowerCase();
    return live.consoleLines().filter((l) => {
      if (lvl !== "all" && l.level !== lvl) return false;
      if (q && !(l.message.toLowerCase().includes(q) || (l.stack ?? "").toLowerCase().includes(q)))
        return false;
      return true;
    });
  };

  const NET_KINDS = ["all", "fetch", "xhr", "ws", "sse", "resource", "document", "probe"] as const;

  const filteredNetwork = () => {
    const kind = netKind();
    const q = netFilter().trim().toLowerCase();
    return live.networkRows().filter((r) => {
      const base = r.kind.split(":")[0];
      if (kind !== "all" && base !== kind) return false;
      if (q && !(r.url.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q)))
        return false;
      return true;
    });
  };

  const selectedRow = () => live.networkRows().find((r) => r.id === selectedRowId()) ?? null;

  const hookStatus = () => {
    if (!targetId()) return "unlinked";
    return "probe";
  };

  // Note: probe-only tools — ping + navigation events from the linked iframe
  // preview. For real console/network inspection, open the page in a browser.

  // Surface recent dev-server sessions as console context (real, not mock).
  const fallbackSessionsQ = createQuery(() => ({
    queryKey: ["webtools", "sessions", props.project().id],
    queryFn: async () => {
      const res = await listSessionsForProject(props.project().id, 5, 0);
      return res.isOk() ? res.value : [];
    },
    refetchInterval: 8000,
    enabled: !sharedLive,
  }));

  let lastSessionNote = "";
  createEffect(() => {
    const sessions = sharedLive?.sessions() ?? fallbackSessionsQ.data ?? [];
    if (sessions.length === 0) return;
    const latest = sessions[0];
    const key = `${latest.id}:${latest.state}:${latest.lastEventAtMs}`;
    if (key === lastSessionNote) return;
    lastSessionNote = key;
    live.pushConsole(
      "info",
      `Dev session: ${latest.command ?? "session"} [${latest.state}] pid=${latest.rootPid ?? "?"} (from task monitor)`,
    );
  });

  const handleFlushTarget = () => {
    if (!targetId()) return;
    live.pushConsole(
      "warn",
      `Flush requested for ${targetId()} — preview reloads bypassing cache.`,
    );
  };

  const badge = () => {
    const s = live.lastStatus();
    if (s !== null) return `${s}`;
    return hookStatus();
  };

  return (
    <CanvasNodeContainer
      node={{ ...props.node, width: props.node.width || 440, height: props.node.height || 340 }}
      icon="mdi--tools"
      badge={badge()}
      badgeVariant={
        live.lastStatus() !== null && (live.lastStatus()! < 200 || live.lastStatus()! >= 400)
          ? "amber"
          : "nominal"
      }
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
        {/* Target picker */}
        <div class="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/70 px-2 py-1 text-xs">
          <span class="iconify mdi--link-variant size-3 text-primary shrink-0" />
          <Show
            when={targetId()}
            fallback={<span class="text-muted-foreground">No preview linked — pick one:</span>}
          >
            <span class="truncate font-mono text-[11px]" title={targetUrl()}>
              {targetNode()?.title ?? targetId()} ·{" "}
              <span class="text-muted-foreground">{targetUrl()}</span>
            </span>
          </Show>
          <select
            value={targetId()}
            onChange={(e) => setTargetId(e.currentTarget.value)}
            class="ml-auto max-w-[160px] bg-transparent text-[11px] text-foreground focus:outline-none"
            title="Link to a Web Preview node"
          >
            <option value="">Unlinked</option>
            <For each={webPreviews()}>{(n) => <option value={n.id}>{n.title}</option>}</For>
          </select>
          <span
            title={
              hookStatus() === "probe"
                ? "Probe mode — ping + navigation events only"
                : "No preview linked"
            }
            class="size-2 shrink-0 rounded-full"
            classList={{
              "bg-sky-400": hookStatus() === "probe",
              "bg-slate-600": hookStatus() === "unlinked",
            }}
          />
          <button
            type="button"
            onClick={() => void live.ping()}
            title="Ping target endpoint now"
            class="flex items-center gap-0.5 rounded bg-primary/20 border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/30"
          >
            <span class="iconify mdi--play size-2.5" /> Ping
          </button>
        </div>
        <Show when={linkNote()}>
          <div class="rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1 font-mono text-[10px] text-amber-300">
            {linkNote()}
          </div>
        </Show>

        {/* Probe-mode status line */}
        <Show when={targetId()}>
          <div class="rounded bg-sky-500/10 border border-sky-500/30 px-2 py-1 font-mono text-[10px] text-sky-300">
            Probe mode — ping + navigation events only. Open the page in a browser for full
            DevTools.
          </div>
        </Show>

        {/* Tab bar */}
        <div class="flex items-center gap-1 rounded-lg border border-border/70 bg-slate-900/90 px-2 py-1 font-mono text-[10.5px]">
          {(["console", "network", "storage"] as DevToolTab[]).map((t) => (
            <button
              type="button"
              onClick={() => setTab(t)}
              class="rounded px-2 py-0.5 font-medium transition-colors"
              classList={{
                "bg-primary/25 text-primary border border-primary/40": tab() === t,
                "text-slate-400 hover:text-slate-200": tab() !== t,
              }}
            >
              {getDevToolTabLabel(t, live.consoleLines().length, live.networkRows().length)}
            </button>
          ))}
          <div class="ml-auto flex items-center gap-1 text-slate-400">
            <Show when={tab() === "console"}>
              <button
                type="button"
                onClick={live.clearConsole}
                title="Clear console"
                class="p-0.5 hover:text-slate-200"
              >
                <span class="iconify mdi--cancel size-3" />
              </button>
            </Show>
            <Show when={tab() === "network"}>
              <button
                type="button"
                onClick={live.clearNetwork}
                title="Clear network"
                class="p-0.5 hover:text-slate-200"
              >
                <span class="iconify mdi--cancel size-3" />
              </button>
            </Show>
          </div>
        </div>

        {/* Panels */}
        <div class="flex min-h-[140px] flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-slate-950/95 font-mono text-[10.5px] text-slate-300">
          <Show when={tab() === "console"}>
            <div class="flex items-center gap-1.5 border-b border-slate-800 px-2 py-1">
              <select
                value={consoleLevel()}
                onChange={(e) => setConsoleLevel(e.currentTarget.value)}
                class="bg-transparent text-[10px] text-slate-300 focus:outline-none"
                title="Level filter"
              >
                {["all", "log", "info", "warn", "error", "debug"].map((l) => (
                  <option value={l}>{l}</option>
                ))}
              </select>
              <input
                type="text"
                value={consoleFilter()}
                onInput={(e) => setConsoleFilter(e.currentTarget.value)}
                placeholder="Filter…"
                spellcheck={false}
                class="flex-1 bg-transparent text-[10px] placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <div class="flex-1 space-y-1 overflow-y-auto p-2">
              <For each={filteredConsole()}>
                {(log) => (
                  <div class="flex items-start gap-1.5 leading-relaxed">
                    <span class="text-slate-500 shrink-0 select-none">[{log.time}]</span>
                    <div class="min-w-0 flex-1">
                      <span
                        class="break-all"
                        classList={{
                          "text-slate-200": log.level === "log" || log.level === "debug",
                          "text-sky-400": log.level === "info",
                          "text-amber-400": log.level === "warn",
                          "text-rose-400 font-semibold": log.level === "error",
                        }}
                      >
                        {log.message}
                      </span>
                      <Show when={log.stack}>
                        <details class="mt-0.5 text-slate-500">
                          <summary class="cursor-pointer text-[9.5px] hover:text-slate-300">
                            stack
                          </summary>
                          <pre class="whitespace-pre-wrap break-all text-[9.5px]">{log.stack}</pre>
                        </details>
                      </Show>
                      <Show when={log.url}>
                        <div class="truncate text-[9px] text-slate-600">{log.url}</div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
              <Show when={filteredConsole().length === 0}>
                <div class="text-slate-500 italic">Console is empty</div>
              </Show>
            </div>
          </Show>

          <Show when={tab() === "network"}>
            <div class="flex items-center gap-1.5 border-b border-slate-800 px-2 py-1">
              <select
                value={netKind()}
                onChange={(e) => setNetKind(e.currentTarget.value)}
                class="bg-transparent text-[10px] text-slate-300 focus:outline-none"
                title="Type filter"
              >
                {NET_KINDS.map((k) => (
                  <option value={k}>{k}</option>
                ))}
              </select>
              <input
                type="text"
                value={netFilter()}
                onInput={(e) => setNetFilter(e.currentTarget.value)}
                placeholder="Filter URL…"
                spellcheck={false}
                class="flex-1 bg-transparent text-[10px] placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <div class="flex min-h-0 flex-1">
              <div class="flex-1 overflow-y-auto p-2">
                <table class="w-full text-left">
                  <thead>
                    <tr class="border-b border-slate-800 text-slate-500 text-[9.5px]">
                      <th class="pb-1">Type</th>
                      <th class="pb-1">Method</th>
                      <th class="pb-1">Status</th>
                      <th class="pb-1">Path</th>
                      <th class="pb-1 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredNetwork()}>
                      {(req) => (
                        <tr
                          onClick={() =>
                            setSelectedRowId(selectedRowId() === req.id ? null : req.id)
                          }
                          class="cursor-pointer border-b border-slate-900/60 hover:bg-slate-900/40"
                          classList={{ "bg-slate-900/60": selectedRowId() === req.id }}
                        >
                          <td class="py-1 pr-1 text-violet-300">{req.kind}</td>
                          <td class="py-1 pr-1 text-sky-400">{req.method}</td>
                          <td
                            class="py-1 pr-1"
                            classList={{ "text-emerald-400": req.ok, "text-rose-400": !req.ok }}
                          >
                            {req.status ?? "ERR"}
                          </td>
                          <td class="py-1 truncate max-w-[150px]" title={req.url}>
                            {req.url}
                          </td>
                          <td class="py-1 text-right text-slate-400">{req.durationMs ?? "—"}ms</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <Show when={filteredNetwork().length === 0}>
                  <div class="p-1 text-slate-500 italic">
                    No requests yet — interact with the page or press Ping.
                  </div>
                </Show>
              </div>
              <Show when={selectedRow()}>
                {(row) => (
                  <div class="w-56 shrink-0 space-y-1.5 overflow-y-auto border-l border-slate-800 p-2 text-[9.5px]">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-slate-200">Detail</span>
                      <button
                        type="button"
                        onClick={() => setSelectedRowId(null)}
                        class="text-slate-500 hover:text-slate-200"
                      >
                        ✕
                      </button>
                    </div>
                    <div class="break-all text-slate-400">{row().url}</div>
                    <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-400">
                      <span class="text-slate-600">type</span>
                      <span>{row().kind}</span>
                      <span class="text-slate-600">method</span>
                      <span>{row().method}</span>
                      <span class="text-slate-600">status</span>
                      <span>{row().status ?? "—"}</span>
                      <span class="text-slate-600">time</span>
                      <span>{row().durationMs ?? "—"}ms</span>
                      <span class="text-slate-600">proto</span>
                      <span>{row().protocol ?? "—"}</span>
                      <span class="text-slate-600">req size</span>
                      <span>{row().reqSize ?? "—"}</span>
                      <span class="text-slate-600">res size</span>
                      <span>{row().resSize ?? "—"}</span>
                    </div>
                    <Show when={row().note}>
                      <div class="text-amber-300/80">{row().note}</div>
                    </Show>
                    <Show when={row().headers && Object.keys(row().headers!).length > 0}>
                      <details open>
                        <summary class="cursor-pointer text-slate-300">headers</summary>
                        <pre class="whitespace-pre-wrap break-all text-slate-500">
                          {Object.entries(row().headers!)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join("\n")}
                        </pre>
                      </details>
                    </Show>
                    <Show when={row().snippet}>
                      <details open>
                        <summary class="cursor-pointer text-slate-300">preview</summary>
                        <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-slate-400">
                          {row().snippet}
                        </pre>
                      </details>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </Show>

          <Show when={tab() === "storage"}>
            <div class="flex-1 space-y-2 overflow-y-auto p-2">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-300">Cookies (probe mode)</span>
                <span class="text-slate-600">{Object.keys(live.cookies()).length} entries</span>
              </div>
              <div class="space-y-1">
                <For each={Object.entries(live.cookies())}>
                  {([k, v]) => (
                    <div class="flex items-center justify-between gap-2 rounded bg-slate-900/60 px-2 py-1">
                      <span class="shrink-0 font-medium text-sky-300">{k}</span>
                      <span class="truncate text-slate-400" title={v}>
                        {v || "(empty)"}
                      </span>
                    </div>
                  )}
                </For>
                <Show when={Object.keys(live.cookies()).length === 0}>
                  <div class="text-slate-500 italic">
                    Cookie inspection needs a real browser — probe mode only.
                  </div>
                </Show>
              </div>
              <div class="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleFlushTarget}
                  class="rounded bg-rose-950/40 border border-rose-800/50 px-2 py-0.5 text-[9.5px] text-rose-300 hover:bg-rose-900/50"
                >
                  Flush target storage
                </button>
                <span class="text-slate-500">Flushes: {live.flushCount()}</span>
              </div>
              <Show when={live.lastLatency() !== null}>
                <div class="text-slate-500">
                  Last latency: {live.lastLatency()}ms · status {live.lastStatus() ?? "—"}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </CanvasNodeContainer>
  );
};
