import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { BridgeQuickPickItem, BridgeQuickPickOptions } from "./dialogTypes";

/**
 * Quick-pick dialog domain: state, fuzzy filter, keyboard nav, scroll,
 * resolve, show-quick-pick subscription. (Extracted verbatim from
 * PluginUiBridge. The null-contract fuzzy scorer stays local: it differs
 * from lib/fuzzy-score in contract and arg order — see Phase 1 notes.)
 */
export function createQuickPickModel() {
  const [quickPick, setQuickPick] = createSignal<BridgeQuickPickOptions | null>(null);
  const [qpSearch, setQpSearch] = createSignal("");
  const [qpSelectedIdx, setQpSelectedIdx] = createSignal(0);
  let qpListRef: HTMLDivElement | undefined;

  // Reset search + selection when a new quick pick opens
  createEffect(() => {
    if (quickPick()) {
      setQpSearch("");
      setQpSelectedIdx(0);
    }
  });

  // Helper for fuzzy matching
  const fuzzyMatch = (str: string, query: string): number | null => {
    const strLen = str.length;
    const queryLen = query.length;
    if (queryLen === 0) return 0;
    if (queryLen > strLen) return null;

    let sIdx = 0;
    let qIdx = 0;
    let score = 0;
    let consecutive = 0;

    while (sIdx < strLen && qIdx < queryLen) {
      const sChar = str[sIdx].toLowerCase();
      const qChar = query[qIdx].toLowerCase();

      if (sChar === qChar) {
        let charScore = 1;
        if (consecutive > 0) {
          charScore += consecutive * 2;
        }
        if (sIdx === 0) {
          charScore += 5;
        } else {
          const prevChar = str[sIdx - 1];
          if (
            prevChar === "/" ||
            prevChar === "\\" ||
            prevChar === "_" ||
            prevChar === "-" ||
            prevChar === "."
          ) {
            charScore += 5;
          }
        }
        score += charScore;
        consecutive++;
        qIdx++;
      } else {
        consecutive = 0;
      }
      sIdx++;
    }

    if (qIdx >= queryLen) {
      score -= strLen * 0.1;
      return score;
    }
    return null;
  };

  // Filtered items — case-insensitive substring or fuzzy match on label and detail
  const filteredQpItems = createMemo(() => {
    const items = quickPick()?.items ?? [];
    const q = qpSearch().toLowerCase().trim();
    if (!q) return items;

    if (quickPick()?.fuzzy) {
      const scored: { item: BridgeQuickPickItem; score: number }[] = [];
      for (const item of items) {
        const labelScore = fuzzyMatch(item.label, q);
        const detailScore = item.detail ? fuzzyMatch(item.detail, q) : null;

        if (labelScore !== null || detailScore !== null) {
          const score = Math.max(labelScore ?? -9999, detailScore ?? -9999);
          scored.push({ item, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.map((x) => x.item);
    } else {
      return items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) || (item.detail?.toLowerCase().includes(q) ?? false),
      );
    }
  });

  const currentItem = createMemo(() => {
    const items = filteredQpItems();
    return items[qpSelectedIdx()] ?? null;
  });

  // Clamp selected index when filter changes
  createEffect(() => {
    const max = filteredQpItems().length - 1;
    if (qpSelectedIdx() > max) setQpSelectedIdx(Math.max(0, max));
  });

  // Scroll the highlighted item into view whenever the selection moves
  createEffect(() => {
    const idx = qpSelectedIdx();
    if (!qpListRef) return;
    const items = qpListRef.querySelectorAll<HTMLElement>("[data-qp-item]");
    items[idx]?.scrollIntoView({ block: "nearest" });
  });

  const resolveQuickPick = async (value: string | null) => {
    const current = quickPick();
    if (!current) return;
    await invoke("resolve_plugin_ui", { id: current.id, value });
    setQuickPick(null);
  };

  // Keyboard handler for the quick pick dialog — full wrapping navigation
  const handleQpKeyDown = (e: KeyboardEvent) => {
    const items = filteredQpItems();
    if (items.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        // Wraps: last → first
        setQpSelectedIdx((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        // Wraps: first → last
        setQpSelectedIdx((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setQpSelectedIdx(0);
        break;
      case "End":
        e.preventDefault();
        setQpSelectedIdx(items.length - 1);
        break;
      case "Enter": {
        e.preventDefault();
        const item = items[qpSelectedIdx()];
        if (item) resolveQuickPick(item.id);
        break;
      }
    }
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<[string, { title: string; items: any[]; fuzzy?: boolean; preview?: boolean }]>(
          "plugin:show-quick-pick",
          (event) => {
            const [id, options] = event.payload;
            setQuickPick({
              id,
              title: options.title,
              items: options.items,
              fuzzy: options.fuzzy,
              preview: options.preview,
            });
          },
        ),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  return {
    quickPick,
    qpSearch,
    setQpSearch,
    qpSelectedIdx,
    setQpSelectedIdx,
    setQpListRef: (el: HTMLDivElement | undefined) => {
      qpListRef = el;
    },
    filteredQpItems,
    currentItem,
    handleQpKeyDown,
    resolveQuickPick,
  };
}
