import { createEffect, onCleanup, type Component, type JSX } from "solid-js";
import { CSS } from "@dnd-kit/utilities";

import { DND_BOARD_TRANSITION, useDndBoard, type DndBoardCardSnapshot } from "./DndBoardRoot";

export interface DndBoardColumnRenderState {
  /** Ref the consumer attaches to the column container node. */
  setRef: (el: HTMLElement) => void;
  /** True while a dragged card hovers this column. */
  isOver: () => boolean;
  /** Insertion index for the line indicator, or null. */
  dropIndex: () => number | null;
}

type DndBoardColumnProps = Readonly<{
  id: string;
  children: (state: DndBoardColumnRenderState) => JSX.Element;
}>;

/**
 * Atomic board column.
 *
 * Deliberately memo-free: rebuilding the container on drag updates would
 * dispose card subtrees (unregistering them from the engine) while
 * reinserting the same vnodes without refiring refs — draining the registry
 * after one drag. Accessors keep every update fine-grained instead.
 */
export const DndBoardColumn: Component<DndBoardColumnProps> = (props) => {
  const api = useDndBoard();

  const setRef = (el: HTMLElement) => {
    api.registerColumn(props.id, el);
  };

  onCleanup(() => {
    api.unregisterColumn(props.id);
  });

  return props.children({
    setRef,
    isOver: () => api.columnOver(props.id),
    dropIndex: () => api.dropIndex(props.id),
  });
};

export interface DndBoardCardRenderState {
  /** Ref the consumer attaches to the card node. */
  setRef: (el: HTMLElement) => void;
  /** Live snapshot accessor (displacement, active). Call inside JSX. */
  snapshot: () => DndBoardCardSnapshot;
  /** CSS transition string for smooth displacement. */
  transition: string;
  dragListeners: {
    onPointerDown: (e: PointerEvent) => void;
    onDragStart: (e: Event) => void;
  };
}

type DndBoardCardProps = Readonly<{
  columnId: string;
  id: string;
  children: (state: DndBoardCardRenderState) => JSX.Element;
}>;

/**
 * Atomic board card. Unlike `DndSortableItem`, the drag listeners are meant
 * to be attached to a handle/title element — not the whole card — so the
 * rest of the card (badges, buttons, inputs) never arms a drag.
 *
 * Like the column, this is memo-free for the same reason: the snapshot is
 * read through an accessor so sibling-displacement updates never dispose
 * and recreate the card node (which would drop engine registration and
 * steal input focus mid-drag).
 */
export const DndBoardCard: Component<DndBoardCardProps> = (props) => {
  const api = useDndBoard();
  let node: HTMLElement | undefined;
  let registered: { columnId: string; id: string } | undefined;

  const setRef = (el: HTMLElement) => {
    node = el;
    if (registered && (registered.id !== props.id || registered.columnId !== props.columnId)) {
      api.unregisterCard(registered.id);
    }
    registered = { columnId: props.columnId, id: props.id };
    api.registerCard(props.columnId, props.id, el);
  };

  // List reconcilers reuse item instances by position: keep the registry
  // in sync when a reused instance receives a different id or column.
  createEffect(() => {
    const id = props.id;
    const columnId = props.columnId;
    if (
      node !== undefined &&
      registered !== undefined &&
      (registered.id !== id || registered.columnId !== columnId)
    ) {
      api.unregisterCard(registered.id);
      api.registerCard(columnId, id, node);
      registered = { columnId, id };
    }
  });

  onCleanup(() => {
    if (registered !== undefined) {
      api.unregisterCard(registered.id);
      registered = undefined;
    }
  });

  return props.children({
    setRef,
    snapshot: () => api.snapshotCard(props.id),
    transition: DND_BOARD_TRANSITION,
    dragListeners: {
      onPointerDown: (e) => api.begin(props.columnId, props.id, e),
      // Pointer-based engine; never let native HTML5 DnD start.
      onDragStart: (e) => e.preventDefault(),
    },
  });
};

export function snapshotTransform(snap: DndBoardCardSnapshot): string | undefined {
  const hasDelta = snap.dx !== 0 || snap.dy !== 0;
  return hasDelta
    ? CSS.Translate.toString({ x: snap.dx, y: snap.dy, scaleX: 1, scaleY: 1 })
    : undefined;
}
