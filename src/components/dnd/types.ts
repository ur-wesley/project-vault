/** Orientation of a sortable list. Determines which pointer axis is measured. */
export type SortableOrientation = "horizontal" | "vertical";

/** Pointer position in client coordinates. */
export interface DragPoint {
  x: number;
  y: number;
}

/** Pixel displacement applied to an item along the list's main axis. */
export interface AxisDisplacement {
  x: number;
  y: number;
}

/** 1D projection of an item's rect along the list's main axis, in current visual order. */
export interface SortableSlot {
  id: string;
  start: number;
  end: number;
}

export interface ReorderEvent {
  activeId: string;
  overId: string;
}

/** Drop of a card on a board: source column, target column, insertion index. */
export interface BoardDropEvent {
  activeId: string;
  fromColumn: string;
  toColumn: string;
  /** Insertion index in the target column excluding the dragged card. */
  toIndex: number;
}
