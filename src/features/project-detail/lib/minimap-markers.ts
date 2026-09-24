/**
 * Pure marker computation for the minimap. Change ticks come from a cheap
 * prefix/suffix hunk between baseline and current text (exact enough for a
 * minimap); search ticks are mapped from match offsets to 1-based lines.
 */

export type ChangeHunk = {
  /** 1-based first changed line in the current text. */
  fromLine: number;
  /** 1-based last changed line in the current text. */
  toLine: number;
  /** True when the baseline hunk was longer (lines were deleted). */
  hasDeletions: boolean;
} | null;

/** Locate the single changed hunk between baseline and current, if any. */
export function changedHunk(baseline: string | undefined, current: string): ChangeHunk {
  if (baseline === undefined || baseline === current) return null;
  const oldLines = baseline.split("\n");
  const newLines = current.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  // `>=` (not `>`) so a shared trailing newline still trims; the hunk can't
  // vanish because baseline and current are known to differ here.
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    fromLine: start + 1,
    toLine: Math.max(start + 1, newEnd + 1),
    hasDeletions: oldEnd - start > newEnd - start,
  };
}

/** Map match offsets to 1-based line numbers (capped for minimap use). */
export function matchOffsetsToLines(text: string, offsets: readonly number[], cap = 300): number[] {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const lines: number[] = [];
  for (const offset of offsets) {
    if (lines.length >= cap) break;
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    lines.push(lo + 1);
  }
  return lines;
}
