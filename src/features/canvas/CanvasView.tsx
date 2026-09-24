import { Show, createEffect, createSignal, on, onMount, onCleanup, type Component } from "solid-js";
import { toast } from "solid-sonner";
import type { CanvasWireDto, ProjectDto, ViewportDto } from "~/types/dto";
import { CanvasMinimap } from "./components/CanvasMinimap";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { CanvasSurface } from "./components/CanvasSurface";
import { CanvasWireEditor } from "./components/CanvasWireEditor";
import { CanvasProblemsPanel } from "./components/CanvasProblemsPanel";
import { CanvasIconSafelist } from "./components/CanvasIconSafelist";
import type { WireAnchor, WirePendingPreview } from "./components/CanvasWiresOverlay";
import type { ActiveDrag, DragPort } from "./components/CanvasPortsOverlay";
import {
  MeasuredSizesProvider,
  measuredSnapshot,
  DEFAULT_NODE_SIZE,
} from "./geometry/measuredSizes";
import { computeFullscreenLayout } from "./geometry/fullscreen";
import { CanvasLiveProvider } from "./live/canvasLive";
import { useCanvasTransform } from "./hooks/useCanvasTransform";
import { useCanvasState } from "./hooks/useCanvasState";
import { usePipelineRuntime } from "./hooks/usePipelineRuntime";
import { canConnectManual } from "./state/manualWires";
import {
  DATA_CONNECT_MESSAGES,
  canConnectData,
  getNodePorts,
  validatePipeline,
  type PipelineIssue,
} from "./state/dataflow";

interface CanvasViewProps {
  project: () => ProjectDto;
  isFlyout?: boolean;
  followActive?: boolean;
  onToggleFollowActive?: () => void;
  onPopOut?: () => void;
}

