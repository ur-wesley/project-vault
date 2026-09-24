import { createSignal, createEffect, on, onCleanup } from "solid-js";
import { reconcile } from "solid-js/store";
import type { ProjectDto, ViewportDto } from "~/types/dto";
import { getCanvasLayout } from "~/services/tauri/canvas";
import { embeddedTerminalKill } from "~/services/tauri/terminal";
import {
  detectProjectScope,
  getRecommendedBlueprint,
  type AppScope,
  type BlueprintDefinition,
} from "../blueprints";
import { calculateAutoLayout } from "../layout/autoLayout";
import { measuredSnapshot } from "../geometry/measuredSizes";
import { createNodesStore } from "../state/nodesStore";
import { createWiresStore } from "../state/wiresStore";
import { createLayoutSaver, DEFAULT_VIEWPORT } from "../state/persistence";
import { linkedSiblingId, canClaimTarget, collectLinkedDeleteIds } from "../state/linking";
import {
  canConnectManual,
  createManualWireId,
  sanitizeWirePatch,
  type WirePatch,
} from "../state/manualWires";
import { canBindPorts } from "../state/dataflow";
import type { CanvasWireDto } from "~/types/dto";

/**
 * Facade (public shape unchanged): delegates to nodesStore / wiresStore /
 * persistence / linking modules. Internals are modular; callers
 * (CanvasView/CanvasSurface) see the same API as before.
 */
