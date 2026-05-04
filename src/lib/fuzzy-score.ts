/**
 * Fuzzy match scorer inspired by VS Code's quick open.
 * Returns a score > 0 if all query characters appear in order within target.
 * Higher scores for closer-together matches, start-of-string, and separators.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  if (!target) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let qi = 0;
  let ti = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let matchedCount = 0;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      if (firstMatchIndex === -1) {
        firstMatchIndex = ti;
        // Small bonus for starting near the beginning
        score += Math.max(0, 1 - firstMatchIndex * 0.04);
      } else {
        const gap = ti - lastMatchIndex - 1;
        if (gap === 0) {
          // Consecutive match — strong bonus
          score += 1.5;
        } else {
          // Gap penalty — larger gaps hurt more
          score -= gap * 0.2;
        }
      }

      // Base score for every matched character
      score += 0.5;

      // Exact case match bonus
      if (query[qi] === target[ti]) {
        score += 0.1;
      }

      // Match at start of string
      if (ti === 0) {
        score += 0.8;
      }

      // Match after separator
      if (ti > 0 && isSeparator(t[ti - 1])) {
        score += 0.6;
      }

      matchedCount++;
      lastMatchIndex = ti;
      qi++;
    }
    ti++;
  }

  // Not all query characters matched
  if (qi < q.length) return 0;

  const span = lastMatchIndex - firstMatchIndex + 1;

  // Perfect consecutive match bonus
  if (span === query.length) {
    score += 1.0;
  }

  // Penalize overall span being much larger than query (scattered matches)
  score -= (span - query.length) * 0.1;

  return Math.max(0, score);
}

function isSeparator(c: string): boolean {
  return c === " " || c === "-" || c === "_" || c === "/" || c === "\\" || c === ".";
}
