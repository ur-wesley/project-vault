import { createEffect, createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";

import type { FileContentModel } from "./useFileContent";

/**
 * Scroll-to-line/query domain: resolves the target line (explicit line or
 * first query-token hit), flips markdown to code view so `data-line`
 * targets exist, then smooth-scrolls + highlights the closest line.
 * (Extracted verbatim from FilePreview.)
 */
export function createPreviewScroll(opts: {
  content: FileContentModel["content"];
  viewMode: Accessor<"preview" | "code">;
  setViewMode: Setter<"preview" | "code">;
  path: Accessor<string | null>;
  scrollToLine: Accessor<number | undefined>;
  scrollToQuery: Accessor<string | undefined>;
}) {
  const { content, viewMode, setViewMode, path, scrollToLine, scrollToQuery } = opts;
  const [lastScrolledLine, setLastScrolledLine] = createSignal<string>("");

  createEffect(() => {
    const requested = scrollToLine() ?? 0;
    const query = scrollToQuery() ?? "";
    const c = content();
    // Read viewMode() unconditionally so Solid re-runs this effect when we
    // flip to source view below.
    const isPreviewMarkdown = !!c && c.isMarkdown && viewMode() !== "code";
    if (!c) return;

    // Resolve the line we'll actually scroll to. The backend supplies an
    // absolute line for content matches; for path-only matches
    // (requested == 0) we fall back to the first line of the file that
    // contains any of the search query's tokens.
    let line = requested;
    if (line <= 0 && query) {
      const tokens = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);
      if (tokens.length > 0 && c.text) {
        const lines = c.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          if (tokens.some((tok) => lower.includes(tok))) {
            line = i + 1;
            break;
          }
        }
      }
    }
    if (line <= 0) return;

    // For markdown files the default `preview` view doesn't carry
    // `data-line` attributes; flip to `code` so the scroll effect can
    // find a target line.
    if (isPreviewMarkdown) {
      setViewMode("code");
      return;
    }

    if (!c.html) return;
    // Guard against re-firing on the SAME line for the same file. We key the
    // dedupe on (path, line) so a stale `lastScrolledLine` from a previous
    // file can't suppress scrolling on a new file at the same line.
    const key = `${path() ?? ""}::${line}::${query}`;
    if (lastScrolledLine() === key) return;
    setLastScrolledLine(key);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.querySelector(".shiki-container");
        if (!container) return;
        let el: Element | null = container.querySelector(`[data-line="${line}"]`);
        // Fallback: if the exact line isn't in the rendered DOM (snippet was
        // clipped or the backend gave a bad number), jump to the closest
        // available line so the user still gets a visual cue.
        if (!el && container.children.length > 0) {
          const all = Array.from(container.querySelectorAll<HTMLElement>("[data-line]"));
          if (all.length > 0) {
            let best = all[0];
            let bestDist = Math.abs(Number(best.dataset.line) - line);
            for (const candidate of all) {
              const d = Math.abs(Number(candidate.dataset.line) - line);
              if (d < bestDist) {
                best = candidate;
                bestDist = d;
              }
            }
            el = best;
          }
        }
        if (!el) return;
        el.classList.add("search-highlight-line");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          el!.classList.remove("search-highlight-line");
        }, 3000);
      });
    });
  });
}
