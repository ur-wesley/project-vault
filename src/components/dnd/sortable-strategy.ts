import type { SortableSlot } from "./types";

/**
 * Index of the slot the pointer is currently over, using a nearest-center
 * rule (same family as dnd-kit's `closestCenter` collision detection).
 *
 * `slots` must be sorted by `start` in current visual order.
 * Returns -1 for an empty list. A pointer outside all slots snaps to the
 * nearest end, so items can be dragged to either end of the list.
 */
export function getOverIndex(slots: SortableSlot[], pointer: number): number {
  if (slots.length === 0) return -1;
  let best = 0;
  let bestDist = Math.abs(pointer - centerOf(slots[0]!));
  for (let i = 1; i < slots.length; i++) {
    const dist = Math.abs(pointer - centerOf(slots[i]!));
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Pixel displacement each non-dragged item needs along the main axis so the
 * list visually closes the dragged item's gap (dnd-kit sortable semantics).
 *
 * Items between the dragged item and the drop target shift by the dragged
 * item's full extent (size + gap); everything else stays at 0. The dragged
 * item itself is never in the map (it is rendered via the drag overlay).
 *
 * Returns an empty map when nothing moves (`fromIndex === overIndex` or
 * either index is -1).
 */
export function getDisplacements(
  slots: SortableSlot[],
  fromIndex: number,
  overIndex: number,
  gap = 0,
): Map<string, number> {
  const out = new Map<string, number>();
  if (
    fromIndex < 0 ||
    overIndex < 0 ||
    fromIndex >= slots.length ||
    overIndex >= slots.length ||
    fromIndex === overIndex
  ) {
    return out;
  }
  const from = slots[fromIndex]!;
  const extent = from.end - from.start + gap;
  if (extent <= 0) return out;
  if (fromIndex < overIndex) {
    for (let i = fromIndex + 1; i <= overIndex; i++) {
      out.set(slots[i]!.id, -extent);
    }
  } else {
    for (let i = overIndex; i < fromIndex; i++) {
      out.set(slots[i]!.id, extent);
    }
  }
  return out;
}

function centerOf(slot: SortableSlot): number {
  return (slot.start + slot.end) / 2;
}
