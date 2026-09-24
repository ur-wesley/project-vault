import { createEffect, onCleanup } from "solid-js";

import type { ElementBinding, WhiteboardElement, WhiteboardPoint, WhiteboardTool } from "./types";
import { DEFAULT_BIND_GAP, baseElement, createElementId } from "./types";
import type { ElementStylePatch } from "./types";
import {
  BIND_DISTANCE,
  createBinding,
  findBindAnchor,
  findBindHover,
  pushOutByGap,
} from "./bindings";
import {
  boxesOverlap,
  boxHandles,
  decimatePoints,
  dragBoxHandle,
  hitTestBoxHandles,
  hitTestHandle,
  moveElement,
  normalizeBox,
  resizeElement,
  type BoundingBox,
  type ResizeHandleId,
} from "./geometry";
import { historyPush } from "./history";
import { groupMembers, scaleElementsToUnion } from "./groups";
import { cascadeDeleteIds, excludeInseparableLabels, redirectLabelHit } from "./boundText";
import { renderBoard } from "./render";
import type { WhiteboardStore } from "./useWhiteboardStore";

/**
 * Pointer-interaction domain: canvas sizing/redraw loop, gesture
 * state machine (draw/move/resize/marquee/erase), hit helpers.
 * (Extracted verbatim from WhiteboardNode.)
 */
