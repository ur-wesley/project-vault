export type TreemapNode<T> = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
};

function worstAspectRatio(
  row: { value: number }[],
  sideLength: number,
): number {
  if (row.length === 0) return Infinity;
  const s = row.reduce((sum, r) => sum + r.value, 0);
  const thickness = s / sideLength;
  let worst = 0;
  for (const item of row) {
    const length = (item.value / s) * sideLength;
    const ar = Math.max(thickness / length, length / thickness);
    if (ar > worst) worst = ar;
  }
  return worst;
}

function layoutRow<T>(
  row: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: boolean,
): TreemapNode<T>[] {
  const s = row.reduce((sum, r) => sum + r.value, 0);
  const sideLength = vertical ? h : w;
  const thickness = s / sideLength;
  let offset = 0;
  const out: TreemapNode<T>[] = [];
  for (const item of row) {
    const length = (item.value / s) * sideLength;
    if (vertical) {
      out.push({ x, y: y + offset, w: thickness, h: length, data: item.data });
      offset += length;
    } else {
      out.push({ x: x + offset, y, w: length, h: thickness, data: item.data });
      offset += length;
    }
  }
  return out;
}

function squarifyInner<T>(
  items: { value: number; data: T }[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapNode<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ x, y, w, h, data: items[0]!.data }];
  }

  const out: TreemapNode<T>[] = [];
  let remaining = items.slice();
  let row: { value: number; data: T }[] = [];
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;

  const flush = () => {
    if (row.length === 0) return;
    const vertical = cw <= ch;
    const nodes = layoutRow(row, cx, cy, cw, ch, vertical);
    out.push(...nodes);

    const s = row.reduce((sum, r) => sum + r.value, 0);
    if (vertical) {
      const thickness = s / ch;
      cx += thickness;
      cw -= thickness;
    } else {
      const thickness = s / cw;
      cy += thickness;
      ch -= thickness;
    }
    row = [];
  };

  while (remaining.length > 0) {
    const item = remaining[0]!;
    const sideLength = Math.min(cw, ch);

    if (row.length === 0) {
      row.push(item);
      remaining = remaining.slice(1);
      continue;
    }

    const currentWorst = worstAspectRatio(row, sideLength);
    const nextWorst = worstAspectRatio([...row, item], sideLength);

    if (nextWorst <= currentWorst) {
      row.push(item);
      remaining = remaining.slice(1);
    } else {
      flush();
    }
  }

  flush();
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

  // Sort descending for better layout
  const sorted = [...items].sort((a, b) => b.value - a.value);

  // Normalize values to area of rectangle
  const totalValue = sorted.reduce((s, i) => s + i.value, 0);
  const area = w * h;
  if (totalValue === 0) return [];
  const scale = area / totalValue;
  const normalized = sorted.map((i) => ({ value: i.value * scale, data: i.data }));

  return squarifyInner(normalized, x, y, w, h);
}
