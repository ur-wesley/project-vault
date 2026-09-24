import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import type { CanvasNodeComponentProps } from "../CanvasNodeContainer";
import type {
  Arrowhead,
  BackgroundStyle,
  ElementStylePatch,
  FontFamily,
  Roundness,
  StrokeStyleKind,
  WhiteboardElement,
  WhiteboardPoint,
  WhiteboardTool,
} from "./types";
import { WHITEBOARD_SCHEMA_VERSION, createElementId } from "./types";
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
import { arrowPath } from "./bindings";
import {
  emptyHistory,
  historyPush,
  historyRedo,
  historyUndo,
  type WhiteboardHistory,
} from "./history";
import { encodeWhiteboardData, parseWhiteboardData } from "./serialize";
import { resolveEndpoints, type ResolvedEndpoints } from "./bindings";
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
  resolveGroupLabelPosition,
  textWrapWidth,
} from "./boundText";
import { measureTextBlock } from "./textMeasure";
import { groupBounds, groupOf, groupSelection, ungroupSelection } from "./groups";
import { defaultFillForStroke, withAutoFill } from "./colors";

type NodeProps = Pick<CanvasNodeComponentProps, "node" | "onDataChange">;

export type DrawableTool =
  | "freehand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text";

function defaultStyleFor(t: WhiteboardTool): ElementStylePatch {
  const base: ElementStylePatch = {
    color: "#e5e5e5",
    strokeWidth: 2,
    background: "transparent",
    fillColor: "#3b82f6",
    strokeStyle: "solid",
    opacity: 100,
    roundness: "round",
  };
  if (t === "arrow") return { ...base, startArrow: "none", endArrow: "arrow" };
  if (t === "line") return { ...base, startArrow: "none", endArrow: "none" };
  if (t === "text")
    return {
      ...base,
      fontSize: 16,
      fontFamily: "normal",
      textAlign: "left",
      bold: false,
      italic: false,
    };
  return base;
}

/** Apply a style patch to one element; ignores fields that don't apply to its kind. */
export function applyStylePatch(
  el: WhiteboardElement,
  patch: ElementStylePatch,
): WhiteboardElement {
  const next: WhiteboardElement = { ...el } as WhiteboardElement;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.strokeWidth !== undefined) next.strokeWidth = patch.strokeWidth;
  if (patch.strokeStyle !== undefined) next.strokeStyle = patch.strokeStyle;
  if (patch.opacity !== undefined) next.opacity = patch.opacity;
  if (patch.roundness !== undefined) next.roundness = patch.roundness;
  if (el.kind === "rectangle" || el.kind === "ellipse" || el.kind === "diamond") {
    if (patch.background !== undefined) (next as typeof el).background = patch.background;
    if (patch.fillColor !== undefined) (next as typeof el).fillColor = patch.fillColor;
  }
  if ((el.kind === "arrow" || el.kind === "line") && next.kind === el.kind) {
    if (patch.startArrow !== undefined)
      (next as Extract<WhiteboardElement, { kind: "arrow" }>).startArrow = patch.startArrow;
    if (patch.endArrow !== undefined)
      (next as Extract<WhiteboardElement, { kind: "arrow" }>).endArrow = patch.endArrow;
  }
  if (el.kind === "text" && next.kind === "text") {
    if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
    if (patch.textAlign !== undefined) next.textAlign = patch.textAlign;
    if (patch.bold !== undefined) next.bold = patch.bold;
    if (patch.italic !== undefined) next.italic = patch.italic;
    // Text fill follows stroke color in Excalidraw-lite.
    if (patch.background !== undefined) next.background = patch.background;
    if (patch.fillColor !== undefined) next.fillColor = patch.fillColor;
  }
  return next;
}

/**
 * True when every selected id resolves to a text bound to an arrow/line.
 * Those labels inherit the connector's styling — only size is settable.
 */
export function isArrowLabelOnly(
  elements: WhiteboardElement[],
  ids: readonly string[],
): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el || el.kind !== "text" || !el.containerId) return false;
    const container = elements.find((e) => e.id === el.containerId);
    return !!container && (container.kind === "arrow" || container.kind === "line");
  });
}

/**
 * Narrow a style patch for an arrow-label-only selection down to the
 * settable fields (font size). Returns the patch unchanged otherwise.
 */
