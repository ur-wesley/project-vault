import { createEffect, onCleanup, type Component, type JSX } from "solid-js";
import { DEFAULT_TRANSITION, useDndSortable, type DndItemSnapshot } from "./DndSortableRoot";

export interface DndSortableItemRenderState {
  /** Ref the consumer attaches to the sortable node. */
  setRef: (el: HTMLElement) => void;
  /**
   * Live snapshot accessor (displacement/active/over). Call inside JSX.
   * Memo-free by design: rebuilding item DOM on drag updates disposes nodes
   * and drops engine registration after one drag.
   */
  snapshot: () => DndItemSnapshot;
  /** CSS transition string for smooth displacement. */
  transition: string;
  dragListeners: {
    onPointerDown: (e: PointerEvent) => void;
    onDragStart: (e: Event) => void;
  };
}

type DndSortableItemProps = Readonly<{
  id: string;
  children: (state: DndSortableItemRenderState) => JSX.Element;
}>;

/**
 * Atomic sortable item. The consumer renders its own node via render prop
 * (dnd-kit `useSortable` ergonomics adapted to Solid) and attaches `setRef`,
 * `transform`/`transition` styles and `dragListeners` to it.
 */
export const DndSortableItem: Component<DndSortableItemProps> = (props) => {
  const api = useDndSortable();
  let node: HTMLElement | undefined;
  let registeredId: string | undefined;

  const setRef = (el: HTMLElement) => {
    node = el;
    if (registeredId !== undefined && registeredId !== props.id) {
      api.unregister(registeredId);
    }
    registeredId = props.id;
    api.register(props.id, el);
  };

  // List reconcilers reuse item instances by position: keep the registry
  // in sync when a reused instance receives a different id.
  createEffect(() => {
    const id = props.id;
    if (node !== undefined && registeredId !== undefined && registeredId !== id) {
      api.unregister(registeredId);
      api.register(id, node);
      registeredId = id;
    }
  });

  onCleanup(() => {
    if (registeredId !== undefined) api.unregister(registeredId);
  });

  // Memo-free by design (see DndBoardCard): rebuilding item DOM on drag
  // updates disposes nodes and drops engine registration after one drag.
  // The snapshot accessor keeps every update fine-grained instead.
  return props.children({
    setRef,
    snapshot: () => {
      const useOverlay = api.hasOverlay();
      return useOverlay ? api.snapshot(props.id) : api.follow(props.id);
    },
    transition: DEFAULT_TRANSITION,
    dragListeners: {
      onPointerDown: (e) => api.begin(props.id, e),
      // We run our own pointer-based engine; never let native HTML5 DnD start.
      onDragStart: (e) => e.preventDefault(),
    },
  });
};
