import {
  createMutation,
  createQuery,
  keepPreviousData,
  useQueryClient,
} from "@tanstack/solid-query";
import { listen } from "@tauri-apps/api/event";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import {
  beadsAddComment,
  beadsCreateIssue,
  beadsGetStatus,
  beadsInit,
  beadsListIssues,
  beadsUpdateIssueStatus,
  startBeadsWatcher,
  stopBeadsWatcher,
} from "~/services/tauri/beads";
import type {
  AddBeadCommentInput,
  BeadIssueDto,
  BeadsStatusDto,
  CreateBeadInput,
  UpdateBeadStatusInput,
} from "~/types/dto/beads";
import { EMPTY_BEADS_FILTERS, type BeadsFilters, type BeadsViewLayout } from "./types";

export function useBeads(projectId: Accessor<string>, projectPath: Accessor<string>) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const [filters, setFilters] = createSignal<BeadsFilters>({ ...EMPTY_BEADS_FILTERS });
  const [layout, setLayout] = createSignal<BeadsViewLayout>("board");
  const [selectedIssueId, setSelectedIssueId] = createSignal<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = createSignal(false);

  // Status query (cheap: backend serves the cached `bd --version`, so the hot
  // path spawns zero processes. `issueCount` is deprecated best-effort 0 —
  // use `issuesQ.data.length` for badge counts.)
  const statusQ = createQuery(() => ({
    queryKey: ["beads-status", projectId()],
    queryFn: async (): Promise<BeadsStatusDto> => {
      const path = projectPath();
      if (!path) return { installed: false, initialized: false, version: null, issueCount: 0 };
      const r = await beadsGetStatus(path);
      if (r.isErr()) {
        console.error("[useBeads] beadsGetStatus failed:", r.error);
        return { installed: false, initialized: false, version: null, issueCount: 0 };
      }
      return r.value;
    },
    enabled: Boolean(projectPath()),
    retry: false,
    staleTime: 10_000,
  }));

  // Issues query (heaviest spawn: `bd list`. 5s cache + keep previous rows
  // while refetching so bursts don't flash the board empty.)
  const issuesQ = createQuery(() => ({
    queryKey: ["beads-issues", projectId()],
    queryFn: async (): Promise<BeadIssueDto[]> => {
      const path = projectPath();
      if (!path) return [];
      const r = await beadsListIssues(path);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: Boolean(projectPath() && statusQ.data?.initialized),
    retry: false,
    staleTime: 5000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  }));

  // Coalesced invalidation: watcher bursts collapse into one refetch per
  // 150ms window. Issues always; status only when init state may have flipped.
  let invalidateTimer: number | undefined;
  const debouncedInvalidate = (includeStatus: boolean) => {
    if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
    invalidateTimer = window.setTimeout(() => {
      invalidateTimer = undefined;
      const pid = projectId();
      void qc.invalidateQueries({ queryKey: ["beads-issues", pid] });
      if (includeStatus) void qc.invalidateQueries({ queryKey: ["beads-status", pid] });
    }, 150);
  };
  onCleanup(() => {
    if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
  });

  // Real-time filesystem watcher
  createEffect(() => {
    const pid = projectId();
    const ppath = projectPath();
    if (!pid || !ppath) return;

    void startBeadsWatcher(pid, ppath);

    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<{ projectId: string }>("beads:changed", (ev) => {
        // Single debounced issues refetch; do NOT also invalidate status here
        // (that doubled every watcher event into two `bd` spawns).
        if (ev.payload.projectId === pid) debouncedInvalidate(false);
      });
    })();

    onCleanup(() => {
      if (unlisten) unlisten();
      void stopBeadsWatcher(pid);
    });
  });

  // Safety net: issues failed while status claims initialized (e.g. `.beads`
  // removed externally) — re-check status once so the flag can flip.
  createEffect(() => {
    if (issuesQ.isError && statusQ.data?.initialized) {
      void qc.invalidateQueries({ queryKey: ["beads-status", projectId()] });
    }
  });

  const invalidate = (includeStatus = false) => {
    const pid = projectId();
    void qc.invalidateQueries({ queryKey: ["beads-issues", pid] });
    if (includeStatus) void qc.invalidateQueries({ queryKey: ["beads-status", pid] });
  };

  // Mutation: Init Beads
  const initMu = createMutation(() => ({
    mutationFn: async () => {
      const path = projectPath();
      const r = await beadsInit(path);
      if (r.isErr()) throw new Error(r.error.message);
    },
    onSuccess: () => {
      notify({
        title: t("beads.initSuccess") as string,
        severity: "success",
      });
      invalidate(true);
    },
    onError: (err: Error) => {
      notify({
        title: t("beads.initFailed") as string,
        body: err.message,
        severity: "error",
      });
    },
  }));

  // Mutation: Update status
  const updateStatusMu = createMutation(() => ({
    mutationFn: async (input: Omit<UpdateBeadStatusInput, "projectPath">) => {
      const path = projectPath();
      const r = await beadsUpdateIssueStatus({
        ...input,
        projectPath: path,
      });
      if (r.isErr()) throw new Error(r.error.message);
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err: Error) => {
      notify({
        title: t("beads.updateFailed") as string,
        body: err.message,
        severity: "error",
      });
    },
  }));

  // Mutation: Create issue
  const createIssueMu = createMutation(() => ({
    mutationFn: async (input: Omit<CreateBeadInput, "projectPath">) => {
      const path = projectPath();
      const r = await beadsCreateIssue({
        ...input,
        projectPath: path,
      });
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    onSuccess: (newIssue) => {
      notify({
        title: t("beads.createSuccess") as string,
        body: `#${newIssue.id}: ${newIssue.title}`,
        severity: "success",
      });
      setIsCreateOpen(false);
      invalidate();
    },
    onError: (err: Error) => {
      notify({
        title: t("beads.createFailed") as string,
        body: err.message,
        severity: "error",
      });
    },
  }));

  // Mutation: Add comment
  const addCommentMu = createMutation(() => ({
    mutationFn: async (input: Omit<AddBeadCommentInput, "projectPath">) => {
      const path = projectPath();
      const r = await beadsAddComment({
        ...input,
        projectPath: path,
      });
      if (r.isErr()) throw new Error(r.error.message);
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err: Error) => {
      notify({
        title: t("beads.commentFailed") as string,
        body: err.message,
        severity: "error",
      });
    },
  }));

  return {
    statusQ,
    issuesQ,
    filters,
    setFilters,
    layout,
    setLayout,
    selectedIssueId,
    setSelectedIssueId,
    isCreateOpen,
    setIsCreateOpen,
    initMu,
    updateStatusMu,
    createIssueMu,
    addCommentMu,
    refresh: () => invalidate(true),
  };
}

export type BeadsModel = ReturnType<typeof useBeads>;
