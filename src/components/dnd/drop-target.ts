import type { DragPoint } from "./types";

export interface BoardColumnRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BoardCardRect {
  id: string;
  columnId: string;
  top: number;
  bottom: number;
}

export interface BoardDropTarget {
  columnId: string;
  /** Insertion index within the column (0 = top, length = append). */
  index: number;
}

/**
 * Multi-container collision for board drags: which column the pointer is
 * over, and at which index the dragged card would land. Pure.
 *
 * `cards` should already exclude the dragged card so the index matches
 * remove-then-insert backend semantics. Cards are ordered by `top`.
 * Returns null when the pointer is outside every column (drop cancels).
 */
export function getBoardDropTarget(
  columns: BoardColumnRect[],
  cards: BoardCardRect[],
  point: DragPoint,
): BoardDropTarget | null {
  const column =
    columns.find(
      (c) => point.x >= c.left && point.x <= c.right && point.y >= c.top && point.y <= c.bottom,
    ) ?? null;
  if (!column) return null;
  const inColumn = cards
    .filter((c) => c.columnId === column.id)
    .slice()
    .sort((a, b) => a.top - b.top);
  for (let i = 0; i < inColumn.length; i++) {
    const mid = (inColumn[i]!.top + inColumn[i]!.bottom) / 2;
    if (point.y < mid) return { columnId: column.id, index: i };
  }
  return { columnId: column.id, index: inColumn.length };
}

/**
 * Vertical pixel displacement per card so lists visually open a gap at the
 * drop target and close the dragged card's gap (dnd-kit sortable semantics).
 *
 * `idsWithout` are the column's card ids in visual order EXCLUDING the
 * dragged card; `fromIndex` is the dragged card's original index in this
 * column (-1 for foreign columns); `toIndex` the insertion index (null when
 * this column is neither source nor target).
 */
export function getColumnDisplacements(
  idsWithout: string[],
  fromIndex: number,
  toIndex: number | null,
  extent: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (extent <= 0) return out;
  for (let p = 0; p < idsWithout.length; p++) {
    const orig = p + (fromIndex >= 0 && p >= fromIndex ? 1 : 0);
    const fin = p + (toIndex != null && p >= toIndex ? 1 : 0);
    const delta = (fin - orig) * extent;
    if (delta !== 0) out.set(idsWithout[p]!, delta);
  }
  return out;
}
