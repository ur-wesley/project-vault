export type TreemapNode<T> = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
  value: number;
};

function aspect_ratio(w: number, h: number): number {
  return Math.max(w / h, h / w);
}

function worst_ratio(row: { value: number }[], side: number): number {
  if (row.length === 0) return Infinity;
  const s = row.reduce((sum, r) => sum + r.value, 0);
  const thickness = s / side;
  let maxRatio = 0;
  for (const item of row) {
    const otherSide = item.value / thickness;
    maxRatio = Math.max(maxRatio, aspect_ratio(thickness, otherSide));
  }
  return maxRatio;
}

function layout_row<T>(
  row: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapNode<T>[] {
  const s = row.reduce((sum, r) => sum + r.value, 0);
  const out: TreemapNode<T>[] = [];

  if (w <= h) {
    // Vertical strip along the left side
    const stripW = s / h;
    let offset = 0;
    for (const item of row) {
      const ih = (item.value / s) * h;
      out.push({ x, y: y + offset, w: stripW, h: ih, data: item.data, value: item.value });
      offset += ih;
    }
  } else {
    // Horizontal strip along the top
    const stripH = s / w;
    let offset = 0;
    for (const item of row) {
      const iw = (item.value / s) * w;
      out.push({ x: x + offset, y, w: iw, h: stripH, data: item.data, value: item.value });
      offset += iw;
    }
  }
  return out;
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

  // Normalize values to rectangle area
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const area = w * h;
  const scale = area / totalValue;
  const normalized = items.map((i) => ({ value: i.value * scale, data: i.data }));

  const out: TreemapNode<T>[] = [];
  let row: { value: number; data: T }[] = [];
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;

  const flush_row = () => {
    if (row.length === 0) return;
    const side = Math.min(cw, ch);
    const nodes = layout_row(row, cx, cy, cw, ch);
    out.push(...nodes);

    const s = row.reduce((sum, r) => sum + r.value, 0);
    if (cw <= ch) {
      const stripW = s / ch;
      cx += stripW;
      cw -= stripW;
    } else {
      const stripH = s / cw;
      cy += stripH;
      ch -= stripH;
    }
    row = [];
  };

  for (const item of normalized) {
    const side = Math.min(cw, ch);

    if (row.length === 0) {
      row.push(item);
      continue;
    }

    const currentWorst = worst_ratio(row, side);
    const nextWorst = worst_ratio([...row, item], side);

    if (nextWorst <= currentWorst) {
      row.push(item);
    } else {
      flush_row();
      row.push(item);
    }
  }

  flush_row();
  return out;
}
