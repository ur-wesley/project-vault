import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { listen } from "@tauri-apps/api/event";
import { toast } from "solid-sonner";

import { notify } from "~/lib/notification-store";
import { getIndexMeta, indexProject, rebuildIndex, searchProject } from "~/services/tauri/search";
import { queryKeys } from "~/services/query-keys";
import type { useI18n } from "~/lib/i18n-context";

type T = ReturnType<typeof useI18n>["t"];

/**
 * File search + index domain: debounced query, index lifecycle, result
 * ranking. (Extracted verbatim from FileTree.)
 */
export function createFileSearchModel(opts: { projectId: string; t: T }) {
  const { projectId, t } = opts;
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeQuery, setActiveQuery] = createSignal("");
  const [indexBusy, setIndexBusy] = createSignal(false);

  const indexMetaQ = createQuery(() => ({
    queryKey: queryKeys.projectIndexMeta(projectId),
    queryFn: async () => {
      const r = await getIndexMeta(projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  // Auto-build or rebuild index when component mounts
  createEffect(() => {
    const meta = indexMetaQ.data;
    if (indexBusy()) return;
    if (!meta) {
      setIndexBusy(true);
      void indexProject(projectId).then(
        () => setIndexBusy(false),
        () => setIndexBusy(false),
      );
      return;
    }
    const ONE_HOUR = 60 * 60 * 1000;
    if (meta.lastUpdatedMs && Date.now() - meta.lastUpdatedMs > ONE_HOUR) {
      setIndexBusy(true);
      void rebuildIndex(projectId).then(
        () => setIndexBusy(false),
        () => setIndexBusy(false),
      );
    }
  });

  const searchQ = createQuery(() => ({
    queryKey: queryKeys.projectSearch(projectId, activeQuery()),
    queryFn: async () => {
      const q = activeQuery().trim();
      if (!q) return [];
      const r = await searchProject(projectId, q);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: activeQuery().trim().length > 0,
  }));

  // Listen for background index completion
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<{ projectId: string }>("index:built", (ev) => {
        if (ev.payload.projectId === projectId) {
          void indexMetaQ.refetch();
          // Re-run an in-flight search so the result list reflects the
          // freshly-built index without the user having to retype.
          if (activeQuery().trim().length > 0) {
            void searchQ.refetch();
          }
        }
      });
    })();
    onCleanup(() => {
      unlisten?.();
    });
  });

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  const onSearchInput = (value: string, onType?: () => void) => {
    setSearchQuery(value);
    onType?.();
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      setActiveQuery(value);
    }, 200);
  };

  const clearSearch = (onClear?: () => void) => {
    setSearchQuery("");
    setActiveQuery("");
    onClear?.();
  };

  const onIndexProject = async () => {
    setIndexBusy(true);
    try {
      const r = await indexProject(projectId);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      notify({
        severity: "success",
        title: t("projectDetail.indexProject") as string,
        source: "Search",
        system: "auto",
      });
      void indexMetaQ.refetch();
    } finally {
      setIndexBusy(false);
    }
  };

  const onRebuildIndex = async () => {
    setIndexBusy(true);
    try {
      const r = await rebuildIndex(projectId);
      if (r.isErr()) {
        toast.error(r.error.message);
        return;
      }
      notify({
        severity: "success",
        title: t("projectDetail.rebuildIndex") as string,
        source: "Search",
        system: "auto",
      });
      void indexMetaQ.refetch();
    } finally {
      setIndexBusy(false);
    }
  };

  const isSearching = () => activeQuery().trim().length > 0;

  // Sort by score (highest first) and include path-only matches. The backend
  // is the source of truth for what counts as a hit; the frontend only orders.
  const filteredHits = createMemo(() => {
    const data = searchQ.data;
    if (!data) return [];
    return [...data].sort((a, b) => b.score - a.score);
  });

  const topScore = createMemo(() => {
    const data = searchQ.data;
    if (!data || data.length === 0) return 0;
    return Math.max(...data.map((h) => h.score));
  });

  return {
    searchQuery,
    activeQuery,
    indexBusy,
    indexMetaQ,
    searchQ,
    onSearchInput,
    clearSearch,
    onIndexProject,
    onRebuildIndex,
    isSearching,
    filteredHits,
    topScore,
  };
}
