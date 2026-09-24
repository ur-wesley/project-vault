export type DiffRowKind = "meta" | "hunk" | "ctx" | "add" | "del";

export type DiffRow = {
  kind: DiffRowKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse a unified diff into line rows with old/new numbers. Pure. */
export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\ ")
    ) {
      if (line.startsWith("diff --git"))
        rows.push({ kind: "meta", oldNo: null, newNo: null, text: line });
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ kind: "hunk", oldNo: null, newNo: null, text: line });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    } else if (line === "") {
      // Trailing newline artifact — skip, don't consume line numbers.
      continue;
    } else {
      rows.push({ kind: "meta", oldNo: null, newNo: null, text: line });
    }
  }
  return rows;
}

export type SidePair = {
  left: DiffRow | null;
  right: DiffRow | null;
};

/** Pair deletions with following additions for side-by-side rendering. */
export function pairSideBySide(rows: DiffRow[]): SidePair[] {
  const pairs: SidePair[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind === "del") {
      const dels: DiffRow[] = [];
      while (i < rows.length && rows[i]!.kind === "del") dels.push(rows[i++]!);
      const adds: DiffRow[] = [];
      while (i < rows.length && rows[i]!.kind === "add") adds.push(rows[i++]!);
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        pairs.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    } else if (row.kind === "add") {
      pairs.push({ left: null, right: row });
      i++;
    } else {
      pairs.push({ left: row, right: row.kind === "hunk" || row.kind === "meta" ? null : row });
      i++;
    }
  }
  return pairs;
}
