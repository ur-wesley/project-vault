import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { listen } from "@tauri-apps/api/event";
import type { ClipboardEntryDto } from "~/types/dto";
import { fuzzyScore } from "~/lib/fuzzy-score";
import { stableErrorMessage } from "~/lib/invoke-error";
import { useI18n } from "~/lib/i18n-context";
import { queryKeys } from "~/services/query-keys";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyClipboardEntry,
  clearClipboardHistory,
  closeClipboardOverlay,
  deleteClipboardEntry,
  listClipboardHistory,
  prepareClipboardOverlayWindow,
  toggleClipboardPin,
} from "~/services/tauri/clipboard-history";
import { ClipboardEntryRow } from "./components/ClipboardEntryRow";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { toast } from "solid-sonner";

const ONE_DAY = 24 * 60 * 60 * 1000;
const FILTERS = ["all", "text", "files", "image"] as const;
type FilterKind = (typeof FILTERS)[number];

type Group = { key: string; label: string; items: ClipboardEntryDto[] };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupEntries(items: ClipboardEntryDto[], t: (k: string) => string): Group[] {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - ONE_DAY;
  const weekStart = todayStart - 6 * ONE_DAY;

  const today: ClipboardEntryDto[] = [];
  const yesterday: ClipboardEntryDto[] = [];
  const thisWeek: ClipboardEntryDto[] = [];
  const older: ClipboardEntryDto[] = [];

  for (const it of items) {
    const dayStart = startOfDay(it.createdAtMs);
    if (dayStart >= todayStart) today.push(it);
    else if (dayStart >= yesterdayStart) yesterday.push(it);
    else if (dayStart >= weekStart) thisWeek.push(it);
    else older.push(it);
  }

  const groups: Group[] = [];
  if (today.length) groups.push({ key: "today", label: t("clipboardHistory.groupToday"), items: today });
  if (yesterday.length) groups.push({ key: "yesterday", label: t("clipboardHistory.groupYesterday"), items: yesterday });
  if (thisWeek.length) groups.push({ key: "week", label: t("clipboardHistory.groupThisWeek"), items: thisWeek });
  if (older.length) groups.push({ key: "older", label: t("clipboardHistory.groupOlder"), items: older });
  return groups;
}

function matchesSearch(item: ClipboardEntryDto, query: string): boolean {
  const hay = `${item.preview} ${item.contentText ?? ""} ${(item.meta?.filePaths ?? []).join(" ")}`.toLowerCase();
  const q = query.toLowerCase();
  if (hay.includes(q)) return true;
  return fuzzyScore(query, hay) > 0;
}