export function scopePatchForSelection(
  elements: WhiteboardElement[],
  ids: readonly string[],
  patch: ElementStylePatch,
): ElementStylePatch {
  if (!isArrowLabelOnly(elements, ids)) return patch;
  if (patch.fontSize === undefined) return {};
  return { fontSize: patch.fontSize };
}

/**
 * Inherit connector styling live: when selected arrows/lines are restyled,
 * their bound labels follow color, opacity, and size. Pure — caller commits.
 */
export function propagateConnectorStyle(
  elements: WhiteboardElement[],
  ids: readonly string[],
  patch: ElementStylePatch,
): WhiteboardElement[] {
  if (patch.color === undefined && patch.opacity === undefined && patch.fontSize === undefined) {
    return elements;
  }
  const selected = new Set(ids);
  const styled = new Map<string, Extract<WhiteboardElement, { kind: "arrow" | "line" }>>();
  for (const el of elements) {
    if (selected.has(el.id) && (el.kind === "arrow" || el.kind === "line")) styled.set(el.id, el);
  }
  if (styled.size === 0) return elements;
  return elements.map((el) => {
    if (el.kind !== "text" || !el.containerId) return el;
    const container = styled.get(el.containerId);
    if (!container) return el;
    const next = { ...el };
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.fontSize !== undefined) {
      next.fontSize = Math.min(96, Math.max(8, Math.round(patch.fontSize)));
    }
    return next;
  });
}

/**
 * Whiteboard board-state domain: elements, per-tool style memory,
 * selection-aware style editing with single-undo live gestures,
 * history with debounced persist, derived geometry memos.
 */
