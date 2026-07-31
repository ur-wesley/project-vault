import { For, type JSX } from "solid-js";

type Segment = { text: string; match: boolean };

function fuzzyMatchIndices(query: string, target: string): Set<number> | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices = new Set<number>();
  let qi = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (q[qi] === t[ti]) {
      indices.add(ti);
      qi++;
    }
  }

  if (qi < q.length) return null;
  return indices;
}

function segmentsForQuery(text: string, query: string): Segment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const segments: Segment[] = [];
  let start = 0;
  let idx = lower.indexOf(qLower);

  if (idx >= 0) {
    while (idx >= 0) {
      if (idx > start) segments.push({ text: text.slice(start, idx), match: false });
      segments.push({ text: text.slice(idx, idx + q.length), match: true });
      start = idx + q.length;
      idx = lower.indexOf(qLower, start);
    }
    if (start < text.length) segments.push({ text: text.slice(start), match: false });
    return segments;
  }

  const indices = fuzzyMatchIndices(q, text);
  if (!indices || indices.size === 0) return [{ text, match: false }];

  for (let i = 0; i < text.length; i++) {
    segments.push({ text: text[i]!, match: indices.has(i) });
  }

  return mergeAdjacentSegments(segments);
}

function mergeAdjacentSegments(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.match === segment.match) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

export function SearchHighlightedText(props: {
  text: string;
  query: string;
  class?: string;
}): JSX.Element {
  const segments = () => segmentsForQuery(props.text, props.query);

  return (
    <span class={props.class}>
      <For each={segments()}>
        {(segment) =>
          segment.match ? (
            <mark class="rounded-sm bg-primary/30 px-0.5 font-semibold text-primary not-italic">
              {segment.text}
            </mark>
          ) : (
            <span>{segment.text}</span>
          )
        }
      </For>
    </span>
  );
}
