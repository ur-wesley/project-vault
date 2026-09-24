import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  useContext,
  type Component,
  type JSX,
} from "solid-js";
import { DndDragOverlay } from "./DndDragOverlay";
import { getDisplacements, getOverIndex } from "./sortable-strategy";
import type { DragPoint, ReorderEvent, SortableOrientation, SortableSlot } from "./types";

export interface DndItemSnapshot {
  isActive: boolean;
  isOver: boolean;
  dx: number;
  dy: number;
}

interface DndApi {
  register: (id: string, el: HTMLElement) => void;
  unregister: (id: string) => void;
  snapshot: (id: string) => DndItemSnapshot;
  /** Pointer-follow delta for the active item when no overlay is used. */
  follow: (id: string) => DndItemSnapshot;
  hasOverlay: () => boolean;
  begin: (id: string, e: PointerEvent) => void;
}

const DndContext = createContext<DndApi>();

/** Access the sortable coordination API. Must be used inside `DndSortableRoot`. */
export function useDndSortable(): DndApi {
  const api = useContext(DndContext);
  if (!api) throw new Error("Dnd components must be used inside DndSortableRoot");
  return api;
}

type DndSortableRootProps = Readonly<{
  /** Current item order (mirrors SortableProvider ergonomics; rects are measured from the DOM). */
  ids: string[];
  orientation?: SortableOrientation;
  /** Pointer travel in px before a press becomes a drag (clicks still work). */
  activationDistance?: number;
  onReorder: (e: ReorderEvent) => void;
  /** Ghost rendered in the drag overlay. Omit for the source item to follow the pointer. */
  overlay?: (activeId: string) => JSX.Element;
  /**
   * CSS selector for elements that must never arm a drag (e.g. a close
   * button inside a sortable item). Matched against the pointerdown target.
   */
  ignoreSelector?: string;
  children: JSX.Element;
}>;

const DEFAULT_TRANSITION = CSS.Transition.toString({
  property: "transform",
  duration: 200,
  easing: "ease",
});

