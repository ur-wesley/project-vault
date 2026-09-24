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
import {
  getBoardDropTarget,
  getColumnDisplacements,
  type BoardCardRect,
  type BoardColumnRect,
  type BoardDropTarget,
} from "./drop-target";
import type { BoardDropEvent, DragPoint } from "./types";

export interface DndBoardCardSnapshot {
  isActive: boolean;
  dx: number;
  dy: number;
}

interface DndBoardApi {
  registerColumn: (id: string, el: HTMLElement) => void;
  unregisterColumn: (id: string) => void;
  registerCard: (columnId: string, id: string, el: HTMLElement) => void;
  unregisterCard: (id: string) => void;
  snapshotCard: (id: string) => DndBoardCardSnapshot;
  columnOver: (columnId: string) => boolean;
  dropIndex: (columnId: string) => number | null;
  hasOverlay: () => boolean;
  begin: (columnId: string, id: string, e: PointerEvent) => void;
}

const DndBoardContext = createContext<DndBoardApi>();

/** Access the board coordination API. Must be used inside `DndBoardRoot`. */
export function useDndBoard(): DndBoardApi {
  const api = useContext(DndBoardContext);
  if (!api) throw new Error("Dnd board components must be used inside DndBoardRoot");
  return api;
}

type DndBoardRootProps = Readonly<{
  /** Pointer travel in px before a press becomes a drag (clicks still work). */
  activationDistance?: number;
  onDrop: (e: BoardDropEvent) => void;
  /** Ghost rendered in the drag overlay. Omit for the source card to follow the pointer. */
  overlay?: (active: { id: string; columnId: string }) => JSX.Element;
  /**
   * CSS selector for elements that must never arm a drag (e.g. buttons and
   * inputs inside a card). Matched against the pointerdown target.
   */
  ignoreSelector?: string;
  children: JSX.Element;
}>;

const DEFAULT_TRANSITION = CSS.Transition.toString({
  property: "transform",
  duration: 200,
  easing: "ease",
});

