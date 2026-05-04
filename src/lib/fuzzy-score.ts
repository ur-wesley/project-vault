/**
 * Fuzzy match scorer inspired by VS Code's quick open.
 * Returns a score between 0 and 1, where 0 = no match.
 *
 * Characters in `query` must appear in order within `target`.
 * Higher scores for:
 * - Exact match
 * - Match at start of string
 * - Match after separator characters (space, -, _, /, \\, .)
 * - Consecutive character matches
 * Lower scores for:
 * - Many skipped characters before first match
 * - Gaps between matched characters
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
  let consecutive = 0;
  let matchedCount = 0;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      if (firstMatchIndex === -1) {
        firstMatchIndex = ti;
        // Bonus for starting near the beginning
        score += Math.max(0, 1 - firstMatchIndex * 0.05);
      }

      // Bonus for exact case match
      if (query[qi] === target[ti]) {
        score += 0.1;
      }

      // Bonus for match at start of string
      if (ti === 0) {
        score += 0.8;
      }

      // Bonus for match after separator
      if (ti > 0 && isSeparator(t[ti - 1])) {
        score += 0.6;
      }

      // Bonus for consecutive matches
      if (consecutive > 0) {
        score += 0.4 * Math.min(consecutive, 3);
      }

      consecutive++;
      matchedCount++;
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }

  // If not all query characters matched, return 0
  if (qi < q.length) return 0;

  // Penalty for target being much longer than query
  const lengthPenalty = t.length / Math.max(query.length, 1);
  score -= (lengthPenalty - 1) * 0.05;

  // Normalize by query length to prevent long queries from dominating
  const baseScore = score / Math.max(query.length, 1);

  // Boost for higher match ratio
  const matchRatio = matchedCount / t.length;

  return Math.max(0, baseScore + matchRatio * 0.3);
}

function isSeparator(c: string): boolean {
  return c === " " || c === "-" || c === "_" || c === "/" || c === "\\" || c === ".";
}
