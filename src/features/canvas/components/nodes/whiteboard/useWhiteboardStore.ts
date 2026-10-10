import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import type { CanvasNodeComponentProps } from "../CanvasNodeContainer";
import type { ExcalidrawElement, ExcalidrawFiles } from "./excalidrawTypes";
import type { WhiteboardPoint, WhiteboardTool } from "./types";
import { createElementId } from "./excalidrawDefaults";
import {
  distanceToPolyline,
  flattenSmoothPath,
  getElementBounds,
  hitTestElement,
  hitThreshold,
  pathBounds,
  unionBounds,
  type BoundingBox,
} from "./geometry";
import { arrowPath, resolveEndpoints, type ResolvedEndpoints } from "./bindings";
import {
  emptyHistory,
  historyPush,
  historyRedo,
  historyUndo,
  type WhiteboardHistory,
} from "./history";
import { encodeWhiteboardData, parseWhiteboardData } from "./serialize";
import {
  WB_MAX_ZOOM,
  WB_MIN_ZOOM,
  WB_ZOOM_FACTOR,
  clampZoom,
  screenToWorld as screenToWorldPure,
  worldToScreen as worldToScreenPure,
  zoomAtScreen,
} from "./viewport";
import {
  cascadeDeleteIds,
  excludeInseparableLabels,
  getTextBounds,
  resolveBoundTextPosition,
  syncBoundTextOrigins,
  textWrapWidth,
} from "./boundText";
import { isTextElement } from "./geometry";
import { measureTextBlock } from "./textMeasure";
import { groupOf, groupSelection, ungroupSelection } from "./groups";
import {
  duplicateElements,
  nudgeElements,
  reorderElements,
  setElementsLink,
  setElementsLocked,
  type ZOrder,
} from "./elementOps";
import { useWhiteboardInterop } from "./useWhiteboardInterop";
import { useWhiteboardStyle } from "./useWhiteboardStyle";

type NodeProps = Pick<CanvasNodeComponentProps, "node" | "onDataChange">;

/**
 * Whiteboard board-state domain: native Excalidraw v2 elements, per-tool
 * style memory, selection-aware style editing with single-undo live
 * gestures, history with debounced persist, derived geometry memos.
 */
