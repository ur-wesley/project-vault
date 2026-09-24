/**
 * Map a visual drop index to a backend `position`.
 *
 * The engine reports `toIndex` against the *visible* cards excluding the
 * dragged card (filters may hide cards, sort is manual here). The backend
 * inserts into the *full* column order after removing the dragged card, so
 * anchor on the visible successor: its index in the full order (minus the
 * dragged card) is the correct position. Appending maps to the end.
 */
export function backendDropPosition(
  fullOrder: string[],
  visibleOrder: string[],
  activeId: string,
  toIndex: number,
): number {
  const fullWithout = fullOrder.filter((id) => id !== activeId);
  const visibleWithout = visibleOrder.filter((id) => id !== activeId);
  const afterId = visibleWithout[toIndex];
  if (afterId === undefined) return fullWithout.length;
  const pos = fullWithout.indexOf(afterId);
  return pos < 0 ? fullWithout.length : pos;
}

/**
 * True when removing `activeId` from `fullOrder` and reinserting it at
 * `position` (an index into the order *without* the card) reproduces the
 * original order. Robust under active filters, where the engine index and
 * the full-order index differ.
 */
export function isNoOpDrop(fullOrder: string[], activeId: string, position: number): boolean {
  const without = fullOrder.filter((id) => id !== activeId);
  if (!fullOrder.includes(activeId)) return false;
  const next = [...without.slice(0, position), activeId, ...without.slice(position)];
  return next.length === fullOrder.length && next.every((id, i) => id === fullOrder[i]);
}
