export type TreemapNode<T> = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
  value: number;
};

function layout_row<T>(
  row: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: boolean,
): TreemapNode<T>[] {
  const s = row.reduce((sum, r) => sum + r.value, 0);
  let offset = 0;
  const out: TreemapNode<T>[] = [];
  for (const item of row) {
    const ratio = item.value / s;
    if (vertical) {
      const ih = h * ratio;
      out.push({ x, y: y + offset, w, h: ih, data: item.data, value: item.value });
      offset += ih;
    } else {
      const iw = w * ratio;
      out.push({ x: x + offset, y, w: iw, h, data: item.data, value: item.value });
      offset += iw;
    }
  }
  return out;
}

function worst_ratio(row: { value: number }[], w: number, h: number): number {
  if (row.length === 0) return Infinity;
  const s = row.reduce((sum, r) => sum + r.value, 0);
  const min = Math.min(...row.map((r) => r.value));
  const max = Math.max(...row.map((r) => r.value));
  const side = Math.min(w, h);
  return Math.max(
    (side * side * max) / (s * s),
    (s * s) / (side * side * min),
  );
}

export function squarify<T>(
  items: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapNode<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ x, y, w, h, data: items[0]!.data, value: items[0]!.value }];
  }

  // Normalize so values sum to w*h
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const area = w * h;
  const normalized = items.map((i) => ({ ...i, value: (i.value / totalValue) * area }));

  const out: TreemapNode<T>[] = [];
  let row: { value: number; data: T }[] = [];
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  let remainingValue = area;

  for (let i = 0; i < normalized.length; i++) {
    const item = normalized[i]!;
    const side = Math.min(cw, ch);

    const nextRow = [...row, item];
    const currentWorst = worst_ratio(row, cw, ch);
    const nextWorst = worst_ratio(nextRow, cw, ch);

    if (row.length === 0 || nextWorst <= currentWorst) {
      row = nextRow;
    } else {
      // Layout current row
      const rowValue = row.reduce((s, r) => s + r.value, 0);
      const vertical = cw <= ch;
      const rowNodes = layout_row(row, cx, cy, cw, ch, vertical);
      out.push(...rowNodes);

      // Shrink remaining area
      if (vertical) {
        const rowH = ch * (rowValue / remainingValue);
        cy += rowH;
        ch -= rowH;
      } else {
        const rowW = cw * (rowValue / remainingValue);
        cx += rowW;
        cw -= rowW;
      }

      remainingValue -= rowValue;
      row = [item];
    }
  }

  if (row.length > 0) {
    const vertical = cw <= ch;
    const rowNodes = layout_row(row, cx, cy, cw, ch, vertical);
    out.push(...rowNodes);
  }

  return out;
}