export const CanvasView: Component<CanvasViewProps> = (props) => {
  const transform = useCanvasTransform();
  const state = useCanvasState(props.project, {
    getViewport: () => transform.getViewport(),
    onViewportLoaded: (viewport) => transform.setViewport(viewport),
  });

  // Persist endless viewport (debounced in state) whenever pan/zoom changes.
  // Skipped while a node is fullscreened so the fullscreen camera never
  // overwrites the user's real viewport (restored on exit).
  interface FullscreenSave {
    viewport: ViewportDto;
    width: number;
    height: number;
  }
  const [fullscreenId, setFullscreenId] = createSignal<string | null>(null);
  const [savedFullscreen, setSavedFullscreen] = createSignal<FullscreenSave | null>(null);

  createEffect(() => {
    transform.panX();
    transform.panY();
    transform.zoom();
    if (!state.loaded()) return;
    if (fullscreenId()) return;
    state.saveViewport(transform.getViewport());
  });

  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let containerRef: HTMLDivElement | undefined;
  const [containerSize, setContainerSize] = createSignal({ width: 0, height: 0 });

  const viewSize = () => {
    const size = containerSize();
    if (size.width > 0 && size.height > 0) return size;
    return { width: window.innerWidth, height: window.innerHeight };
  };

  const viewCenterWorld = () => {
    const size = viewSize();
    const world = transform.screenToWorld(size.width / 2, size.height / 2);
    return {
      x: Math.round(world.x - 160 + Math.random() * 80),
      y: Math.round(world.y - 110 + Math.random() * 80),
    };
  };

  /** True fullscreen at 1:1 scale: camera to the padded origin, node resized
      to fill. Silent sizing — the transient dimensions never persist. */
  const applyFullscreenLayout = (id: string) => {
    const node = state.nodes().find((n) => n.id === id);
    if (!node) return false;
    const size = viewSize();
    const layout = computeFullscreenLayout(node.x, node.y, size.width, size.height);
    if (!layout) return false;
    transform.setZoom(layout.zoom);
    transform.setPanX(layout.panX);
    transform.setPanY(layout.panY);
    state.previewSize(id, layout.width, layout.height);
    return true;
  };

  const exitFullscreen = (restoreCamera: boolean) => {
    const id = fullscreenId();
    const saved = savedFullscreen();
    setFullscreenId(null);
    setSavedFullscreen(null);
    if (!id || !saved) return;
    // Node geometry always restores; only the camera depends on how we left.
    state.handleResize(id, saved.width, saved.height);
    if (restoreCamera) transform.setViewport(saved.viewport);
  };

  const handleToggleFullscreen = (id: string) => {
    if (fullscreenId() === id) {
      exitFullscreen(true);
      return;
    }
    const node = state.nodes().find((n) => n.id === id);
    if (!node) return;
    // Layout first so a degenerate container aborts before mutating anything.
    const size = viewSize();
    const layout = computeFullscreenLayout(node.x, node.y, size.width, size.height);
    if (!layout) return;
    // Switching directly from one node to another restores the first node's
    // geometry but keeps the original camera restore point.
    if (fullscreenId()) exitFullscreen(false);
    setSavedFullscreen({
      viewport: transform.getViewport(),
      width: node.width ?? DEFAULT_NODE_SIZE.width,
      height: node.height ?? DEFAULT_NODE_SIZE.height,
    });
    setFullscreenId(id);
    state.handleFocusNode(id);
    transform.setZoom(layout.zoom);
    transform.setPanX(layout.panX);
    transform.setPanY(layout.panY);
    state.previewSize(id, layout.width, layout.height);
  };

  // Any manual camera move ends fullscreen: node geometry restores, but the
  // camera stays where the user put it (no teleport on Esc afterwards).
  const abandonFullscreen = () => {
    if (fullscreenId()) exitFullscreen(false);
  };

  const handleFit = () => {
    abandonFullscreen();
    const size = viewSize();
    transform.fitView(state.nodes(), size.width, size.height, measuredSnapshot);
  };

  const handleMinimapNavigate = (worldX: number, worldY: number) => {
    abandonFullscreen();
    const size = viewSize();
    const zoom = transform.zoom();
    transform.setPanX(size.width / 2 - worldX * zoom);
    transform.setPanY(size.height / 2 - worldY * zoom);
  };

  const handleSurfaceMouseDown = (e: MouseEvent) => {
    if (
      fullscreenId() &&
      (e.button === 1 || (e.target as HTMLElement).dataset?.canvasSurface === "true")
    ) {
      abandonFullscreen();
    }
    transform.handleMouseDown(e);
  };

  const handleSurfaceWheel = (e: WheelEvent) => {
    abandonFullscreen();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    transform.handleWheel(e, rect);
  };

  const handleFocusNode = (id: string) => {
    if (fullscreenId() && fullscreenId() !== id) abandonFullscreen();
    state.handleFocusNode(id);
  };

  const handleDeleteNode = (id: string) => {
    // The node is gone — nothing to restore, just drop the session.
    if (fullscreenId() === id) {
      setFullscreenId(null);
      setSavedFullscreen(null);
    }
    state.handleDeleteNode(id);
  };

  // Keep the fullscreened node filling the viewport across resizes;
  // a vanished node (deleted/remote) simply ends the session.
  createEffect(() => {
    const size = containerSize();
    const id = fullscreenId();
    if (!id || size.width <= 0 || size.height <= 0) return;
    if (!state.nodes().find((n) => n.id === id)) {
      setFullscreenId(null);
      setSavedFullscreen(null);
      return;
    }
    applyFullscreenLayout(id);
  });

  const handleWireAction = (wire: CanvasWireDto) => {
    // Action triggered from intelligent wire chip
    if (wire.actionCommand) {
      // Future plugin / action execution
    }
  };

  // --- User-created connections (drag from port dots, click to edit) ---
  const [selectedWire, setSelectedWire] = createSignal<{
    wireId: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [pending, setPending] = createSignal<WirePendingPreview | null>(null);

  const selectedWireDto = () => {
    const sel = selectedWire();
    if (!sel) return null;
    return state.wires().find((w) => w.id === sel.wireId) ?? null;
  };

  // Drop a stale selection when the project (and its wires) changes.
  createEffect(
    on(
      () => props.project().id,
      () => {
        setSelectedWire(null);
        setPending(null);
        exitFullscreen(false);
      },
    ),
  );

  // Cursor in world coords for proximity port dots.
  const [cursorWorld, setCursorWorld] = createSignal<{ x: number; y: number } | null>(null);

  const dragInfo = (): ActiveDrag | null => {
    const p = pending();
    if (!p) return null;
    return { sourceId: p.sourceId, sourcePortId: p.sourcePortId ?? null, mode: p.mode };
  };

  // Live pipeline validation over data wires (visual wires exempt).
  const problems = () => validatePipeline(state.nodes(), state.wires());

  // Execute taskStep chains: completed runs fan out over done/failed edges.
  usePipelineRuntime({
    project: props.project,
    nodes: state.nodes,
    wires: state.wires,
    onNodeDataChange: state.handleNodeDataChange,
    onUpdateWire: state.handleUpdateWire,
  });

  const handleIssueClick = (issue: PipelineIssue) => {
    if (issue.wireId) {
      const size = viewSize();
      setSelectedWire({
        wireId: issue.wireId,
        anchor: clampAnchor({ x: size.width / 2, y: 140 }),
      });
    } else if (issue.nodeId) {
      handleFocusNode(issue.nodeId);
    }
  };

  const toContainerPoint = (clientX: number, clientY: number) => {
    const rect = containerRef?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const toWorldPoint = (clientX: number, clientY: number) => {
    const rect = containerRef?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return transform.screenToWorld(clientX - rect.left, clientY - rect.top);
  };

  const handlePortPointerDown = (sourceId: string, port: DragPort, e: PointerEvent) => {
    if (state.layoutMode() === "auto") {
      state.handleLayoutModeChange("freeform");
    }
    setSelectedWire(null);
    const start = toWorldPoint(e.clientX, e.clientY);
    // Drop target decides the kind: named data ports make functional edges,
    // node bodies make visual links. Drags from an edge dot are visual-only.
    const mode = port.kind === "data" ? "data" : "visual";
    setPending({
      sourceId,
      sourceSide: port.kind === "edge" ? port.side : undefined,
      sourcePortId: port.kind === "data" ? port.portId : null,
      sourceDir: port.kind === "data" ? port.dir : "edge",
      mode,
      cursorX: start.x,
      cursorY: start.y,
    });

    const handleMove = (moveEvent: PointerEvent) => {
      const world = toWorldPoint(moveEvent.clientX, moveEvent.clientY);
      setPending((p) => (p ? { ...p, cursorX: world.x, cursorY: world.y } : p));
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
    const handleCancel = () => {
      cleanup();
      setPending(null);
    };
    const selectCreated = (wireId: string, upEvent: PointerEvent) => {
      const anchor = toContainerPoint(upEvent.clientX, upEvent.clientY);
      setSelectedWire({ wireId, anchor: clampAnchor(anchor) });
    };
    const handleUp = (upEvent: PointerEvent) => {
      cleanup();
      const drag = pending();
      setPending(null);
      if (!drag) return;
      const el = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const hit = el?.closest?.("[data-canvas-node-id], [data-port-kind]");
      const targetId =
        hit?.getAttribute("data-canvas-node-id") ?? hit?.getAttribute("data-node-id");
      if (!targetId) return;

      // Visual drags: any node body or port yields a plain assoc wire.
      if (drag.mode === "visual") {
        const verdict = canConnectManual(drag.sourceId, targetId, state.wires());
        if (!verdict.ok) {
          toast.error(
            verdict.reason === "self"
              ? "A node can't connect to itself."
              : "These nodes are already connected.",
          );
          return;
        }
        const created = state.handleAddWire(drag.sourceId, targetId);
        if (created) selectCreated(created.id, upEvent);
        return;
      }

      // Data drags must land on the complementary named port.
      const fromOut = (drag.sourceDir ?? "out") === "out";
      const needDir = fromOut ? "in" : "out";
      const portKind = hit?.getAttribute("data-port-kind");
      const portDir = hit?.getAttribute("data-port-dir");
      const portId = hit?.getAttribute("data-port-id");
      if (portKind !== "data" || portDir !== needDir || !portId) {
        toast.error(
          fromOut
            ? "Drop on an input port to connect data."
            : "Drop on an output port to connect data.",
        );
        return;
      }
      const src = fromOut
        ? { nodeId: drag.sourceId, portId: drag.sourcePortId ?? "" }
        : { nodeId: targetId, portId };
      const tgt = fromOut
        ? { nodeId: targetId, portId }
        : { nodeId: drag.sourceId, portId: drag.sourcePortId ?? "" };
      const verdict = canConnectData(src, tgt, state.nodes(), state.wires());
      if (!verdict.ok) {
        toast.error(DATA_CONNECT_MESSAGES[verdict.reason]);
        return;
      }
      const created = state.handleAddWire(src.nodeId, tgt.nodeId, {
        kind: "data",
        sourcePort: src.portId,
        targetPort: tgt.portId,
      });
      if (created) selectCreated(created.id, upEvent);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
  };

  const clampAnchor = (anchor: { x: number; y: number }) => {
    const size = viewSize();
    const x = Math.min(Math.max(anchor.x, 140), Math.max(140, size.width - 140));
    let y = anchor.y + 16;
    if (y > size.height - 300) y = Math.max(8, anchor.y - 270);
    return { x, y };
  };

  const handleWireSelect = (wireId: string, anchor: WireAnchor) => {
    if (pending()) return;
    setSelectedWire({
      wireId,
      anchor: clampAnchor(toContainerPoint(anchor.clientX, anchor.clientY)),
    });
  };

  const handleStartDrag = () => {
    if (state.layoutMode() === "auto") {
      state.handleLayoutModeChange("freeform");
    }
  };

  // Sibling pairing: preview "WebTools" button + tools target picker persist via state.
  onMount(() => {
    if (containerRef) {
      const updateSize = () => {
        setContainerSize({
          width: containerRef!.clientWidth,
          height: containerRef!.clientHeight,
        });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(containerRef);
      onCleanup(() => observer.disconnect());
    }

    const onAdd = (e: Event) => {
      const targetId = (e as CustomEvent<{ targetId?: string }>).detail?.targetId;
      state.handleAddWebTools(targetId, viewCenterWorld());
    };
    const onLink = (e: Event) => {
      const d = (e as CustomEvent<{ nodeId?: string; targetId?: string }>).detail;
      if (d?.nodeId && d?.targetId) state.handleLinkWebTools(d.nodeId, d.targetId);
    };
    window.addEventListener("pv:add-web-tools", onAdd);
    window.addEventListener("pv:link-web-tools", onLink);
    onCleanup(() => {
      window.removeEventListener("pv:add-web-tools", onAdd);
      window.removeEventListener("pv:link-web-tools", onLink);
    });

    // Wire editing shortcuts: Esc cancels drag / closes editor / exits
    // node fullscreen (restoring the pre-fullscreen camera).
    // Delete removes the selected connection (not while typing).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pending()) setPending(null);
        else if (selectedWire()) setSelectedWire(null);
        else if (fullscreenId()) exitFullscreen(true);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const sel = selectedWire();
      if (!sel || pending()) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      state.handleDeleteWire(sel.wireId);
      setSelectedWire(null);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const handleAddNode = (type: string, title: string) => {
    const at = viewCenterWorld();
    if (type === "webTools") {
      state.handleAddWebTools(undefined, at);
      return;
    }
    state.handleAddNode(type, title, undefined, at);
  };

  return (
    <div
      ref={containerRef}
      class="relative flex h-full w-full flex-1 overflow-hidden bg-transparent"
    >
      {/* Floating Toolbar Overlay — content-sized, centered, small padding.
          z-40 keeps the Blueprint / Add Node popups above every node
          (nodes raise to z-25 while dragging/resizing). */}
      <div
        data-canvas-toolbar
        class="pointer-events-none absolute left-0 right-0 top-0 z-40 flex justify-center p-2"
      >
        <div class="pointer-events-auto flex min-w-0 max-w-full justify-center">
          <CanvasToolbar
            appScope={state.appScope()}
            layoutMode={state.layoutMode()}
            activeBlueprintId={state.activeBlueprintId()}
            snapEnabled={transform.snapEnabled()}
            zoom={transform.zoom()}
            onLayoutModeChange={state.handleLayoutModeChange}
            onBlueprintChange={(b) => state.applyBlueprint(b)}
            onAddNode={handleAddNode}
            onSnapToggle={() => transform.setSnapEnabled(!transform.snapEnabled())}
            onResetView={() => {
              abandonFullscreen();
              transform.resetView();
            }}
            onFitView={handleFit}
            onPopOut={props.onPopOut}
            isFlyout={props.isFlyout}
            followActive={props.followActive}
            onToggleFollowActive={props.onToggleFollowActive}
          />
        </div>
      </div>

      {/* Surface + minimap share live rendered node sizes via context */}
      <Show when={state.loaded()}>
        <MeasuredSizesProvider>
          <CanvasLiveProvider projectId={props.project().id}>
            <CanvasSurface
              nodes={state.nodes()}
              wires={state.wires()}
              project={props.project}
              isDraggable={true}
              snapEnabled={transform.snapEnabled()}
              zoom={transform.zoom()}
              transformStyle={transform.transformStyle()}
              onMouseDown={handleSurfaceMouseDown}
              onMouseMove={transform.handleMouseMove}
              onMouseUp={transform.handleMouseUp}
              onWheel={handleSurfaceWheel}
              onPositionChange={state.handlePositionChange}
              onResize={state.handleResize}
              onDeleteNode={handleDeleteNode}
              onPinToggle={state.handlePinToggle}
              onStartDrag={handleStartDrag}
              onFocusNode={handleFocusNode}
              focusedId={state.focusedId()}
              fullscreenId={fullscreenId()}
              onToggleFullscreen={handleToggleFullscreen}
              onNodeDataChange={state.handleNodeDataChange}
              onTitleChange={state.handleTitleChange}
              onWireAction={handleWireAction}
              selectedWireId={selectedWire()?.wireId ?? null}
              pending={pending()}
              drag={dragInfo()}
              cursorWorld={cursorWorld()}
              screenToWorld={transform.screenToWorld}
              onCursorWorldChange={setCursorWorld}
              onWireSelect={handleWireSelect}
              onPortPointerDown={handlePortPointerDown}
              onEmptyPointerDown={() => setSelectedWire(null)}
            />

            {/* Pipeline validation results */}
            <CanvasProblemsPanel issues={problems()} onIssueClick={handleIssueClick} />

            {/* Minimap + Center */}
            <div class="pointer-events-none absolute bottom-4 right-4 z-20">
              <CanvasMinimap
                nodes={state.nodes()}
                wires={state.wires()}
                panX={transform.panX()}
                panY={transform.panY()}
                zoom={transform.zoom()}
                containerWidth={viewSize().width}
                containerHeight={viewSize().height}
                onNavigate={handleMinimapNavigate}
                onCenter={handleFit}
              />
            </div>
            {/* Wire editor popover for the selected connection */}
            <Show when={selectedWireDto()}>
              {(wire) => {
                const endpoints = () => {
                  const w = wire();
                  const s = state.nodes().find((n) => n.id === w.sourceId);
                  const t = state.nodes().find((n) => n.id === w.targetId);
                  return {
                    sourcePorts: s ? getNodePorts(s.nodeType) : null,
                    targetPorts: t ? getNodePorts(t.nodeType) : null,
                    taken: state
                      .wires()
                      .filter(
                        (o) =>
                          o.id !== w.id &&
                          o.kind === "data" &&
                          o.targetId === w.targetId &&
                          o.targetPort,
                      )
                      .map((o) => o.targetPort as string),
                  };
                };
                return (
                  <CanvasWireEditor
                    wire={wire()}
                    position={selectedWire()!.anchor}
                    sourcePorts={endpoints().sourcePorts}
                    targetPorts={endpoints().targetPorts}
                    takenTargetPorts={endpoints().taken}
                    onUpdate={(patch) => state.handleUpdateWire(wire().id, patch)}
                    onConvert={(next) => {
                      const ok = state.handleConvertWire(wire().id, next);
                      if (!ok) toast.error("Couldn't convert this connection.");
                      return ok;
                    }}
                    onDelete={() => {
                      state.handleDeleteWire(wire().id);
                      setSelectedWire(null);
                    }}
                    onClose={() => setSelectedWire(null)}
                  />
                );
              }}
            </Show>
          </CanvasLiveProvider>
        </MeasuredSizesProvider>
      </Show>

      {/* Canvas Icons Safelist for Tailwind 4 AST compilation */}
      <CanvasIconSafelist />
    </div>
  );
};