export function useCanvasState(
  project: () => ProjectDto,
  opts?: {
    getViewport?: () => ViewportDto;
    onViewportLoaded?: (viewport: ViewportDto) => void;
  },
) {
  const nodesStore = createNodesStore();
  const wiresStore = createWiresStore();
  const nodes = nodesStore.nodes;
  const wires = wiresStore.wires;
  const [layoutMode, setLayoutMode] = createSignal<"auto" | "freeform">("freeform");
  const [activeBlueprintId, setActiveBlueprintId] = createSignal<string | undefined>();
  const [appScope, setAppScope] = createSignal<AppScope>("fullstack");
  const [loaded, setLoaded] = createSignal(false);
  const [focusedId, setFocusedId] = createSignal<string | null>(null);

  const saver = createLayoutSaver({
    build: () => {
      const p = project();
      if (!p?.id) return null;
      return {
        projectId: p.id,
        blueprintId: activeBlueprintId() ?? null,
        layoutMode: layoutMode(),
        viewport: opts?.getViewport?.() ?? { ...DEFAULT_VIEWPORT },
        nodes: [...nodes()],
        wires: [...wires()],
        updatedAtMs: Date.now(),
        schemaVersion: 2,
      };
    },
  });
  onCleanup(() => saver.dispose());
  const debounceSave = () => saver.schedule();

  // Load project layout on project change
  createEffect(
    on(
      () => project().id,
      async (projectId) => {
        setLoaded(false);
        const scope = detectProjectScope(project());
        setAppScope(scope);

        try {
          const res = await getCanvasLayout(projectId);
          if (res.isOk() && res.value) {
            const layout = res.value;
            nodesStore.replaceAll(layout.nodes);
            wiresStore.replaceAll(layout.wires);
            setLayoutMode((layout.layoutMode as "auto" | "freeform") || "freeform");
            setActiveBlueprintId(layout.blueprintId ?? undefined);
            if (layout.viewport) opts?.onViewportLoaded?.(layout.viewport);
          } else {
            const blueprint = getRecommendedBlueprint(project());
            applyBlueprint(blueprint, false);
          }
        } catch {
          const blueprint = getRecommendedBlueprint(project());
          applyBlueprint(blueprint, false);
        } finally {
          setLoaded(true);
        }
      },
    ),
  );

  const applyBlueprint = (blueprint: BlueprintDefinition, persist: boolean = true) => {
    setActiveBlueprintId(blueprint.id);
    setAppScope(blueprint.scope);
    nodesStore.replaceAll([...blueprint.defaultNodes]);
    wiresStore.replaceAll([...blueprint.defaultWires]);
    if (persist) debounceSave();
  };

  const handleLayoutModeChange = (mode: "auto" | "freeform") => {
    setLayoutMode(mode);
    if (mode === "auto") {
      // Stack by rendered boxes (snapshot) so auto-height nodes use
      // their measured height instead of stale DTO defaults.
      nodesStore.replaceAll(calculateAutoLayout([...nodes()], measuredSnapshot));
    }
    debounceSave();
  };

  const handlePositionChange = (id: string, x: number, y: number) => {
    nodesStore.upsertPosition(id, x, y);
    debounceSave();
  };

  const handleResize = (id: string, width: number, height: number) => {
    nodesStore.upsertSize(id, width, height);
    debounceSave();
  };

  /**
   * Transient sizing without persistence — for fullscreen fill, so the
   * temporary canvas-sized dimensions are never written to the saved layout.
   * Exiting fullscreen restores via handleResize (which does persist).
   */
  const previewSize = (id: string, width: number, height: number) => {
    nodesStore.upsertSize(id, width, height);
  };

  const saveViewport = (_viewport: ViewportDto) => {
    debounceSave();
  };

  const handleAddNode = (
    type: string,
    title: string,
    dataJson?: string,
    at?: { x: number; y: number },
  ) => {
    const node = nodesStore.addNode(type, title, dataJson, at);
    debounceSave();
    return node;
  };

  /** Create a webTools sibling explicitly linked to a webPreview node + wire. */
  const handleAddWebTools = (targetId?: string, at?: { x: number; y: number }) => {
    const all = nodes();
    const target = targetId ?? all.find((n) => n.nodeType === "webPreview")?.id ?? "";
    if (target) {
      const existingId = linkedSiblingId(all, target);
      if (existingId) {
        const existing = all.find((n) => n.id === existingId);
        if (existing) return existing;
      }
    }
    const tools = nodesStore.addNode(
      "webTools",
      target ? "WebTools (linked)" : "Web DevTools",
      target ? JSON.stringify({ targetId: target }) : undefined,
      at,
    );
    const anchor = nodesStore.find(target);
    if (anchor) {
      nodesStore.moveNode(tools.id, anchor.x + (anchor.width || 440) + 32, anchor.y);
    }
    if (target) {
      wiresStore.addWire({
        id: `wire-${Date.now()}`,
        sourceId: target,
        targetId: tools.id,
        wireType: "stream",
        status: "nominal",
        annotation: "Live preview telemetry",
      });
    }
    debounceSave();
    return tools;
  };

  const handleLinkWebTools = (nodeId: string, targetId: string): boolean => {
    if (!canClaimTarget(nodes(), nodeId, targetId)) return false;
    nodesStore.upsertData(nodeId, JSON.stringify({ targetId }));
    if (!wiresStore.hasWire(targetId, nodeId)) {
      wiresStore.addWire({
        id: `wire-${Date.now()}`,
        sourceId: targetId,
        targetId: nodeId,
        wireType: "stream",
        status: "nominal",
        annotation: "Live preview telemetry",
      });
    }
    debounceSave();
    return true;
  };

  /** User-created wire via drag-to-connect. Null when rejected (self/dupe). */
  const handleAddWire = (
    sourceId: string,
    targetId: string,
    opts?: {
      kind?: CanvasWireDto["kind"];
      sourcePort?: string | null;
      targetPort?: string | null;
    },
  ): CanvasWireDto | null => {
    const verdict = canConnectManual(sourceId, targetId, wires());
    if (!verdict.ok) return null;
    const kind = opts?.kind === "data" ? "data" : "assoc";
    if (kind === "data" && (!opts?.sourcePort || !opts?.targetPort)) return null;
    const wire: CanvasWireDto = {
      id: createManualWireId(),
      sourceId,
      targetId,
      wireType: "sync",
      status: "nominal",
      annotation: null,
      ruleId: "manual",
      kind,
      sourcePort: kind === "data" ? (opts?.sourcePort ?? null) : null,
      targetPort: kind === "data" ? (opts?.targetPort ?? null) : null,
    };
    wiresStore.addWire(wire);
    debounceSave();
    return wire;
  };

  /**
   * Visual <-> dataflow conversion from the wire editor. Data requires a
   * valid live port binding; visual clears the binding.
   */
  const handleConvertWire = (
    id: string,
    next: { kind: "assoc" | "data"; sourcePort?: string | null; targetPort?: string | null },
  ): boolean => {
    const wire = wiresStore.findWire(id);
    if (!wire) return false;
    if (next.kind === "data") {
      const s = nodesStore.find(wire.sourceId);
      const t = nodesStore.find(wire.targetId);
      if (!s || !t) return false;
      if (!canBindPorts(s.nodeType, next.sourcePort, t.nodeType, next.targetPort)) return false;
      // Don't steal another wire's input (ignore self when already bound).
      const taken = wires().some(
        (w) =>
          w.id !== id &&
          w.kind === "data" &&
          w.targetId === wire.targetId &&
          w.targetPort === next.targetPort,
      );
      if (taken) return false;
      wiresStore.updateWire(id, {
        kind: "data",
        sourcePort: next.sourcePort ?? null,
        targetPort: next.targetPort ?? null,
      });
    } else {
      wiresStore.updateWire(id, { kind: "assoc", sourcePort: null, targetPort: null });
    }
    debounceSave();
    return true;
  };

  const handleUpdateWire = (id: string, patch: Partial<WirePatch>): boolean => {
    const clean = sanitizeWirePatch(patch);
    if (Object.keys(clean).length === 0) return false;
    if (!wiresStore.findWire(id)) return false;
    wiresStore.updateWire(id, clean);
    debounceSave();
    return true;
  };

  const handleDeleteWire = (id: string): boolean => {
    if (!wiresStore.findWire(id)) return false;
    wiresStore.removeWire(id);
    debounceSave();
    return true;
  };

  const handleNodeDataChange = (id: string, dataJson: string | null) => {
    nodesStore.upsertData(id, dataJson);
    debounceSave();
  };

  const handleTitleChange = (id: string, title: string) => {
    nodesStore.rename(id, title);
    debounceSave();
  };

  const handleDeleteNode = (id: string) => {
    if (focusedId() === id) setFocusedId(null);
    const target = nodesStore.find(id);
    if (target?.nodeType === "terminal" && target.dataJson) {
      try {
        const parsed = JSON.parse(target.dataJson) as { sessionId?: unknown };
        if (parsed && typeof parsed.sessionId === "string") {
          void embeddedTerminalKill(parsed.sessionId);
        }
      } catch {
        // ignore malformed dataJson
      }
    }
    const doomed = new Set([id, ...collectLinkedDeleteIds(nodes(), new Set([id]))]);
    nodesStore.removeMany(doomed);
    wiresStore.removeTouching(doomed);
    debounceSave();
  };

  const handlePinToggle = (id: string) => {
    nodesStore.togglePin(id);
    debounceSave();
  };

  const handleFocusNode = (id: string) => {
    if (focusedId() !== id) setFocusedId(id);
  };

  return {
    nodes,
    wires,
    layoutMode,
    activeBlueprintId,
    appScope,
    loaded,
    applyBlueprint,
    handleLayoutModeChange,
    handlePositionChange,
    handleResize,
    previewSize,
    handleAddNode,
    handleAddWebTools,
    handleLinkWebTools,
    handleAddWire,
    handleUpdateWire,
    handleDeleteWire,
    handleConvertWire,
    handleNodeDataChange,
    handleTitleChange,
    handleDeleteNode,
    handlePinToggle,
    handleFocusNode,
    focusedId,
    saveViewport,
  };
}

// Re-export reconcile-adjacent helper for tests that patch stores directly.
export { reconcile };
