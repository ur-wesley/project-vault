import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { getSearchQuery, SearchCursor } from "@codemirror/search";

import { resolveMinimapPalette, type MinimapPalette } from "../lib/minimap-palette";
import { changedHunk, matchOffsetsToLines } from "../lib/minimap-markers";

const MAX_LINE_CHARS = 120;
const MAX_ROWS = 360;
const MAX_SEARCH_MARKS = 300;
const SYNTAX_CHAR_LIMIT = 500_000;

type TokenKind = "plain" | "keyword" | "codeString" | "number" | "comment" | "typeName";

function classifyToken(nodeName: string): TokenKind {
  const name = nodeName.toLowerCase();
  if (name.includes("comment")) return "comment";
  if (name.includes("string") || name.includes("regexp") || name.includes("character")) {
    return "codeString";
  }
  if (name.includes("number") || name === "bool" || name.includes("boolean")) return "number";
  if (
    name.includes("keyword") ||
    name.includes("operator") ||
    name.includes("control") ||
    name === "null" ||
    name === "atom"
  ) {
    return "keyword";
  }
  if (name.includes("type") || name.includes("class") || name.includes("namespace")) {
    return "typeName";
  }
  return "plain";
}

function getBarAlpha(kind: TokenKind, indented: boolean): number {
  if (kind === "comment") return 0.45;
  if (kind === "plain") return indented ? 0.5 : 0.8;
  return 0.9;
}