export const DndBoardRoot: Component<DndBoardRootProps> = (props) => {
  const activationDistance = () => props.activationDistance ?? 6;

  const colNodes = new Map<string, HTMLElement>();
  const cardNodes = new Map<string, { columnId: string; el: HTMLElement }>();

  const [active, setActive] = createSignal<{ columnId: string; id: string } | null>(null);
  const [target, setTarget] = createSignal<BoardDropTarget | null>(null);
  const [displacements, setDisplacements] = createSignal<Map<string, number>>(new Map());
  const [dragPoint, setDragPoint] = createSignal<DragPoint>({ x: 0, y: 0 });
  const [announcement, setAnnouncement] = createSignal("");

  let colRects: BoardColumnRect[] = [];
  let cardRects: BoardCardRect[] = [];
  let cardOrder: Map<string, string[]> = new Map();
  let fromIndex = -1;
  let extent = 0;
  let grabOffset: DragPoint = { x: 0, y: 0 };
  let overlayWidth: number | undefined;
  let lastPoint: DragPoint = { x: 0, y: 0 };
  let pending: { columnId: string; id: string; startX: number; startY: number } | null = null;
  let suppressClickUntil = 0;
  // Pointer capture target so pointerup fires even when released off-window.
  // Without this a missed pointerup wedges `active` and kills every later drag.
  let captureTarget: Element | null = null;
  let activePointerId: number | null = null;
  // True once the pointer actually travelled: only real drags commit drops
  // and swallow the follow-up click. Plain presses reset silently.
  let moved = false;

  const measure = () => {
    const cols: BoardColumnRect[] = [];
    for (const [id, el] of colNodes) {
      const r = el.getBoundingClientRect();
      cols.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    const cards: BoardCardRect[] = [];
    const order = new Map<string, string[]>();
    for (const [id, entry] of cardNodes) {
      const r = entry.el.getBoundingClientRect();
      cards.push({ id, columnId: entry.columnId, top: r.top, bottom: r.bottom });
      const arr = order.get(entry.columnId) ?? [];
      arr.push(id);
      order.set(entry.columnId, arr);
    }
    for (const [col, ids] of order) {
      const byTop = new Map(cards.filter((c) => c.columnId === col).map((c) => [c.id, c.top]));
      ids.sort((a, b) => (byTop.get(a) ?? 0) - (byTop.get(b) ?? 0));
    }
    colRects = cols;
    cardRects = cards;
    cardOrder = order;
  };

  const setBodySelect = (value: string | null) => {
    if (typeof document === "undefined") return;
    if (value == null) document.body.style.removeProperty("user-select");
    else document.body.style.setProperty("user-select", value);
  };

  const reset = () => {
    pending = null;
    lastDisplacementKey = "";
    colRects = [];
    cardRects = [];
    cardOrder = new Map();
    fromIndex = -1;
    extent = 0;
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
    setActive(null);
    setTarget(null);
    setDisplacements((prev) => (prev.size === 0 ? prev : new Map()));
    setBodySelect(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("scroll", onScroll, true);
  };

  // Signature of the last applied displacement map. Skipping identical
  // updates avoids disposing/recreating every card's DOM on each mousemove
  // (the render memo rebuilds nodes on signal change).
  let lastDisplacementKey = "";
  const displacementKey = (merged: Map<string, number>) => {
    const parts: string[] = [];
    for (const [id, dy] of merged) parts.push(`${id}:${dy}`);
    parts.sort();
    return parts.join(",");
  };

  const update = (point: DragPoint) => {
    lastPoint = point;
    setDragPoint(point);
    const act = active();
    if (!act) return;
    const rest = cardRects.filter((c) => c.id !== act.id);
    const next = getBoardDropTarget(colRects, rest, point);
    setTarget(next);
    const merged = new Map<string, number>();
    for (const [col, ids] of cardOrder) {
      const from = col === act.columnId ? fromIndex : -1;
      const to = next && next.columnId === col ? next.index : null;
      const part = getColumnDisplacements(ids, from, to, extent);
      for (const [id, dy] of part) merged.set(id, dy);
    }
    const key = displacementKey(merged);
    if (key !== lastDisplacementKey) {
      lastDisplacementKey = key;
      setDisplacements(merged);
    }
  };

  const activate = (columnId: string, id: string, point: DragPoint) => {
    measure();
    const ids = cardOrder.get(columnId) ?? [];
    fromIndex = ids.indexOf(id);
    if (fromIndex < 0) {
      reset();
      return;
    }
    const entry = cardNodes.get(id);
    if (entry) {
      const r = entry.el.getBoundingClientRect();
      grabOffset = { x: point.x - r.left, y: point.y - r.top };
      overlayWidth = r.width;
      extent = r.height;
      // Account for the flex gap so siblings shift by a full slot.
      const tops = ids
        .map((cid) => cardNodes.get(cid))
        .filter((e) => e != null)
        .map((e) => {
          const rr = e.el.getBoundingClientRect();
          return { top: rr.top, bottom: rr.bottom };
        })
        .sort((a, b) => a.top - b.top);
      for (let i = 1; i < tops.length; i++) {
        const g = tops[i]!.top - tops[i - 1]!.bottom;
        if (g > 0) {
          extent += g;
          break;
        }
      }
    }
    lastPoint = point;
    setActive({ columnId, id });
    setTarget(null);
    setDisplacements(new Map());
    setDragPoint(point);
    setBodySelect("none");
    setAnnouncement(
      `Picked up card ${fromIndex + 1} of ${ids.length} in ${columnId}. Drag to move, Escape to cancel.`,
    );
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    update(point);
  };

  const commit = () => {
    const act = active();
    const dst = target();
    const didMove = moved;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    try {
      if (act && dst && didMove) {
        setAnnouncement(`Dropped in ${dst.columnId} at position ${dst.index + 1}.`);
        props.onDrop({
          activeId: act.id,
          fromColumn: act.columnId,
          toColumn: dst.columnId,
          toIndex: dst.index,
        });
        // Swallow only the click that the browser fires after a real drag.
        suppressClickUntil = Date.now() + 150;
      } else {
        setAnnouncement("Drag cancelled. Card returned to its original position.");
      }
    } finally {
      reset();
    }
  };

  const cancel = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll, true);
    setAnnouncement("Drag cancelled. Card returned to its original position.");
    reset();
  };

  const samePointer = (e: PointerEvent) =>
    activePointerId == null || e.pointerId === activePointerId;

  const onPointerMove = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    const point = { x: e.clientX, y: e.clientY };
    if (active() != null) {
      moved = true;
      update(point);
      return;
    }
    if (pending != null) {
      const dist = Math.hypot(point.x - pending.startX, point.y - pending.startY);
      if (dist >= activationDistance()) {
        const { columnId, id } = pending;
        pending = null;
        moved = true;
        activate(columnId, id, point);
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    if (active() != null) commit();
    else reset();
  };

  const onPointerCancel = () => cancel();

  const onBlur = () => {
    // Releasing outside the window fires no pointerup: cancel instead of
    // wedging `active` and killing every later drag.
    if (active() != null || pending != null) cancel();
  };

  const onLostPointerCapture = () => {
    if (active() != null) cancel();
  };

  const onScroll = () => {
    if (active() == null) return;
    measure();
    update(lastPoint);
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

  const begin = (columnId: string, id: string, e: PointerEvent) => {
    if (e.button !== 0 || (e.pointerType !== "mouse" && e.pointerType !== "pen")) return;
    // Defensive recovery: a previous gesture must never wedge the engine.
    if (active() != null || pending != null) cancel();
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
    pending = { columnId, id, startX: e.clientX, startY: e.clientY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
  };

  const api: DndBoardApi = {
    registerColumn: (id, el) => {
      colNodes.set(id, el);
    },
    unregisterColumn: (id) => {
      colNodes.delete(id);
    },
    registerCard: (columnId, id, el) => {
      cardNodes.set(id, { columnId, el });
    },
    unregisterCard: (id) => {
      cardNodes.delete(id);
    },
    snapshotCard: (id) => {
      const dy = displacements().get(id) ?? 0;
      return { isActive: active()?.id === id, dx: 0, dy };
    },
    columnOver: (columnId) => {
      const dst = target();
      return active() != null && dst != null && dst.columnId === columnId;
    },
    dropIndex: (columnId) => {
      const act = active();
      const dst = target();
      if (!act || !dst || dst.columnId !== columnId) return null;
      return dst.index;
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
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("click", onClickCapture, true);
    setBodySelect(null);
  });

  window.addEventListener("click", onClickCapture, true);

  const overlayPoint = () => {
    const p = dragPoint();
    return { x: p.x - grabOffset.x, y: p.y - grabOffset.y };
  };

  const overlayContent = createMemo(() => {
    const act = active();
    const overlay = props.overlay;
    if (act == null || overlay == null) return null;
    return overlay({ id: act.id, columnId: act.columnId });
  });

  return (
    <DndBoardContext.Provider value={api}>
      {props.children}
      <Show when={overlayContent() != null}>
        {/* No transition while dragging: easing the ghost on every pointermove
            makes it chase the cursor and feel laggy. Sibling displacement
            keeps its own ease via DND_BOARD_TRANSITION. */}
        <DndDragOverlay getPoint={overlayPoint} width={overlayWidth}>
          {overlayContent()}
        </DndDragOverlay>
      </Show>
      <div role="status" aria-live="polite" class="sr-only">
        {announcement()}
      </div>
    </DndBoardContext.Provider>
  );
};

export { DEFAULT_TRANSITION as DND_BOARD_TRANSITION };
