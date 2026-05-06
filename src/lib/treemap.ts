export type TreemapNode<T> = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
};

function splitAtBalance<T>(
  items: { value: number; data: T }[],
): [typeof items, typeof items] {
  const total = items.reduce((s, i) => s + i.value, 0);
  let running = 0;
  let idx = 0;
  for (let i = 0; i < items.length; i++) {
    running += items[i].value;
    idx = i + 1;
    if (running >= total / 2) break;
  }
  // Ensure at least one item per side
  idx = Math.max(1, Math.min(idx, items.length - 1));
  return [items.slice(0, idx), items.slice(idx)];
}

export function treemap<T>(
  items: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapNode<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ x, y, w: Math.max(1, w), h: Math.max(1, h), data: items[0]!.data }];
  }

  const total = items.reduce((s, i) => s + i.value, 0);
  const [left, right] = splitAtBalance(items);
  const leftTotal = left.reduce((s, i) => s + i.value, 0);
  const ratio = leftTotal / total;

  if (w >= h) {
    // Container is wider → split vertically (left / right)
    const lw = Math.max(1, w * ratio);
    return [
      ...treemap(left, x, y, lw, h),
      ...treemap(right, x + lw, y, Math.max(1, w - lw), h),
    ];
  } else {
    // Container is taller → split horizontally (top / bottom)
    const lh = Math.max(1, h * ratio);
    return [
      ...treemap(left, x, y, w, lh),
      ...treemap(right, x, y + lh, w, Math.max(1, h - lh)),
    ];
  }
}