function getBarColor(
  kind: TokenKind,
  indented: boolean,
  palette: MinimapPalette,
): string {
  if (kind === "plain") return indented ? palette.bar : palette.strong;
  if (kind === "comment") return palette.comment;
  if (kind === "keyword") return palette.keyword;
  if (kind === "codeString") return palette.codeString;
  if (kind === "number") return palette.number;
  return palette.typeName;
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w <= 0 || h <= 0) return;
  const radius = Math.min(1.5, h / 2, w / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

/**
 * Syntax-tinted editor minimap. Samples one line per row from the real
 * CodeMirror syntax tree (debounced by the reactive draw triggers), so the
 * map mirrors the editor's own highlighting at a fraction of the cost of
 * per-token rendering. Change ticks (vs the saved baseline), search ticks
 * and the caret line are overlaid; drag or hover to navigate.
 */
export function EditorMinimap(props: {
  text: string;
  baseline?: string;
  /** 1-based cursor line, or -1 when the tab is inactive. */
  cursorLine: number;
  getView: () => EditorView | undefined;
}) {
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let canvasEl: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let rootEl: HTMLDivElement | undefined;
  let scrollEl: HTMLElement | undefined;
  let observer: ResizeObserver | undefined;
  let rafId = 0;
  let dragging = false;
  const [hoverLine, setHoverLine] = createSignal<number | null>(null);

  // Split once per text change and reuse for draw + pointer math, instead of
  // re-splitting on every pointermove/scroll frame.
  const lineCount = createMemo(() => props.text.split("\n").length);

  const draw = (text: string, baseline: string | undefined, cursorLine: number) => {
    const canvas = canvasEl;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const palette = resolveMinimapPalette();
    const lines = text.split("\n");
    const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(height / 2)));
    const step = Math.max(1, Math.ceil(lines.length / rows));
    const rowCount = Math.ceil(lines.length / step);
    const rowHeight = height / rowCount;

    // Syntax sampling (skipped for huge files).
    const view = props.getView();
    const useSyntax = !!view && text.length <= SYNTAX_CHAR_LIMIT;
    const tree = useSyntax && view ? syntaxTree(view.state) : null;
    const doc = view?.state.doc;

    let y = 0;
    for (let row = 0; row < rowCount; row++) {
      const lineIndex = row * step;
      const raw = lines[lineIndex] ?? "";
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        let kind: TokenKind = "plain";
        if (tree && doc && doc.lines > 0) {
          const docLine = Math.min(lineIndex + 1, doc.lines);
          const line = doc.line(docLine);
          const indent = line.text.length - line.text.trimStart().length;
          if (indent < line.text.length) {
            kind = classifyToken(tree.resolveInner(line.from + indent, 1).name);
          }
        }
        const ratio = Math.min(trimmed.length / MAX_LINE_CHARS, 1);
        const indented = /^\s/.test(raw);
        ctx.globalAlpha = getBarAlpha(kind, indented);
        ctx.fillStyle = getBarColor(kind, indented, palette);
        const barWidth = Math.max(3, ratio * (width - 12));
        const offset = indented ? Math.min(8, width - barWidth - 4) : 4;
        roundBar(ctx, offset, y + 0.5, barWidth, Math.max(1.5, rowHeight - 1.5));
      }
      y += rowHeight;
    }
    ctx.globalAlpha = 1;

    const yForLine = (line: number) =>
      Math.min(height - 2, Math.max(0, ((line - 1) / Math.max(1, lines.length)) * height));

    // Change ticks (left edge).
    const hunk = changedHunk(baseline, text);
    if (hunk) {
      ctx.fillStyle = palette.added;
      const top = yForLine(hunk.fromLine);
      const bottom = yForLine(hunk.toLine + 1);
      ctx.fillRect(0.5, top, 2, Math.max(3, bottom - top));
      if (hunk.hasDeletions) {
        ctx.fillStyle = palette.removed;
        ctx.fillRect(0.5, Math.max(0, top - 1), 2, 3);
      }
    }

    // Search ticks (right edge).
    if (view) {
      const query = getSearchQuery(view.state);
      if (query.valid) {
        const offsets: number[] = [];
        const cursor = new SearchCursor(view.state.doc, query.search, 0, view.state.doc.length);
        for (const match of cursor) {
          offsets.push(match.from);
          if (offsets.length >= MAX_SEARCH_MARKS) break;
        }
        ctx.fillStyle = palette.search;
        for (const line of matchOffsetsToLines(text, offsets, MAX_SEARCH_MARKS)) {
          ctx.fillRect(width - 2.5, yForLine(line), 2, 3);
        }
      }
    }

    // Caret line.
    if (cursorLine > 0) {
      const top = yForLine(cursorLine);
      ctx.fillStyle = palette.caret;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(2, top, width - 4, 1.5);
      ctx.globalAlpha = 1;
    }

    // Viewport indicator.
    const scroller = view?.scrollDOM;
    if (scroller && scroller.scrollHeight > 0) {
      const total = scroller.scrollHeight;
      const top = (scroller.scrollTop / total) * height;
      const indicatorHeight = Math.max(14, Math.min(1, scroller.clientHeight / total) * height);
      ctx.fillStyle = palette.viewportFill;
      ctx.globalAlpha = 0.07;
      ctx.fillRect(0, top, width, indicatorHeight);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.viewportStroke;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(0.5, top + 0.5, width - 1, Math.max(13, indicatorHeight - 1), 3);
        ctx.stroke();
      } else {
        ctx.strokeRect(0.5, top + 0.5, width - 1, Math.max(13, indicatorHeight - 1));
      }
      ctx.globalAlpha = 1;
    }
  };

  const ratioToLine = (clientY: number): number => {
    const rect = rootEl?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 1;
    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    return Math.max(1, Math.round(ratio * lineCount()));
  };

  const scrollToRatio = (clientY: number) => {
    const rect = rootEl?.getBoundingClientRect();
    const view = props.getView();
    const scroller = view?.scrollDOM;
    if (!rect || rect.height === 0 || !scroller) return;
    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
  };

  // Read latest inputs without subscribing: async callbacks (scroll,
  // ResizeObserver, rAF) must never create or join a reactive computation.
  // The tracked trigger lives in the `createEffect(on(...))` below.
  const redraw = () => {
    untrack(() => draw(props.text, props.baseline, props.cursorLine));
  };

  // Coalesce bursts (typing + scroll + resize in the same frame) into one
  // canvas draw per frame.
  const scheduleRedraw = () => {
    if (rafId) return;
    if (typeof requestAnimationFrame === "undefined") {
      redraw();
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      redraw();
    });
  };

  const onScroll = () => scheduleRedraw();

  onMount(() => {
    const view = untrack(() => props.getView());
    scrollEl = view?.scrollDOM;
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    if (rootEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => scheduleRedraw());
      observer.observe(rootEl);
    }

    // Mount-time draw runs on the next frame so the synchronously-mounted
    // CodeMirror view (registered via onReady during the same mount pass)
    // is already visible through getView().
    scheduleRedraw();
  });

  onCleanup(() => {
    if (rafId && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    scrollEl?.removeEventListener("scroll", onScroll);
    observer?.disconnect();
    scrollEl = undefined;
    observer = undefined;
  });

  // Explicit deps: redraw on content/baseline/caret changes only. Reading
  // getView() here would subscribe to the whole editor-api registry and
  // redraw on unrelated tabs mounting/unmounting.
  createEffect(
    on(
      () => [props.text, props.baseline, props.cursorLine] as const,
      () => scheduleRedraw(),
      { defer: true },
    ),
  );

  return (
    <div
      ref={rootEl}
      class="relative h-full w-16 shrink-0 cursor-pointer overflow-hidden rounded-sm border-l border-border/40 bg-muted/10"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setHoverLine(ratioToLine(event.clientY));
        scrollToRatio(event.clientY);
      }}
      onPointerMove={(event) => {
        setHoverLine(ratioToLine(event.clientY));
        if (dragging) scrollToRatio(event.clientY);
      }}
      onPointerUp={() => {
        dragging = false;
      }}
      onPointerLeave={() => {
        if (!dragging) setHoverLine(null);
      }}
      role="presentation"
      aria-hidden="true"
    >
      <canvas ref={canvasEl} class="h-full w-full" />
      <Show when={hoverLine() !== null}>
        <span class="pointer-events-none absolute right-1 top-1 rounded bg-popover px-1 py-0.5 font-mono text-[9px] text-popover-foreground shadow">
          {`Ln ${hoverLine()}`}
        </span>
      </Show>
    </div>
  );
}