export const DndSortableRoot: Component<DndSortableRootProps> = (props) => {
  const orientation = () => props.orientation ?? "horizontal";
  const activationDistance = () => props.activationDistance ?? 6;

  const nodes = new Map<string, HTMLElement>();
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [overId, setOverId] = createSignal<string | null>(null);
  const [dragPoint, setDragPoint] = createSignal<DragPoint>({ x: 0, y: 0 });
  const [displacements, setDisplacements] = createSignal<Map<string, number>>(new Map());
  const [announcement, setAnnouncement] = createSignal("");

  let slots: SortableSlot[] = [];
  let fromIndex = -1;
  let gap = 0;
  let grabOffset: DragPoint = { x: 0, y: 0 };
  let dragOrigin: DragPoint = { x: 0, y: 0 };
  let overlayWidth: number | undefined;
  let pending: { id: string; startX: number; startY: number } | null = null;
  let suppressClickUntil = 0;
  // Pointer capture target so pointerup fires even when released off-window.
  // Without this a missed pointerup wedges `activeId` and kills later drags.
  let captureTarget: Element | null = null;
  let activePointerId: number | null = null;
  // True once the pointer actually travelled: only real drags commit drops
  // and swallow the follow-up click. Plain presses reset silently.
  let moved = false;

  const axisValue = (p: DragPoint) => (orientation() === "vertical" ? p.y : p.x);

  const measure = () => {
    const horizontal = orientation() !== "vertical";
    const next: SortableSlot[] = [];
    for (const [id, el] of nodes) {
      const r = el.getBoundingClientRect();
      next.push(
        horizontal ? { id, start: r.left, end: r.right } : { id, start: r.top, end: r.bottom },
      );
    }
    next.sort((a, b) => a.start - b.start);
    slots = next;
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < next.length; i++) {
      minGap = Math.min(minGap, next[i]!.start - next[i - 1]!.end);
    }
    gap = Number.isFinite(minGap) ? Math.max(0, minGap) : 0;
  };

  const setBodySelect = (value: string | null) => {
    if (typeof document === "undefined") return;
    if (value == null) document.body.style.removeProperty("user-select");
    else document.body.style.setProperty("user-select", value);
  };

  const reset = () => {
    pending = null;
    slots = [];
    fromIndex = -1;
    moved = false;
    const pointerId = activePointerId;
    activePointerId = null;
    if (captureTarget != null) {
      captureTarget.removeEventListener("lostpointercapture", onLostPointerCapture);
      if (pointerId != null) {
        try {
          captureTarget.releasePointerCapture(pointerId);
        } catch {
          // Already released or never captured — harmless.
        }
      }
      captureTarget = null;
    }
    setActiveId(null);
    setOverId(null);
    // Keep the same Map reference when already empty so item memos are
    // not invalidated (and their nodes recreated) without an actual drag.
    setDisplacements((prev) => (prev.size === 0 ? prev : new Map()));
    setBodySelect(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onBlur);
  };

  const activate = (id: string, point: DragPoint) => {
    measure();
    fromIndex = slots.findIndex((s) => s.id === id);
    if (fromIndex < 0) {
      reset();
      return;
    }
    const el = nodes.get(id);
    if (el) {
      const r = el.getBoundingClientRect();
      grabOffset = { x: point.x - r.left, y: point.y - r.top };
      dragOrigin = { x: r.left, y: r.top };
      overlayWidth = orientation() === "vertical" ? undefined : r.width;
    }
    setActiveId(id);
    setOverId(id);
    setDragPoint(point);
    setBodySelect("none");
    setAnnouncement(
      orientation() === "vertical"
        ? `Picked up sortable item ${fromIndex + 1} of ${slots.length}. Drag up and down to move, Escape to cancel.`
        : `Picked up sortable item ${fromIndex + 1} of ${slots.length}. Drag left and right to move, Escape to cancel.`,
    );
    window.addEventListener("keydown", onKeyDown);
    // Resolve the drop target for the activation point itself (same as the
    // board engine): a single-move drag must already see the item under it.
    update(point);
  };

  const update = (point: DragPoint) => {
    setDragPoint(point);
    const overIndex = getOverIndex(slots, axisValue(point));
    const over = overIndex >= 0 ? slots[overIndex]!.id : null;
    setOverId(over);
    setDisplacements(getDisplacements(slots, fromIndex, overIndex, gap));
  };

  const commit = () => {
    const active = activeId();
    const over = overId();
    const didMove = moved;
    window.removeEventListener("keydown", onKeyDown);
    try {
      if (active != null && over != null && active !== over && didMove) {
        const toIndex = slots.findIndex((s) => s.id === over);
        setAnnouncement(`Moved to position ${toIndex + 1} of ${slots.length}.`);
        props.onReorder({ activeId: active, overId: over });
        // Swallow only the click that the browser fires after a real drag.
        suppressClickUntil = Date.now() + 150;
      } else {
        setAnnouncement("Drag cancelled. Item returned to its original position.");
      }
    } finally {
      reset();
    }
  };

  const cancel = () => {
    window.removeEventListener("keydown", onKeyDown);
    setAnnouncement("Drag cancelled. Item returned to its original position.");
    reset();
  };

  const samePointer = (e: PointerEvent) =>
    activePointerId == null || e.pointerId === activePointerId;

  const onPointerMove = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    const point = { x: e.clientX, y: e.clientY };
    if (activeId() != null) {
      moved = true;
      update(point);
      return;
    }
    if (pending != null) {
      const dist = Math.hypot(point.x - pending.startX, point.y - pending.startY);
      if (dist >= activationDistance()) {
        const id = pending.id;
        pending = null;
        moved = true;
        activate(id, point);
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    if (activeId() != null) commit();
    else reset();
  };

  const onPointerCancel = () => cancel();

  const onBlur = () => {
    // Releasing outside the window fires no pointerup: cancel instead of
    // wedging `activeId` and killing every later drag.
    if (activeId() != null || pending != null) cancel();
  };

  const onLostPointerCapture = () => {
    if (activeId() != null) cancel();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // Swallow the click that the browser fires after a real drag.
  const onClickCapture = (e: MouseEvent) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
      suppressClickUntil = 0;
    }
  };

  const begin = (id: string, e: PointerEvent) => {
    if (e.button !== 0 || (e.pointerType !== "mouse" && e.pointerType !== "pen")) return;
    // Defensive recovery: a previous gesture must never wedge the engine.
    if (activeId() != null || pending != null) cancel();
    const selector = props.ignoreSelector;
    if (selector != null && e.target instanceof Element && e.target.closest(selector) != null) {
      return;
    }
    activePointerId = e.pointerId;
    if (e.target instanceof Element && typeof e.target.setPointerCapture === "function") {
      try {
        e.target.setPointerCapture(e.pointerId);
        captureTarget = e.target;
        e.target.addEventListener("lostpointercapture", onLostPointerCapture);
      } catch {
        captureTarget = null;
      }
    }
    pending = { id, startX: e.clientX, startY: e.clientY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
  };

  const snapshot = (id: string): DndItemSnapshot => {
    const active = activeId() === id;
    const delta = displacements().get(id) ?? 0;
    const horizontal = orientation() !== "vertical";
    return {
      isActive: active,
      isOver: !active && overId() === id && activeId() != null,
      dx: horizontal ? delta : 0,
      dy: horizontal ? 0 : delta,
    };
  };

  const api: DndApi = {
    register: (id, el) => {
      nodes.set(id, el);
    },
    unregister: (id) => {
      nodes.delete(id);
    },
    snapshot,
    follow: (id) => {
      if (activeId() !== id) return { isActive: false, isOver: false, dx: 0, dy: 0 };
      const t = followTransform();
      return { isActive: true, isOver: false, dx: t.x, dy: t.y };
    },
    hasOverlay: () => props.overlay != null,
    begin,
  };

  onCleanup(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("click", onClickCapture, true);
    setBodySelect(null);
  });

  // Swallow the click the browser fires right after a real drag.
  window.addEventListener("click", onClickCapture, true);

  const overlayPoint = () => {
    const p = dragPoint();
    return { x: p.x - grabOffset.x, y: p.y - grabOffset.y };
  };

  const followTransform = () => {
    const p = dragPoint();
    return { x: p.x - grabOffset.x - dragOrigin.x, y: p.y - grabOffset.y - dragOrigin.y };
  };

  // Lazily built so the ghost tracks the active tab without recreating
  // the whole strip when drag state changes.
  const overlayContent = createMemo(() => {
    const id = activeId();
    const overlay = props.overlay;
    if (id == null || overlay == null) return null;
    return overlay(id);
  });

  return (
    <DndContext.Provider value={api}>
      {props.children}
      <Show when={overlayContent() != null}>
        {/* No transition while dragging: easing the ghost on every pointermove
            makes it chase the cursor and feel laggy. */}
        <DndDragOverlay getPoint={overlayPoint} width={overlayWidth}>
          {overlayContent()}
        </DndDragOverlay>
      </Show>
      <div role="status" aria-live="polite" class="sr-only">
        {announcement()}
      </div>
    </DndContext.Provider>
  );
};

export { DEFAULT_TRANSITION };