export function useWhiteboardPointer(opts: {
  store: WhiteboardStore;
  nodeId: string;
  onFocusNode?: (id: string) => void;
  onTextTool: (
    pt: WhiteboardPoint,
    width?: number | null,
    containerId?: string | null,
    textId?: string | null,
  ) => void;
}) {
  const { store, nodeId, onFocusNode, onTextTool } = opts;
  const {
    elements,
    setElements,
    draft,
    setDraft,
    tool,
    setTool,
    activeStyle,
    selectedIds,
    setSelectedIds,
    setHist,
    marquee,
    setMarquee,
    bindHighlight,
    setBindHighlight,
    bindAnchor,
    setBindAnchor,
    persist,
    commit,
    resolvedEnds,
    labelLayout,
    boundsOf,
    selectionUnion,
    hitAt,
    panX,
    panY,
    zoom,
    setPanX,
    setPanY,
    setIsPanning,
    spacePan,
    screenToWorld,
    worldToScreen,
    zoomAt,
  } = store;

  let canvasRef: HTMLCanvasElement | undefined;
  let wrapRef: HTMLDivElement | undefined;

  // Canvas sizing + redraw.
  let warnedZeroArea = false;
  const redraw = () => {
    const canvas = canvasRef;
    const wrap = wrapRef;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Zero-area board: pointer coords would collapse and nothing can paint.
      // Warn once as a diagnostic breadcrumb (layout/CSS issue upstream).
      if (!warnedZeroArea) {
        warnedZeroArea = true;
        console.warn("[whiteboard] board has zero area — check node sizing", {
          width: rect.width,
          height: rect.height,
        });
      }
      return;
    }
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // World-space transform: content pans/zooms like the outer canvas.
    // UI chrome (handles/selection) counter-scales via opts.zoom.
    const z = zoom();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * panX(), dpr * panY());
    const ids = selectedIds();
    const layout = labelLayout();
    const boundsOverride = new Map<string, BoundingBox>();
    if (ids.length === 1) {
      const sel = elements().find((e) => e.id === ids[0]);
      if (sel) boundsOverride.set(sel.id, boundsOf(sel));
    }
    const union = ids.length > 1 ? selectionUnion() : null;
    const single = ids.length === 1 ? elements().find((e) => e.id === ids[0]) : undefined;
    renderBoard(ctx, elements(), draft(), ids, {
      selectedIds: ids,
      resolvedEnds: resolvedEnds(),
      textAnchors: layout.anchors,
      pillIds: layout.pills,
      textLayouts: layout.layouts,
      marquee: marquee(),
      bindHighlightId: bindHighlight(),
      bindAnchor: bindAnchor(),
      unionBox: union,
      unionHandles: union ? boxHandles(union) : undefined,
      boundsOverride,
      noHandles: single?.kind === "text" && !!(single.containerId || single.labelGroupId),
      zoom: z,
    });
  };

  createEffect(() => {
    elements();
    draft();
    selectedIds();
    marquee();
    bindHighlight();
    bindAnchor();
    labelLayout();
    panX();
    panY();
    zoom();
    redraw();
  });

  createEffect(() => {
    const wrap = wrapRef;
    if (!wrap) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
  });

  const toLocal = (e: PointerEvent | MouseEvent): WhiteboardPoint => {
    const rect = canvasRef!.getBoundingClientRect();
    return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  /** Screen-space (CSS px, relative to the board) point for pan gestures. */
  const toScreenPt = (e: PointerEvent | MouseEvent): WhiteboardPoint => {
    const rect = canvasRef!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const revertToSelect = (select: string[]) => {
    setTool("select");
    setSelectedIds(select);
  };

  // In-progress gesture state (not reactive — only draft/elements signals render).
  let gesture:
    | {
        kind: "draw";
        tool: WhiteboardTool;
        start: WhiteboardPoint;
        startBinding: ElementBinding | null;
      }
    | {
        kind: "move";
        ids: string[];
        orig: Map<string, WhiteboardElement>;
        start: WhiteboardPoint;
        moved: boolean;
      }
    | {
        kind: "resize";
        id: string;
        handleId: ResizeHandleId;
        orig: WhiteboardElement;
        moved: boolean;
        origResolved?: { start: WhiteboardPoint; end: WhiteboardPoint };
      }
    | {
        kind: "resize-union";
        ids: string[];
        handleId: ResizeHandleId;
        from: BoundingBox;
        origElements: WhiteboardElement[];
        moved: boolean;
      }
    | { kind: "marquee"; origin: WhiteboardPoint; additive: boolean }
    | { kind: "text"; origin: WhiteboardPoint; containerId: string | null; textId: string | null }
    | { kind: "pan"; startScreen: WhiteboardPoint; startPan: WhiteboardPoint }
    | { kind: "erase"; dirty: boolean }
    | null = null;

  /** Move with bound/group-label text support (drag edits the offset). */
  const applyMove = (el: WhiteboardElement, dx: number, dy: number): WhiteboardElement => {
    if (el.kind === "text" && (el.containerId || el.labelGroupId)) {
      return { ...el, offset: { x: el.offset.x + dx, y: el.offset.y + dy } };
    }
    return moveElement(el, dx, dy);
  };

  const eraseAt = (pt: WhiteboardPoint): boolean => {
    const els = elements();
    const hit = redirectLabelHit(els, hitAt(pt));
    if (!hit) return false;
    const dead = cascadeDeleteIds(els, new Set([hit.id]));
    if (gesture?.kind !== "erase") {
      gesture = { kind: "erase", dirty: false };
      setHist((h) => historyPush(h, els));
    }
    if (gesture?.kind === "erase") gesture.dirty = true;
    setElements(els.filter((el) => !dead.has(el.id)));
    setSelectedIds(selectedIds().filter((id) => !dead.has(id)));
    return true;
  };

  const handlePointerDown = (e: PointerEvent) => {
    e.stopPropagation();
    onFocusNode?.(nodeId);
    if (!canvasRef) return;
    // Canvas-like navigation: middle-drag always pans; Space+left-drag pans.
    if (e.button === 1 || (e.button === 0 && spacePan())) {
      e.preventDefault();
      gesture = {
        kind: "pan",
        startScreen: toScreenPt(e),
        startPan: { x: panX(), y: panY() },
      };
      setIsPanning(true);
      canvasRef.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const pt = toLocal(e);
    const t = tool();
    canvasRef.setPointerCapture(e.pointerId);

    if (t === "text") {
      const hit = store.hitAt(pt);
      // Shapes and connectors open their bound label; an existing text
      // opens directly. Only empty space starts a free text.
      const containerId =
        hit &&
        (hit.kind === "rectangle" ||
          hit.kind === "ellipse" ||
          hit.kind === "diamond" ||
          hit.kind === "arrow" ||
          hit.kind === "line")
          ? hit.id
          : null;
      const textId = hit && hit.kind === "text" ? hit.id : null;
      gesture = { kind: "text", origin: pt, containerId, textId };
      // Preview fixed-width drags with the marquee box.
      setMarquee(normalizeBox(pt, pt));
      return;
    }
    if (t === "eraser") {
      if (eraseAt(pt)) persist(elements());
      return;
    }
    if (t === "select") {
      const els = elements();
      const ids = selectedIds();
      // Fixed screen-space grab radius, converted to world units.
      const grabR = 9 / zoom();
      // 1. Resize handles first.
      if (ids.length === 1) {
        const sel = els.find((el) => el.id === ids[0]);
        const resizable = sel && !(sel.kind === "text" && (sel.containerId || sel.labelGroupId));
        if (sel && resizable) {
          const h = hitTestHandle(sel, pt, undefined, resolvedEnds().get(sel.id), grabR);
          if (h) {
            const origResolved =
              sel.kind === "arrow" || sel.kind === "line"
                ? (resolvedEnds().get(sel.id) ?? { start: sel.start, end: sel.end })
                : undefined;
            gesture = {
              kind: "resize",
              id: sel.id,
              handleId: h.id,
              orig: sel,
              moved: false,
              origResolved,
            };
            return;
          }
        }
      } else if (ids.length > 1) {
        const u = selectionUnion();
        if (u) {
          const h = hitTestBoxHandles(u, pt, grabR);
          if (h) {
            gesture = {
              kind: "resize-union",
              ids: [...ids],
              handleId: h.id,
              from: u,
              origElements: els,
              moved: false,
            };
            return;
          }
        }
      }
      // 2. Pick (group-aware unless drilling with Ctrl/Cmd).
      // Arrow labels redirect to their connector: one selectable unit.
      const hit = redirectLabelHit(els, hitAt(pt));
      if (hit) {
        const drill = e.ctrlKey || e.metaKey;
        const targets = drill ? [hit.id] : groupMembers(els, hit.id);
        let nextSel: string[];
        if (e.shiftKey) {
          const set = new Set(ids);
          if (targets.every((id) => set.has(id))) {
            targets.forEach((id) => set.delete(id));
          } else {
            targets.forEach((id) => set.add(id));
          }
          nextSel = els.filter((el) => set.has(el.id)).map((el) => el.id);
        } else if (!drill && ids.includes(hit.id)) {
          nextSel = ids;
        } else {
          nextSel = targets;
        }
        setSelectedIds(nextSel);
        gesture = {
          kind: "move",
          ids: nextSel,
          orig: new Map(els.filter((el) => nextSel.includes(el.id)).map((el) => [el.id, el])),
          start: pt,
          moved: false,
        };
        return;
      }
      // 3. Marquee on empty space.
      gesture = { kind: "marquee", origin: pt, additive: e.shiftKey };
      setMarquee(normalizeBox(pt, pt));
      return;
    }
    // Draw tools: begin a draft element.
    const bindR = BIND_DISTANCE / zoom();
    const startBinding =
      t === "arrow" || t === "line"
        ? (() => {
            const a = findBindAnchor(elements(), pt, bindR);
            return a ? createBinding(a.element, pt, DEFAULT_BIND_GAP) : null;
          })()
        : null;
    gesture = { kind: "draw", tool: t, start: pt, startBinding };
    const style: ElementStylePatch = activeStyle();
    const base = baseElement(
      createElementId(),
      style.color ?? "#e5e5e5",
      style.strokeWidth ?? 2,
      style,
    );
    if (t === "freehand") {
      setDraft({ ...base, kind: "freehand", points: [pt] });
    } else if (t === "arrow" || t === "line") {
      setDraft({
        ...base,
        kind: t,
        start: pt,
        end: pt,
        startBinding,
        endBinding: null,
        startArrow: style.startArrow ?? (t === "arrow" ? "arrow" : "none"),
        endArrow: style.endArrow ?? (t === "arrow" ? "arrow" : "none"),
        waypoints: [],
      });
    } else {
      setDraft({ ...base, kind: t, start: pt, end: pt } as WhiteboardElement);
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!gesture || !canvasRef) return;
    if (gesture.kind === "pan") {
      const g = gesture;
      const s = toScreenPt(e);
      setPanX(g.startPan.x + (s.x - g.startScreen.x));
      setPanY(g.startPan.y + (s.y - g.startScreen.y));
      return;
    }
    const pt = toLocal(e);
    if (gesture.kind === "draw") {
      const d = draft();
      if (!d) return;
      if (d.kind === "freehand") {
        setDraft({ ...d, points: [...d.points, pt] });
      } else if (
        d.kind === "rectangle" ||
        d.kind === "ellipse" ||
        d.kind === "diamond" ||
        d.kind === "arrow" ||
        d.kind === "line"
      ) {
        setDraft({ ...d, end: pt });
        if (d.kind === "arrow" || d.kind === "line") {
          const hover = findBindHover(elements(), pt, undefined, BIND_DISTANCE / zoom());
          setBindHighlight(hover?.element.id ?? null);
          setBindAnchor(hover?.point ?? null);
        }
      }
    } else if (gesture.kind === "move") {
      const g = gesture;
      const dx = pt.x - g.start.x;
      const dy = pt.y - g.start.y;
      if (dx === 0 && dy === 0) return;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      // Recompute from pre-drag snapshots so there is no drift.
      setElements((els) =>
        els.map((el) => (g.ids.includes(el.id) ? applyMove(g.orig.get(el.id) ?? el, dx, dy) : el)),
      );
    } else if (gesture.kind === "resize") {
      const g = gesture;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      setElements((els) =>
        els.map((el) =>
          el.id === g.id ? resizeElement(g.orig, g.handleId, pt, g.origResolved) : el,
        ),
      );
      // Live magnetic preview while dragging an arrow/line endpoint.
      const target = elements().find((el) => el.id === g.id);
      if (
        target &&
        (target.kind === "arrow" || target.kind === "line") &&
        (g.handleId === "start" || g.handleId === "end")
      ) {
        const hover = findBindHover(elements(), pt, new Set([target.id]), BIND_DISTANCE / zoom());
        setBindHighlight(hover?.element.id ?? null);
        setBindAnchor(hover?.point ?? null);
      }
    } else if (gesture.kind === "resize-union") {
      const g = gesture;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      const to = dragBoxHandle(g.from, g.handleId, pt);
      setElements(scaleElementsToUnion(g.origElements, new Set(g.ids), g.from, to));
    } else if (gesture.kind === "marquee") {
      setMarquee(normalizeBox(gesture.origin, pt));
    } else if (gesture.kind === "text") {
      setMarquee(normalizeBox(gesture.origin, pt));
    } else if (gesture.kind === "erase") {
      if (e.buttons > 0 && eraseAt(pt)) persist(elements());
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!gesture) return;
    if (gesture.kind === "pan") {
      gesture = null;
      setIsPanning(false);
      return;
    }
    // Minimum world-space sizes so clicks feel identical at any zoom.
    const clickTol = 4 / zoom();
    if (gesture.kind === "text") {
      const g = gesture;
      gesture = null;
      setMarquee(null);
      const pt = toLocal(e);
      const w = Math.abs(pt.x - g.origin.x);
      const h = Math.abs(pt.y - g.origin.y);
      if (Math.max(w, h) < clickTol || g.containerId || g.textId) {
        // Click, or a press that started on a container/text: open the
        // bound/existing label instead of dropping a free text.
        onTextTool(g.origin, null, g.containerId, g.textId);
      } else {
        // Drag: fixed-width free text at the drag box top-left.
        const box = normalizeBox(g.origin, pt);
        onTextTool(
          { x: box.minX, y: box.minY },
          Math.max(40, Math.round(box.maxX - box.minX)),
          null,
        );
      }
      return;
    }
    if (gesture.kind === "draw") {
      const d = draft();
      setDraft(null);
      setBindHighlight(null);
      setBindAnchor(null);
      if (d) {
        if (d.kind === "freehand") {
          const finalEl = { ...d, points: decimatePoints(d.points) };
          if (finalEl.points.length > 0) {
            commit([...elements(), finalEl]);
            revertToSelect([finalEl.id]);
          }
        } else if (d.kind === "arrow" || d.kind === "line") {
          const size = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
          if (size >= clickTol) {
            const pt = toLocal(e);
            const snap = findBindAnchor(elements(), pt, BIND_DISTANCE / zoom());
            const finalEl = {
              ...d,
              endBinding: snap ? createBinding(snap.element, pt, DEFAULT_BIND_GAP) : null,
            };
            commit([...elements(), finalEl]);
            revertToSelect([finalEl.id]);
          }
        } else if (d.kind === "rectangle" || d.kind === "ellipse" || d.kind === "diamond") {
          const size = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
          if (size >= clickTol) {
            commit([...elements(), d]);
            revertToSelect([d.id]);
          }
        }
        // Text drafts never exist (text commits via the overlay) — ignored.
      }
    } else if (
      gesture.kind === "move" ||
      gesture.kind === "resize" ||
      gesture.kind === "resize-union"
    ) {
      if (gesture.kind === "resize") {
        // Endpoint rebind: dropping an arrow/line handle on a shape sticks it
        // (side+focus anchor); dropping on empty space leaves it detached.
        const g = gesture;
        if ((g.handleId === "start" || g.handleId === "end") && g.moved) {
          const target = elements().find((el) => el.id === g.id);
          if (target && (target.kind === "arrow" || target.kind === "line")) {
            const pt = toLocal(e);
            const snap = findBindAnchor(
              elements(),
              pt,
              BIND_DISTANCE / zoom(),
              new Set([target.id]),
            );
            if (snap) {
              const binding = createBinding(snap.element, pt, DEFAULT_BIND_GAP);
              const snapped = pushOutByGap(snap.point, snap.side, DEFAULT_BIND_GAP);
              setElements((els) =>
                els.map((el) => {
                  if (el.id !== target.id || (el.kind !== "arrow" && el.kind !== "line")) return el;
                  return g.handleId === "start"
                    ? { ...el, start: snapped, startBinding: binding }
                    : { ...el, end: snapped, endBinding: binding };
                }),
              );
            }
          }
        }
        setBindHighlight(null);
        setBindAnchor(null);
      }
      persist(elements());
    } else if (gesture.kind === "marquee") {
      const m = marquee();
      setMarquee(null);
      if (m) {
        const els = elements();
        const hitIds = excludeInseparableLabels(
          els,
          els.filter((el) => boxesOverlap(boundsOf(el), m)).map((el) => el.id),
        );
        if (gesture.additive) {
          const set = new Set([...selectedIds(), ...hitIds]);
          setSelectedIds(els.filter((el) => set.has(el.id)).map((el) => el.id));
        } else {
          setSelectedIds(hitIds);
        }
      }
    } else if (gesture.kind === "erase") {
      if (gesture.dirty) persist(elements());
    }
    gesture = null;
  };

  /** Cancel the in-progress gesture (pointer-cancel + Escape). */
  const cancelGesture = () => {
    gesture = null;
    setDraft(null);
    setMarquee(null);
    setBindHighlight(null);
    setBindAnchor(null);
    setIsPanning(false);
  };

  /** Wheel zoom centered on the cursor (mirrors the outer canvas). */
  const handleWheel = (e: WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!wrapRef) return;
    const rect = wrapRef.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0);
  };

  return {
    setCanvasRef: (el: HTMLCanvasElement | undefined) => {
      canvasRef = el;
    },
    setWrapRef: (el: HTMLDivElement | undefined) => {
      wrapRef = el;
    },
    hasCanvas: () => canvasRef !== undefined,
    toLocal,
    worldToScreen,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    cancelGesture,
    redraw,
  };
}

export type WhiteboardPointer = ReturnType<typeof useWhiteboardPointer>;