export const ClipboardHistoryOverlay: Component = () => {
  const { t } = useI18n();
  const tStr = (k: string) => t(k as Parameters<typeof t>[0]) as string;
  const qc = useQueryClient();

  const [search, setSearch] = createSignal("");
  const [filterIdx, setFilterIdx] = createSignal(0);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [clearOpen, setClearOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let searchRef: HTMLInputElement | undefined;
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let listRef: HTMLDivElement | undefined;

  const filterKind = (): FilterKind => FILTERS[filterIdx()] ?? "all";

  const historyQ = createQuery(() => ({
    queryKey: queryKeys.clipboardHistory(filterKind()),
    queryFn: async () => {
      const r = await listClipboardHistory({
        kind: filterKind() === "all" ? undefined : filterKind(),
        limit: 200,
      });
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const filteredEntries = createMemo(() => {
    const items = historyQ.data ?? [];
    const q = search().trim();
    const matched = q ? items.filter((item) => matchesSearch(item, q)) : items;

    const seen = new Set<string>();
    const deduped: ClipboardEntryDto[] = [];
    for (const item of matched) {
      if (seen.has(item.contentHash)) continue;
      seen.add(item.contentHash);
      deduped.push(item);
    }
    return deduped;
  });

  const groups = createMemo(() => groupEntries(filteredEntries(), tStr));
  const flatEntries = createMemo(() => groups().flatMap((g) => g.items));
  const entryIndexMap = createMemo(() => {
    const map = new Map<string, number>();
    flatEntries().forEach((e, i) => map.set(e.id, i));
    return map;
  });
  const selectedEntry = createMemo(() => flatEntries()[selectedIdx()] ?? null);

  createEffect(() => {
    const max = Math.max(0, flatEntries().length - 1);
    if (selectedIdx() > max) setSelectedIdx(max);
  });

  createEffect(() => {
    const idx = selectedIdx();
    if (!listRef) return;
    const items = listRef.querySelectorAll<HTMLElement>("[data-clip-item]");
    items[idx]?.scrollIntoView({ block: "nearest" });
  });

  const closeOverlay = async () => {
    try {
      await getCurrentWindow().destroy();
    } catch {
      const r = await closeClipboardOverlay();
      if (r.isErr()) console.error("[clipboard] close failed:", r.error.message);
    }
  };

  const applyEntry = async (entry: ClipboardEntryDto) => {
    if (busy()) return;
    setBusy(true);
    try {
      const r = await applyClipboardEntry(entry.id);
      if (r.isErr()) toast.error(stableErrorMessage(tStr, r.error));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const entry = selectedEntry();
    if (!entry || busy()) return;
    const r = await deleteClipboardEntry(entry.id);
    if (r.isErr()) {
      toast.error(stableErrorMessage(tStr, r.error));
      return;
    }
    void qc.invalidateQueries({ queryKey: ["clipboard", "history"] });
  };

  const togglePinSelected = async () => {
    const entry = selectedEntry();
    if (!entry || busy()) return;
    const r = await toggleClipboardPin(entry.id);
    if (r.isErr()) {
      toast.error(stableErrorMessage(tStr, r.error));
      return;
    }
    void qc.invalidateQueries({ queryKey: ["clipboard", "history"] });
  };

  const handleListKeyDown = (e: KeyboardEvent) => {
    if (clearOpen()) return;

    const items = flatEntries();
    const target = e.target as HTMLElement;
    const inSearch = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void closeOverlay();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      setFilterIdx((i) => (i + 1) % FILTERS.length);
      setSelectedIdx(0);
      return;
    }

    if (e.key >= "1" && e.key <= "9" && e.ctrlKey) {
      e.preventDefault();
      const idx = Number(e.key) - 1;
      if (idx < items.length) setSelectedIdx(idx);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (items.length) setSelectedIdx((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (items.length) setSelectedIdx((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        e.preventDefault();
        setSelectedIdx(0);
        break;
      case "End":
        e.preventDefault();
        setSelectedIdx(Math.max(0, items.length - 1));
        break;
      case "Enter": {
        e.preventDefault();
        e.stopPropagation();
        const entry = items[selectedIdx()];
        if (entry) void applyEntry(entry);
        break;
      }
      case "Delete":
        e.preventDefault();
        if (e.shiftKey) setClearOpen(true);
        else void deleteSelected();
        break;
      case "p":
        if (inSearch) return;
        e.preventDefault();
        void togglePinSelected();
        break;
    }
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    const win = getCurrentWindow();
    let closed = false;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;

    const focusSearch = () => searchRef?.focus();
    const onGainedFocus = () => {
      if (blurTimer !== undefined) {
        clearTimeout(blurTimer);
        blurTimer = undefined;
      }
      focusSearch();
    };
    const dismiss = () => {
      if (closed || clearOpen() || busy()) return;
      closed = true;
      void closeOverlay();
    };
    const onLostFocus = () => {
      if (closed || clearOpen() || busy()) return;
      if (blurTimer !== undefined) clearTimeout(blurTimer);
      blurTimer = setTimeout(dismiss, 80);
    };

    void prepareClipboardOverlayWindow().catch(() => {});

    document.addEventListener("keydown", handleListKeyDown, true);
    unlistens.push(() => document.removeEventListener("keydown", handleListKeyDown, true));

    window.addEventListener("focus", onGainedFocus);
    unlistens.push(() => window.removeEventListener("focus", onGainedFocus));
    window.addEventListener("blur", onLostFocus);
    unlistens.push(() => window.removeEventListener("blur", onLostFocus));

    void win
      .onFocusChanged(({ payload: focused }) => {
        if (focused) onGainedFocus();
        else onLostFocus();
      })
      .then((fn) => unlistens.push(fn))
      .catch(() => {});

    void listen<ClipboardEntryDto>("clipboard:entry-added", () => {
      void qc.invalidateQueries({ queryKey: ["clipboard", "history"] });
    }).then((fn) => unlistens.push(fn));

    onCleanup(() => {
      if (blurTimer !== undefined) clearTimeout(blurTimer);
      for (const fn of unlistens) fn();
    });
    focusSearch();
  });

  const filterLabel = () => {
    const k = filterKind();
    if (k === "all") return tStr("clipboardHistory.filterAll");
    if (k === "text") return tStr("clipboardHistory.filterText");
    if (k === "files") return tStr("clipboardHistory.filterFiles");
    return tStr("clipboardHistory.filterImages");
  };

  return (
    <div class="flex size-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background/45 py-3 shadow-2xl">
      <div class="flex shrink-0 items-center justify-between gap-3 px-4">
        <div class="flex min-w-0 items-center gap-2">
          <span class="iconify mdi--clipboard-text-multiple size-4 shrink-0 text-primary" />
          <span class="truncate text-sm font-semibold">{tStr("clipboardHistory.title")}</span>
          <span class="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {filterLabel()}
          </span>
        </div>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void closeOverlay();
          }}
        >
          <span class="iconify mdi--close size-4" />
        </button>
      </div>

      <div class="mt-2.5 flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1 mx-4">
          <span class="iconify mdi--magnify size-4 shrink-0 opacity-50" />
          <input
            ref={searchRef}
            type="text"
            autofocus
            class="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={tStr("clipboardHistory.searchPlaceholder")}
            value={search()}
            onInput={(e) => {
              setSearch(e.currentTarget.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleListKeyDown}
          />
        </div>

        <div ref={listRef} class="mt-2.5 min-h-0 flex-1 overflow-y-auto px-4 py-0.5">
          <Show when={historyQ.isError}>
            <p class="px-3 py-8 text-center text-xs text-destructive">
              {(historyQ.error as Error)?.message ?? tStr("clipboardHistory.empty")}
            </p>
          </Show>
          <Show
            when={!historyQ.isLoading && !historyQ.isError && flatEntries().length > 0}
            fallback={
              <Show when={!historyQ.isLoading && !historyQ.isError}>
                <p class="px-3 py-8 text-center text-xs text-muted-foreground">
                  {tStr("clipboardHistory.empty")}
                </p>
              </Show>
            }
          >
            <For each={groups()}>
              {(group) => (
                <div class="mb-2 last:mb-0">
                  <div class="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    {group.label}
                  </div>
                  <div class="flex flex-col gap-1">
                    <For each={group.items}>
                      {(entry) => {
                        const globalIdx = () => entryIndexMap().get(entry.id) ?? 0;
                        return (
                          <ClipboardEntryRow
                            entry={entry}
                            selected={selectedIdx() === globalIdx()}
                            searchQuery={search()}
                            onPointerMove={() => setSelectedIdx(globalIdx())}
                            onApply={() => void applyEntry(entry)}
                          />
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="mx-4 mt-2.5 shrink-0 rounded-lg bg-muted/30 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
          {tStr("clipboardHistory.footerHints")}
        </div>

        <AlertDialog open={clearOpen()} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tStr("clipboardHistory.clearTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{tStr("clipboardHistory.clearDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="ghost" onClick={() => setClearOpen(false)}>
                {tStr("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  void (async () => {
                    const r = await clearClipboardHistory(true);
                    if (r.isErr()) toast.error(stableErrorMessage(tStr, r.error));
                    else void qc.invalidateQueries({ queryKey: ["clipboard", "history"] });
                    setClearOpen(false);
                  })();
                }}
              >
                {tStr("clipboardHistory.clearConfirm")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </div>
  );
};