export function useWhiteboardStore(props: NodeProps) {
  const [elements, setElements] = createSignal<WhiteboardElement[]>([]);
  const [draft, setDraft] = createSignal<WhiteboardElement | null>(null);
  const [tool, setToolSignal] = createSignal<WhiteboardTool>("freehand");
  const [color, setColorSignal] = createSignal("#e5e5e5");
  const [strokeWidth, setStrokeWidthSignal] = createSignal(2);
  const [background, setBackgroundSignal] = createSignal<BackgroundStyle>("transparent");
  const [fillColor, setFillColorSignal] = createSignal("#3b82f6");
  const [strokeStyle, setStrokeStyleSignal] = createSignal<StrokeStyleKind>("solid");
  const [opacity, setOpacitySignal] = createSignal(100);
  const [roundness, setRoundnessSignal] = createSignal<Roundness>("round");
  const [fontSize, setFontSizeSignal] = createSignal(16);
  const [fontFamily, setFontFamilySignal] = createSignal<FontFamily>("normal");
  const [textAlign, setTextAlignSignal] = createSignal<"left" | "center" | "right">("left");
  const [bold, setBoldSignal] = createSignal(false);
  const [italic, setItalicSignal] = createSignal(false);
  const [startArrow, setStartArrowSignal] = createSignal<Arrowhead>("none");
  const [endArrow, setEndArrowSignal] = createSignal<Arrowhead>("arrow");
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

  /** Per-tool remembered style (Excalidraw behavior). */
  const [styleByTool, setStyleByTool] = createSignal<Record<string, ElementStylePatch>>({
    freehand: defaultStyleFor("freehand"),
    rectangle: defaultStyleFor("rectangle"),
    ellipse: defaultStyleFor("ellipse"),
    diamond: defaultStyleFor("diamond"),
    arrow: defaultStyleFor("arrow"),
    line: defaultStyleFor("line"),
    text: defaultStyleFor("text"),
  });

  const snapshotGlobals = (): ElementStylePatch => ({
    color: color(),
    strokeWidth: strokeWidth(),
    background: background(),
    fillColor: fillColor(),
    strokeStyle: strokeStyle(),
    opacity: opacity(),
    roundness: roundness(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
    textAlign: textAlign(),
    bold: bold(),
    italic: italic(),
    startArrow: startArrow(),
    endArrow: endArrow(),
  });

  const loadGlobals = (p: ElementStylePatch) => {
    if (p.color !== undefined) setColorSignal(p.color);
    if (p.strokeWidth !== undefined) setStrokeWidthSignal(p.strokeWidth);
    if (p.background !== undefined) setBackgroundSignal(p.background);
    if (p.fillColor !== undefined) setFillColorSignal(p.fillColor);
    if (p.strokeStyle !== undefined) setStrokeStyleSignal(p.strokeStyle);
    if (p.opacity !== undefined) setOpacitySignal(p.opacity);
    if (p.roundness !== undefined) setRoundnessSignal(p.roundness);
    if (p.fontSize !== undefined) setFontSizeSignal(p.fontSize);
    if (p.fontFamily !== undefined) setFontFamilySignal(p.fontFamily);
    if (p.textAlign !== undefined) setTextAlignSignal(p.textAlign);
    if (p.bold !== undefined) setBoldSignal(p.bold);
    if (p.italic !== undefined) setItalicSignal(p.italic);
    if (p.startArrow !== undefined) setStartArrowSignal(p.startArrow);
    if (p.endArrow !== undefined) setEndArrowSignal(p.endArrow);
  };

  const setTool = (t: WhiteboardTool) => {
    const prev = tool();
    if (prev === t) {
      setToolSignal(t);
      return;
    }
    // Remember outgoing tool style.
    setStyleByTool((m) => ({ ...m, [prev]: { ...m[prev], ...snapshotGlobals() } }));
    setToolSignal(t);
    const next = styleByTool()[t];
    if (next) loadGlobals(next);
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
    setDraft(null);
    setSelectedIds([]);
    setHist(emptyHistory());
  });

  const persist = (next: WhiteboardElement[]) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const json = encodeWhiteboardData({ version: WHITEBOARD_SCHEMA_VERSION, elements: next });
      if (json !== props.node.dataJson) {
        lastSavedRaw = json;
        props.onDataChange?.(props.node.id, json);
      }
    }, 500);
  };
  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  /** Commit a new element list: records undo, updates, persists. */
  const commit = (next: WhiteboardElement[]) => {
    setHist((h) => historyPush(h, elements()));
    setElements(next);
    persist(next);
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

  // ---- Selection-aware style editing (single-undo live gestures) ----

  /** True while a continuous style gesture (slider/color drag) is open. */
  let styleGestureOpen = false;

  const selectedElements = (): WhiteboardElement[] => {
    const set = new Set(selectedIds());
    return elements().filter((el) => set.has(el.id));
  };

  /**
   * Merged style of the current selection: a field is present when every
   * selected element that supports it shares the same value, otherwise
   * undefined (mixed — toolbar shows indeterminate).
   */
  const selectionStyle = createMemo((): ElementStylePatch => {
    const sel = selectedElements();
    if (sel.length === 0) return {};
    const first = sel[0];
    const get = (k: keyof ElementStylePatch): unknown =>
      (first as unknown as Record<string, unknown>)[k as string];
    const allSame = (k: keyof ElementStylePatch): boolean =>
      sel.every((el) => (el as unknown as Record<string, unknown>)[k as string] === get(k));
    const out: ElementStylePatch = {};
    (["color", "strokeWidth", "strokeStyle", "opacity", "roundness"] as const).forEach((k) => {
      if (allSame(k)) (out as Record<string, unknown>)[k] = get(k);
    });
    if (sel.every((e) => e.kind === "rectangle" || e.kind === "ellipse" || e.kind === "diamond")) {
      if (allSame("background")) out.background = first.background;
      if (allSame("fillColor")) out.fillColor = first.fillColor;
    }
    if (sel.every((e) => e.kind === "arrow" || e.kind === "line")) {
      if (allSame("startArrow"))
        out.startArrow = (first as Extract<WhiteboardElement, { kind: "arrow" }>).startArrow;
      if (allSame("endArrow"))
        out.endArrow = (first as Extract<WhiteboardElement, { kind: "arrow" }>).endArrow;
    }
    if (sel.every((e) => e.kind === "text")) {
      const t = first as Extract<WhiteboardElement, { kind: "text" }>;
      if (allSame("fontSize")) out.fontSize = t.fontSize;
      if (allSame("fontFamily")) out.fontFamily = t.fontFamily;
      if (allSame("textAlign")) out.textAlign = t.textAlign;
      if (allSame("bold")) out.bold = t.bold;
      if (allSame("italic")) out.italic = t.italic;
    }
    return out;
  });

  /** Active style for the toolbar: selection merge wins, else current tool default. */
  const activeStyle = createMemo((): ElementStylePatch => {
    const sel = selectionStyle();
    if (selectedIds().length > 0) return { ...snapshotGlobals(), ...sel };
    return snapshotGlobals();
  });

  const rememberForTool = (patch: ElementStylePatch) => {
    const t = tool();
    setStyleByTool((m) => ({ ...m, [t]: { ...m[t], ...patch } }));
  };

  /**
   * Auto-follow fills (Excalidraw-like): while a tool's fill is still
   * automatic, changing its stroke color derives a lighter background tint.
   * Picking any fill manually locks that tool to manual mode.
   */
  const [fillAutoByTool, setFillAutoByTool] = createSignal<Record<string, boolean>>({
    freehand: true,
    rectangle: true,
    ellipse: true,
    diamond: true,
    arrow: true,
    line: true,
    text: true,
  });

  const isFillAuto = (): boolean => fillAutoByTool()[tool()] !== false;

  const expandPatch = (patch: ElementStylePatch): ElementStylePatch => {
    const t = tool();
    if (patch.fillColor !== undefined) {
      if (fillAutoByTool()[t] !== false) setFillAutoByTool((m) => ({ ...m, [t]: false }));
      return patch;
    }
    if (patch.color === undefined || fillAutoByTool()[t] === false) return patch;
    return withAutoFill(patch, true);
  };

  /** Re-enable auto fill for the current tool, snapping to the derived tint. */
  const resetFillAuto = () => {
    const t = tool();
    setFillAutoByTool((m) => ({ ...m, [t]: true }));
    const tint = defaultFillForStroke(color());
    commitStyle({ fillColor: tint });
    setFillAutoByTool((m) => ({ ...m, [t]: true }));
  };

  /** Discrete style change (button click): one history entry. Restyles selection if any. */
  const commitStyle = (patch: ElementStylePatch) => {
    const ids = selectedIds();
    const scoped = scopePatchForSelection(elements(), ids, patch);
    const full = expandPatch(scoped);
    loadGlobals(full);
    rememberForTool(full);
    if (ids.length === 0) return;
    const set = new Set(ids);
    setHist((h) => historyPush(h, elements()));
    const next = propagateConnectorStyle(
      elements().map((el) => (set.has(el.id) ? applyStylePatch(el, full) : el)),
      ids,
      full,
    );
    setElements(next);
    persist(next);
  };

  /** Open a continuous gesture (slider/drag): pushes exactly one history entry. */
  const beginStyleGesture = () => {
    if (styleGestureOpen) return;
    if (selectedIds().length > 0) setHist((h) => historyPush(h, elements()));
    styleGestureOpen = true;
  };

  /** Live update inside an open gesture: no new history entries. */
  const liveStyle = (patch: ElementStylePatch) => {
    const ids = selectedIds();
    const scoped = scopePatchForSelection(elements(), ids, patch);
    const full = expandPatch(scoped);
    loadGlobals(full);
    rememberForTool(full);
    if (ids.length === 0) return;
    const set = new Set(ids);
    setElements((els) =>
      propagateConnectorStyle(
        els.map((el) => (set.has(el.id) ? applyStylePatch(el, full) : el)),
        ids,
        full,
      ),
    );
  };

  const endStyleGesture = () => {
    if (!styleGestureOpen) return;
    styleGestureOpen = false;
    if (selectedIds().length > 0) persist(elements());
    else persist(elements());
  };

  // Back-compat wrappers: route legacy setters through the style system so
  // per-tool memory + selection restyle keep working for old callers.
  const setColor = (c: string) => commitStyle({ color: c });
  const setStrokeWidth = (w: number) => commitStyle({ strokeWidth: w });
  const setBackground = (v: BackgroundStyle) => commitStyle({ background: v });
  const setFillColor = (v: string) => commitStyle({ fillColor: v });
  const setStrokeStyle = (v: StrokeStyleKind) => commitStyle({ strokeStyle: v });
  const setOpacity = (v: number) => commitStyle({ opacity: v });
  const setRoundness = (v: Roundness) => commitStyle({ roundness: v });
  const setFontSize = (v: number) => commitStyle({ fontSize: v });
  const setFontFamily = (v: FontFamily) => commitStyle({ fontFamily: v });
  const setTextAlign = (v: "left" | "center" | "right") => commitStyle({ textAlign: v });
  const setBold = (v: boolean) => commitStyle({ bold: v });
  const setItalic = (v: boolean) => commitStyle({ italic: v });
  const setStartArrow = (v: Arrowhead) => commitStyle({ startArrow: v });
  const setEndArrow = (v: Arrowhead) => commitStyle({ endArrow: v });

  // Binding-aware endpoints for arrows/lines (derived every render).
  const resolvedEnds = createMemo(() => {
    const els = elements();
    const map = new Map<string, ResolvedEndpoints>();
    for (const el of els) {
      if (el.kind === "arrow" || el.kind === "line") map.set(el.id, resolveEndpoints(els, el));
    }
    return map;
  });

  // Derived label anchors (bound text + group labels) and arrow-label pills.
  const labelLayout = createMemo(() => {
    const els = elements();
    const anchors = new Map<string, WhiteboardPoint>();
    const pills = new Set<string>();
    const layouts = new Map<
      string,
      { lines: string[]; width: number; height: number; wrap: number | null }
    >();
    const groupCache = new Map<string, BoundingBox | null>();
    for (const el of els) {
      if (el.kind !== "text") continue;
      const wrap = textWrapWidth(els, el);
      const block = measureTextBlock(el.text, el.fontSize, wrap, {
        bold: el.bold,
        fontFamily: el.fontFamily,
      });
      layouts.set(el.id, { ...block, wrap });
      if (el.containerId) {
        anchors.set(el.id, resolveBoundTextPosition(els, el));
        const c = els.find((e) => e.id === el.containerId);
        if (c && (c.kind === "arrow" || c.kind === "line")) pills.add(el.id);
      } else if (el.labelGroupId) {
        let gb = groupCache.get(el.labelGroupId);
        if (gb === undefined) {
          gb = groupBounds(els, el.labelGroupId);
          groupCache.set(el.labelGroupId, gb);
        }
        anchors.set(el.id, resolveGroupLabelPosition(gb, el));
      } else if (el.width != null) {
        // Fixed-width free text still needs its wrapped layout for render.
      }
    }
    return { anchors, pills, layouts };
  });

  /** Selection-aware bounds: painted curve for arrows, anchors for labels. */
  const boundsOf = (el: WhiteboardElement): BoundingBox => {
    if (el.kind === "arrow" || el.kind === "line") {
      return pathBounds(flattenSmoothPath(arrowPath(elements(), el)), el.strokeWidth / 2 + 2);
    }
    if (el.kind === "text" && (el.containerId || el.labelGroupId)) {
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
  const hitAt = (pt: WhiteboardPoint): WhiteboardElement | null => {
    const els = elements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.kind === "arrow" || el.kind === "line") {
        // Painted (flattened smooth) curve — bend points lie exactly on it.
        if (distanceToPolyline(pt, flattenSmoothPath(arrowPath(els, el))) <= hitThreshold(el))
          return el;
      } else if (el.kind === "text" && (el.containerId || el.labelGroupId)) {
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
    const ids = excludeInseparableLabels(elements(), selectedIds());
    if (ids.length === 0) return;
    const dead = cascadeDeleteIds(elements(), new Set(ids));
    setSelectedIds([]);
    commit(elements().filter((el) => !dead.has(el.id)));
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

  /** The single group fully covered by the selection (for group labels). */
  const selectedGroup = (): string | null => {
    const els = elements();
    const sel = selectedIds();
    if (sel.length === 0) return null;
    const first = els.find((el) => el.id === sel[0]);
    const g = first && groupOf(first);
    if (!g) return null;
    return sel.every((id) => els.find((el) => el.id === id && groupOf(el) === g)) ? g : null;
  };

  const canGroup = () =>
    selectedIds().filter((id) => {
      const el = elements().find((e) => e.id === id);
      return el && !groupOf(el);
    }).length >= 2;
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
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    background,
    setBackground,
    fillColor,
    setFillColor,
    strokeStyle,
    setStrokeStyle,
    opacity,
    setOpacity,
    roundness,
    setRoundness,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    textAlign,
    setTextAlign,
    bold,
    setBold,
    italic,
    setItalic,
    startArrow,
    setStartArrow,
    endArrow,
    setEndArrow,
    styleByTool,
    activeStyle,
    selectionStyle,
    commitStyle,
    beginStyleGesture,
    liveStyle,
    endStyleGesture,
    isFillAuto,
    resetFillAuto,
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
    groupSel,
    ungroupSel,
    selectedGroup,
    canGroup,
    canUngroup,
    cursor,
    count,
    selCount,
  };
}

export type WhiteboardStore = ReturnType<typeof useWhiteboardStore>;
