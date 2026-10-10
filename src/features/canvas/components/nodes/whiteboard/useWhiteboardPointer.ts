import { createEffect, onCleanup } from "solid-js";

import type { ExcalidrawElement } from "./excalidrawTypes";
import type { WhiteboardPoint } from "./types";
import {
  boxesOverlap,
  isConnector,
  isShapeElement,
  isTextElement,
  normalizeBox,
  type BoundingBox,
} from "./geometry";
import {
  boxHandles,
  dragBoxHandle,
  snapAngle,
} from "./geometryEdit";
import { historyPush } from "./history";
import { scaleElementsToUnion } from "./groups";
import { cascadeDeleteIds, excludeInseparableLabels, redirectLabelHit, syncBoundTextOrigins } from "./boundText";
import { renderBoard } from "./render";
import { shiftElement } from "./elementOps";
import { beginDraw, finishDraw, isDrawableTool, pressBinding, updateDraw } from "./pointerDraw";
import {
  endpointHover,
  pickSelectGesture,
  rebindEndpoint,
  resizeWithModifiers,
  type PointerGesture,
} from "./pointerTransform";
import type { WhiteboardStore } from "./useWhiteboardStore";

/**
 * Pointer-interaction domain: canvas sizing/redraw loop, gesture
 * state machine (draw/move/resize/marquee/erase), hit helpers.
 * Draw math lives in `./pointerDraw`, transforms in `./pointerTransform`.
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
      noHandles: !!single && single.type === "text" && !!single.containerId,
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
  // Constructed by pickSelectGesture (select) and the draw/text/pan/erase
  // branches below; updated by the move/resize/marquee handlers.
  let gesture: PointerGesture = null;

  /** Live element write that keeps bound-label origins glued to their anchors. */
  const setLiveMap = (fn: (els: ExcalidrawElement[]) => ExcalidrawElement[]) =>
    setElements((els) => syncBoundTextOrigins(fn(els)));

  /** Move with bound-label support (a label drag moves its container). */
  const applyMove = (el: ExcalidrawElement, dx: number, dy: number): ExcalidrawElement =>
    shiftElement(el, dx, dy);

  const eraseAt = (pt: WhiteboardPoint): boolean => {
    const els = elements();
    const hit = redirectLabelHit(els, hitAt(pt));
    // Locked elements never erase (unlock first — Excalidraw parity).
    if (!hit || hit.locked) return false;
    const dead = cascadeDeleteIds(els, new Set([hit.id]));
    if (gesture?.kind !== "erase") {
      gesture = { kind: "erase", dirty: false };
      setHist((h) => historyPush(h, els));
    }
    if (gesture?.kind === "erase") gesture.dirty = true;
    setLiveMap((live) => live.filter((el) => !dead.has(el.id)));
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
      const containerId = hit && (isShapeElement(hit) || isConnector(hit)) ? hit.id : null;
      const textId = hit && isTextElement(hit) ? hit.id : null;
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
      gesture = pickSelectGesture(
        {
          elements,
          selectedIds,
          setSelectedIds,
          zoom,
          boundsOf,
          resolvedEnds,
          selectionUnion,
          hitAt,
          setMarquee,
          commit,
        },
        pt,
        e,
      );
      return;
    }
    // Draw tools: begin a draft element (Shift = square, Alt = centered).
    if (!isDrawableTool(t)) return;
    const startBinding = pressBinding(t, elements(), pt, zoom());
    gesture = { kind: "draw", tool: t, start: pt, startBinding };
    setDraft(beginDraw(t, pt, activeStyle(), startBinding));
  };

  const updateDrawGesture = (pt: WhiteboardPoint, e: PointerEvent) => {
    if (gesture?.kind !== "draw") return;
    const d = draft();
    if (!d) return;
    const out = updateDraw(d, gesture.start, pt, e, elements(), zoom());
    if (!out) return;
    setDraft(out.draft);
    setBindHighlight(out.highlight);
    setBindAnchor(out.anchor);
  };

  const updateTransformGesture = (pt: WhiteboardPoint, e: PointerEvent) => {
    if (gesture?.kind === "move") {
      const g = gesture;
      const dx = pt.x - g.start.x;
      const dy = pt.y - g.start.y;
      if (dx === 0 && dy === 0) return;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      // Recompute from pre-drag snapshots so there is no drift.
      setLiveMap((els) =>
        els.map((el) => (g.ids.includes(el.id) ? applyMove(g.orig.get(el.id) ?? el, dx, dy) : el)),
      );
      return;
    }
    if (gesture?.kind === "resize") {
      const g = gesture;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      setLiveMap((els) =>
        els.map((el) =>
          el.id === g.id ? resizeWithModifiers(g.orig, g.handleId, pt, e, g.origResolved) : el,
        ),
      );
      // Live magnetic preview while dragging an arrow/line endpoint.
      const target = elements().find((el) => el.id === g.id);
      if (target && isConnector(target) && (g.handleId === "start" || g.handleId === "end")) {
        const hover = endpointHover(elements(), target.id, pt, zoom());
        setBindHighlight(hover.highlight);
        setBindAnchor(hover.anchor);
      }
      return;
    }
    if (gesture?.kind === "resize-union") {
      const g = gesture;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      const to = dragBoxHandle(g.from, g.handleId, pt);
      setLiveMap(() => scaleElementsToUnion(g.origElements, new Set(g.ids), g.from, to));
      return;
    }
    if (gesture?.kind === "rotate") {
      const g = gesture;
      if (!g.moved) {
        setHist((h) => historyPush(h, elements()));
        g.moved = true;
      }
      // Angle drag around the selection center; Shift snaps to 15° steps.
      const raw = g.origAngle + (Math.atan2(pt.y - g.center.y, pt.x - g.center.x) - g.startAngle);
      const angle = e.shiftKey ? snapAngle(raw) : raw;
      setLiveMap((els) => els.map((el) => (el.id === g.id ? { ...el, angle } : el)));
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
      updateDrawGesture(pt, e);
    } else if (
      gesture.kind === "move" ||
      gesture.kind === "resize" ||
      gesture.kind === "resize-union" ||
      gesture.kind === "rotate"
    ) {
      updateTransformGesture(pt, e);
    } else if (gesture.kind === "marquee") {
      setMarquee(normalizeBox(gesture.origin, pt));
    } else if (gesture.kind === "text") {
      setMarquee(normalizeBox(gesture.origin, pt));
    } else if (gesture.kind === "erase") {
      if (e.buttons > 0 && eraseAt(pt)) persist(elements());
    }
  };

  const finishTextGesture = (e: PointerEvent) => {
    if (gesture?.kind !== "text") return;
    const g = gesture;
    gesture = null;
    setMarquee(null);
    const pt = toLocal(e);
    // Minimum world-space size so clicks feel identical at any zoom.
    const clickTol = 4 / zoom();
    const w = Math.abs(pt.x - g.origin.x);
    const h = Math.abs(pt.y - g.origin.y);
    if (Math.max(w, h) < clickTol || g.containerId || g.textId) {
      // Click, or a press that started on a container/text: open the
      // bound/existing label instead of dropping a free text.
      onTextTool(g.origin, null, g.containerId, g.textId);
    } else {
      // Drag: fixed-width free text at the drag box top-left.
      const box = normalizeBox(g.origin, pt);
      onTextTool({ x: box.minX, y: box.minY }, Math.max(40, Math.round(box.maxX - box.minX)), null);
    }
  };

  const finishDrawGesture = (e: PointerEvent) => {
    if (gesture?.kind !== "draw") return;
    const g = gesture;
    const d = draft();
    setDraft(null);
    setBindHighlight(null);
    setBindAnchor(null);
    if (!d) return;
    const done = finishDraw(d, toLocal(e), elements(), zoom(), g.startBinding);
    if (done) {
      commit([...elements(), done]);
      revertToSelect([done.id]);
    }
  };

  const finishTransformGesture = (e: PointerEvent) => {
    if (
      gesture?.kind !== "move" &&
      gesture?.kind !== "resize" &&
      gesture?.kind !== "resize-union" &&
      gesture?.kind !== "rotate"
    ) {
      return;
    }
    if (gesture.kind === "resize" && gesture.moved) {
      // Endpoint rebind: dropping an arrow/line handle on a shape sticks it
      // (side+focus anchor); dropping on empty space leaves it detached.
      const rebound = rebindEndpoint(elements(), gesture.id, gesture.handleId, toLocal(e), zoom());
      if (rebound) setLiveMap(() => rebound);
      setBindHighlight(null);
      setBindAnchor(null);
    }
    persist(elements());
  };

  const finishMarqueeGesture = () => {
    if (gesture?.kind !== "marquee") return;
    const additive = gesture.additive;
    const m = marquee();
    setMarquee(null);
    if (m) {
      const els = elements();
      const hitIds = excludeInseparableLabels(
        els,
        els.filter((el) => boxesOverlap(boundsOf(el), m)).map((el) => el.id),
      );
      if (additive) {
        const set = new Set([...selectedIds(), ...hitIds]);
        setSelectedIds(els.filter((el) => set.has(el.id)).map((el) => el.id));
      } else {
        setSelectedIds(hitIds);
      }
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (!gesture) return;
    if (gesture.kind === "pan") {
      gesture = null;
      setIsPanning(false);
      return;
    }
    if (gesture.kind === "text") {
      finishTextGesture(e);
    } else if (gesture.kind === "draw") {
      finishDrawGesture(e);
    } else if (
      gesture.kind === "move" ||
      gesture.kind === "resize" ||
      gesture.kind === "resize-union" ||
      gesture.kind === "rotate"
    ) {
      finishTransformGesture(e);
    } else if (gesture.kind === "marquee") {
      finishMarqueeGesture();
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
