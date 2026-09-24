/** Shared text measurement for whiteboard labels (Excalidraw-lite). */

export const TEXT_LINE_HEIGHT = 1.25;
/** Horizontal inset kept clear inside bound shapes. */
export const TEXT_PADDING_X = 16;
/** Vertical inset kept clear inside bound shapes. */
export const TEXT_PADDING_Y = 12;
/** Minimum wrap width so narrow shapes still show a readable column. */
export const TEXT_MIN_WRAP = 40;
/** Hard cap on laid-out lines (matches render slice). */
export const TEXT_MAX_LINES = 100;
/** Pill padding for arrow/line labels (must match render.ts). */
export const LABEL_PILL_PAD_X = 6;
export const LABEL_PILL_PAD_Y = 3;

export function estimateCharWidth(
  fontSize: number,
  opts?: { bold?: boolean; fontFamily?: string },
): number {
  let w = fontSize * 0.55;
  if (opts?.bold) w *= 1.08;
  if (opts?.fontFamily === "code") w *= 1.12;
  return w;
}

export function estimateLineWidth(
  line: string,
  fontSize: number,
  opts?: { bold?: boolean; fontFamily?: string },
): number {
  if (line.length === 0) return 0;
  return line.length * estimateCharWidth(fontSize, opts);
}

/** Split raw text into paragraphs, preserving empty lines. */
export function splitParagraphs(text: string): string[] {
  return text.split("\n");
}

function hardBreak(word: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of word) {
    cur += ch;
    if (cur.length >= maxChars) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [word];
}

function wrapParagraph(
  paragraph: string,
  maxWidthPx: number | null,
  fontSize: number,
  opts?: { bold?: boolean; fontFamily?: string },
): string[] {
  if (maxWidthPx == null) return [paragraph];
  if (paragraph === "") return [""];
  const charW = Math.max(estimateCharWidth(fontSize, opts), 1);
  const maxChars = Math.max(4, Math.floor(maxWidthPx / charW));
  const words = paragraph.split(" ");
  const lines: string[] = [];
  let cur = "";
  const curW = (s: string) => s.length * charW;
  for (const word of words) {
    if (word === "") {
      // Consecutive spaces: keep one separator.
      cur += cur ? " " : "";
      continue;
    }
    if (curW(word) > maxWidthPx) {
      // Long word: flush current, then hard-break the word.
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      const parts = hardBreak(word, maxChars);
      for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
      cur = parts[parts.length - 1];
      continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (curW(next) <= maxWidthPx) {
      cur = next;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur || lines.length === 0) lines.push(cur);
  return lines;
}

export interface TextBlock {
  lines: string[];
  /** Max estimated line width (no pill/container padding). */
  width: number;
  height: number;
}

/**
 * Lay out text into wrapped lines + estimated block size.
 * maxWidthPx null = auto-width (no wrapping, one line per paragraph).
 */
export function measureTextBlock(
  text: string,
  fontSize: number,
  maxWidthPx: number | null,
  opts?: { bold?: boolean; fontFamily?: string },
): TextBlock {
  const paras = splitParagraphs(text).slice(0, TEXT_MAX_LINES);
  const lines: string[] = [];
  for (const p of paras) {
    const wrapped = wrapParagraph(p, maxWidthPx, fontSize, opts);
    for (const w of wrapped) {
      lines.push(w);
      if (lines.length >= TEXT_MAX_LINES) break;
    }
    if (lines.length >= TEXT_MAX_LINES) break;
  }
  if (lines.length === 0) lines.push("");
  let w = 8;
  for (const l of lines) w = Math.max(w, estimateLineWidth(l, fontSize, opts));
  return { lines, width: w, height: lines.length * fontSize * TEXT_LINE_HEIGHT };
}

/** Wrap width available inside a container box. */
export function boundWrapWidth(boxWidth: number): number {
  return Math.max(TEXT_MIN_WRAP, boxWidth - TEXT_PADDING_X * 2);
}

/** Normalize stored width: null = auto, otherwise clamped px. */
export function sanitizeTextWidth(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < TEXT_MIN_WRAP) return null;
  return Math.min(1200, Math.round(raw));
}

export type TextAlign = "left" | "center" | "right";

export function sanitizeTextAlign(raw: unknown, fallback: TextAlign = "left"): TextAlign {
  return raw === "center" || raw === "left" || raw === "right" ? raw : fallback;
}

export function sanitizeFontFamily(raw: unknown): "hand" | "normal" | "code" {
  return raw === "hand" || raw === "code" ? raw : "normal";
}

export function sanitizeBool(raw: unknown, fallback = false): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}
