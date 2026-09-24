import { Portal } from "solid-js/web";
import { CSS } from "@dnd-kit/utilities";
import type { Component, JSX } from "solid-js";
import type { DragPoint } from "./types";

type DndDragOverlayProps = Readonly<{
  /** Reactive accessor for the ghost's top-left target in client coordinates. */
  getPoint: () => DragPoint;
  width?: number;
  transition?: string;
  children: JSX.Element;
}>;

/**
 * Floating ghost that follows the pointer during a drag.
 * Rendered in a portal above all app chrome.
 */
export const DndDragOverlay: Component<DndDragOverlayProps> = (props) => (
  <Portal>
    <div
      class="pointer-events-none fixed left-0 top-0 z-[100]"
      style={{
        transform: CSS.Translate.toString({
          x: props.getPoint().x,
          y: props.getPoint().y,
          scaleX: 1,
          scaleY: 1,
        }),
        width: props.width != null ? `${props.width}px` : undefined,
        transition: props.transition,
      }}
    >
      {props.children}
    </div>
  </Portal>
);