export function useWhiteboardStore(props: NodeProps) {
  const [elements, setElements] = createSignal<ExcalidrawElement[]>([]);
  const [draft, setDraft] = createSignal<ExcalidrawElement | null>(null);
  const [tool, setToolSignal] = createSignal<WhiteboardTool>("freehand");
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [hist, setHist] = createSignal<WhiteboardHistory>(emptyHistory());
  const [marquee, setMarquee] = createSignal<BoundingBox | null>(null);
  const [bindHighlight, setBindHighlight] = createSignal<string | null>(null);
  const [bindAnchor, setBindAnchor] = createSignal<WhiteboardPoint | null>(null);

  // ---- Viewport (canvas-like navigation, session-local, not persisted) ----
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [isPanning, setIsPanning] = createSignal(false);
  const [spacePan, setSpacePan] = createSignal(false);

  // ---- Canvas appearance (Excalidraw `appState`, persisted in the scene) ----
  const [viewBackgroundColor, setViewBackgroundColor] = createSignal("transparent");
  const [gridSize, setGridSize] = createSignal<number | null>(null);
  const toggleGrid = () => setGridSize((g) => (g === null ? 20 : null));

  // ---- Image files (session-local: too large for the dataJson blob) ----
  const [sceneFiles, setSceneFiles] = createSignal<ExcalidrawFiles>({});

  const screenToWorld = (sx: number, sy: number): WhiteboardPoint =>
    screenToWorldPure(sx, sy, panX(), panY(), zoom());

  const worldToScreen = (wx: number, wy: number): WhiteboardPoint =>
    worldToScreenPure(wx, wy, panX(), panY(), zoom());

  const zoomAt = (screenX: number, screenY: number, zoomIn: boolean) => {
    const step = zoomAtScreen(panX(), panY(), zoom(), screenX, screenY, zoomIn);
    setPanX(step.panX);
    setPanY(step.panY);
    setZoom(step.zoom);
  };

  const zoomIn = () => setZoom((z) => clampZoom(z * WB_ZOOM_FACTOR));
  const zoomOut = () => setZoom((z) => clampZoom(z / WB_ZOOM_FACTOR));

  const resetView = () => {
    setPanX(0);
    setPanY(0);
    setZoom(1);
  };

  /** Frame all elements in a container of the given CSS size. */
  const fitView = (containerWidth: number, containerHeight: number) => {
    const els = elements();
    if (els.length === 0 || containerWidth <= 0 || containerHeight <= 0) {
      resetView();
      return;
    }
    const box = unionBounds(els.map(boundsOf));
    if (!box) {
      resetView();
      return;
    }
    const padding = 40;
    const boundingWidth = box.maxX - box.minX + padding * 2;
    const boundingHeight = box.maxY - box.minY + padding * 2;
    if (boundingWidth <= 0 || boundingHeight <= 0) {
      resetView();
      return;
    }
    const targetZoom = Math.min(
      Math.max(
        Math.min(containerWidth / boundingWidth, containerHeight / boundingHeight),
        WB_MIN_ZOOM,
      ),
      WB_MAX_ZOOM,
    );
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;
    setZoom(targetZoom);
    setPanX(containerWidth / 2 - centerX * targetZoom);
    setPanY(containerHeight / 2 - centerY * targetZoom);
  };

  const setTool = (t: WhiteboardTool) => {
    const prev = tool();
    if (prev === t) {
      setToolSignal(t);
      return;
    }
    // Remember outgoing tool style, restore the incoming one.
    style.onToolSwitch(prev, t);
    setToolSignal(t);
  };

  /** Raw payload of our last persist — lets the sync effect ignore its own echo. */
  let lastSavedRaw: string | null | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // Sync from the store (layout switches, other windows). Ignores our own echo.
  createEffect(() => {
    const raw = props.node.dataJson;
    if (raw === lastSavedRaw) return;
    const parsed = parseWhiteboardData(raw);
    setElements(parsed.elements);
    setViewBackgroundColor(parsed.appState.viewBackgroundColor);
    setGridSize(parsed.appState.gridSize);
    setDraft(null);
    setSelectedIds([]);
    setHist(emptyHistory());
  });

  const currentScene = (next: ExcalidrawElement[]) => ({
    type: "excalidraw" as const,
    version: 2 as const,
    source: "project-vault",
    elements: next,
    appState: { viewBackgroundColor: viewBackgroundColor(), gridSize: gridSize() },
    files: {},
  });

  const persist = (next: ExcalidrawElement[]) => {
    if (saveTimer) clearTimeout(saveTimer);
    // Normalize bound-label origins so the persisted scene paints == exports.
    const synced = syncBoundTextOrigins(next);
    if (synced !== next) setElements(synced);
    saveTimer = setTimeout(() => {
      const json = encodeWhiteboardData(currentScene(synced));
      if (json !== props.node.dataJson) {
        lastSavedRaw = json;
        props.onDataChange?.(props.node.id, json);
      }
    }, 500);
  };
  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  /** Commit a new element list: records undo, normalizes, updates, persists. */
  const commit = (next: ExcalidrawElement[]) => {
    const synced = syncBoundTextOrigins(next);
    setHist((h) => historyPush(h, elements()));
    setElements(synced);
    persist(synced);
  };

  const undo = () => {
    const { history, elements: prev } = historyUndo(hist(), elements());
    setHist(history);
    setElements(prev);
    setSelectedIds([]);
    persist(prev);
  };

  const redo = () => {
    const { history, elements: next } = historyRedo(hist(), elements());
    setHist(history);
    setElements(next);
    setSelectedIds([]);
    persist(next);
  };

  // File + clipboard interop (split module — see useWhiteboardInterop).
  const interop = useWhiteboardInterop({
    elements,
    commit,
    setSelectedIds,
    viewBackgroundColor,
    setViewBackgroundColor,
    gridSize,
    setGridSize,
    sceneFiles,
    setSceneFiles,
  });

  // Style state (signals, per-tool memory, gestures) lives in the split
  // module — see useWhiteboardStyle. Created after persist/commit so the
  // hook can push history and persist through store primitives.
  const style = useWhiteboardStyle({
    tool,
    elements,
    selectedIds,
    pushHistory: () => setHist((h) => historyPush(h, elements())),
    setElements,
    persist,
  });

  // Binding-aware endpoints for arrows/lines (derived every render).
  const resolvedEnds = createMemo(() => {
    const els = elements();
    const map = new Map<string, ResolvedEndpoints>();
    for (const el of els) {
      if (el.type === "arrow" || el.type === "line") map.set(el.id, resolveEndpoints(els, el));
    }
    return map;
  });

  // Derived label anchors (bound text) and arrow-label pills.
  const labelLayout = createMemo(() => {
    const els = elements();
    const anchors = new Map<string, WhiteboardPoint>();
    const pills = new Set<string>();
    const layouts = new Map<
      string,
      { lines: string[]; width: number; height: number; wrap: number | null }
    >();
    for (const el of els) {
      if (!isTextElement(el)) continue;
      const wrap = textWrapWidth(els, el);
      const block = measureTextBlock(el.text, el.fontSize, wrap, {
        fontFamily: el.fontFamily,
      });
      layouts.set(el.id, { ...block, wrap });
      if (el.containerId) {
        anchors.set(el.id, resolveBoundTextPosition(els, el));
        const c = els.find((e) => e.id === el.containerId);
        if (c && (c.type === "arrow" || c.type === "line")) pills.add(el.id);
      }
    }
    return { anchors, pills, layouts };
  });

  /** Selection-aware bounds: painted curve for arrows, anchors for labels. */
  const boundsOf = (el: ExcalidrawElement): BoundingBox => {
    if (el.type === "arrow" || el.type === "line") {
      return pathBounds(flattenSmoothPath(arrowPath(elements(), el)), el.strokeWidth / 2 + 2);
    }
    if (isTextElement(el) && el.containerId) {
      return getTextBounds(elements(), el);
    }
    return getElementBounds(el);
  };

  const selectionUnion = createMemo(() => {
    const els = elements();
    const set = new Set(selectedIds());
    return unionBounds(els.filter((el) => set.has(el.id)).map(boundsOf));
  });

  /** Topmost element under the point, using resolved geometry. */
  const hitAt = (pt: WhiteboardPoint): ExcalidrawElement | null => {
    const els = elements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.type === "arrow" || el.type === "line") {
        // Painted (flattened smooth) curve — bend points lie exactly on it.
        if (distanceToPolyline(pt, flattenSmoothPath(arrowPath(els, el))) <= hitThreshold(el))
          return el;
      } else if (isTextElement(el) && el.containerId) {
        const b = getTextBounds(els, el);
        if (pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) return el;
      } else if (hitTestElement(el, pt)) {
        return el;
      }
    }
    return null;
  };

  const deleteSelected = () => {
    // Inseparable arrow labels are never removed alone (only with the arrow).
    // Locked elements never delete (unlock first — Excalidraw parity).
    const ids = excludeInseparableLabels(elements(), selectedIds()).filter((id) => {
      const el = elements().find((e) => e.id === id);
      return el && !el.locked;
    });
    if (ids.length === 0) return;
    const dead = cascadeDeleteIds(elements(), new Set(ids));
    setSelectedIds([]);
    commit(elements().filter((el) => !dead.has(el.id)));
  };

  /** Duplicate the selection with fresh ids (+20/+20 offset), selecting the clones. */
  const duplicateSelected = (dx = 20, dy = 20) => {
    const ids = elements()
      .filter((el) => selectedIds().includes(el.id) && !el.locked)
      .map((el) => el.id);
    if (ids.length === 0) return;
    const { elements: next, newIds } = duplicateElements(elements(), ids, dx, dy);
    commit(next);
    setSelectedIds(newIds);
  };

  const reorderSelected = (dir: ZOrder) => {
    const next = reorderElements(elements(), selectedIds(), dir);
    if (next === elements()) return;
    commit(next);
  };
  const bringForward = () => reorderSelected("forward");
  const sendBackward = () => reorderSelected("backward");
  const bringToFront = () => reorderSelected("front");
  const sendToBack = () => reorderSelected("back");

  /**
   * Toggle lock on the selection: locks everything unless everything is
   * already locked (then unlocks). Locked elements select but never
   * move/resize/nudge/delete/duplicate.
   */
  const toggleLock = () => {
    const ids = selectedIds();
    if (ids.length === 0) return;
    const els = elements();
    const allLocked = ids.every((id) => els.find((e) => e.id === id)?.locked);
    commit(setElementsLocked(els, ids, !allLocked));
  };

  /** Attach (or with null, clear) a hyperlink on the selection. */
  const setLink = (link: string | null) => {
    const ids = selectedIds();
    if (ids.length === 0) return;
    commit(setElementsLink(elements(), ids, link));
  };

  /** Arrow-key nudge (1px, 10px with Shift — wired in WhiteboardNode). */
  const nudgeSelected = (dx: number, dy: number) => {
    const ids = selectedIds();
    if (ids.length === 0) return;
    const next = nudgeElements(elements(), ids, dx, dy);
    if (next === elements()) return;
    commit(next);
  };

  const groupSel = () => {
    const { elements: next, groupId } = groupSelection(
      elements(),
      selectedIds(),
      createElementId(),
    );
    if (!groupId) return;
    commit(next);
    setSelectedIds(next.filter((el) => groupOf(el) === groupId).map((el) => el.id));
  };

  const ungroupSel = () => {
    const next = ungroupSelection(elements(), selectedIds());
    if (next === elements()) return;
    commit(next);
  };

  /** Grouping needs 2+ targets; already-grouped elements nest (no single-level cap). */
  const canGroup = () => selectedIds().length >= 2;
  const canUngroup = () =>
    selectedIds().some((id) => {
      const el = elements().find((e) => e.id === id);
      return el && groupOf(el);
    });

  const cursor = () => {
    if (isPanning() || spacePan()) return "cursor-grabbing";
    switch (tool()) {
      case "select":
        return "cursor-default";
      case "eraser":
        return "cursor-cell";
      case "text":
        return "cursor-text";
      default:
        return "cursor-crosshair";
    }
  };

  const count = () => elements().length;
  const selCount = () => selectedIds().length;

  return {
    elements,
    setElements,
    draft,
    setDraft,
    tool,
    setTool,
    ...style,
    selectedIds,
    setSelectedIds,
    hist,
    setHist,
    marquee,
    setMarquee,
    bindHighlight,
    setBindHighlight,
    bindAnchor,
    setBindAnchor,
    panX,
    setPanX,
    panY,
    setPanY,
    zoom,
    setZoom,
    isPanning,
    setIsPanning,
    spacePan,
    setSpacePan,
    screenToWorld,
    worldToScreen,
    zoomAt,
    zoomIn,
    zoomOut,
    resetView,
    fitView,
    persist,
    commit,
    undo,
    redo,
    resolvedEnds,
    labelLayout,
    boundsOf,
    selectionUnion,
    hitAt,
    deleteSelected,
    duplicateSelected,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    toggleLock,
    setLink,
    nudgeSelected,
    viewBackgroundColor,
    setViewBackgroundColor,
    gridSize,
    setGridSize,
    toggleGrid,
    sceneFiles,
    setSceneFiles,
    interopFiles: interop.interopFiles,
    interopNotice: interop.interopNotice,
    setInteropNotice: interop.setInteropNotice,
    nativeScene: interop.nativeScene,
    importText: interop.importText,
    groupSel,
    ungroupSel,
    canGroup,
    canUngroup,
    cursor,
    count,
    selCount,
  };
}

export type WhiteboardStore = ReturnType<typeof useWhiteboardStore>;
