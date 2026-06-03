import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import {
  getGitStatus,
  gitPull,
  gitPush,
  gitInit,
  gitTagAndPush,
  gitPreviewVersions,
  gitDiscoverVersionFiles,
  gitBumpVersionAndTag,
  gitCleanPreview,
  gitCleanExecute,
  gitFetch,
  gitIncoming,
} from "~/services/tauri/git";
import { queryKeys } from "~/services/query-keys";
import { stableErrorMessage } from "~/lib/invoke-error";


export type UseProjectGitProps = Readonly<{
  projectId: Accessor<string>;
  isFocused: Accessor<boolean>;
  t: (key: string, args?: any) => string;
  showBanner: (msg: string) => void;
  showInfoBanner: (msg: string) => void;
}>;

export function useProjectGit(props: UseProjectGitProps) {
  const qc = useQueryClient();

  const gitStatusQ = createQuery(() => ({
    queryKey: queryKeys.gitStatus(props.projectId()),
    queryFn: async () => {
      const r = await getGitStatus(props.projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: props.isFocused() ? 10_000 : 1_000 * 60,
    refetchOnWindowFocus: true,
  }));

  const gitIncomingQ = createQuery(() => ({
    queryKey: queryKeys.gitIncoming(props.projectId()),
    queryFn: async () => {
      const r = await gitIncoming(props.projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 30,
  }));

  async function fetchAndRefresh() {
    const r = await gitFetch(props.projectId());
    if (r.isErr()) {
      props.showBanner(stableErrorMessage(props.t, r.error));
      return;
    }
    await qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
    await qc.invalidateQueries({ queryKey: queryKeys.gitIncoming(props.projectId()) });
    await qc.invalidateQueries({ queryKey: ["git", "preview-versions", props.projectId()] });
  }

  const pullMu = createMutation(() => ({
    mutationFn: async () => {
      const r = await gitPull(props.projectId());
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      props.showInfoBanner("Git pull successful.");
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const pushMu = createMutation(() => ({
    mutationFn: async () => {
      const r = await gitPush(props.projectId());
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      props.showInfoBanner("Git push successful.");
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const initMu = createMutation(() => ({
    mutationFn: async () => {
      const r = await gitInit(props.projectId());
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      props.showInfoBanner("Git repository initialized.");
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const tagMu = createMutation(() => ({
    mutationFn: async (bump: "patch" | "minor" | "major" | "beta") => {
      const r = await gitTagAndPush(props.projectId(), bump);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      void qc.invalidateQueries({ queryKey: ["git", "preview-versions", props.projectId()] });
      props.showInfoBanner(props.t("projectDetail.gitTagPushed", { tag: data.newTag }));
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const isGitRepository = () => gitStatusQ.isSuccess && gitStatusQ.data != null;

  const previewVersionsQ = createQuery(() => ({
    queryKey: ["git", "preview-versions", props.projectId()] as const,
    queryFn: async () => {
      const r = await gitPreviewVersions(props.projectId());
      if (r.isErr()) {
        if (r.error.code === "INVALID_PATH") return null;
        throw r.error;
      }
      return r.value;
    },
    enabled: isGitRepository(),
    retry: false,
    staleTime: 1000 * 60 * 5,
    refetchInterval: (() => {
      if (!isGitRepository()) return false;
      return props.isFocused() ? 10_000 : 1_000 * 60;
    })(),
    refetchOnWindowFocus: isGitRepository(),
  }));

  const discoverFilesMu = createMutation(() => ({
    mutationFn: async (bump: "patch" | "minor" | "major" | "beta") => {
      const r = await gitDiscoverVersionFiles(props.projectId(), bump);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const bumpVersionMu = createMutation(() => ({
    mutationFn: async (payload: { bump: "patch" | "minor" | "major" | "beta"; files: string[] }) => {
      const r = await gitBumpVersionAndTag(props.projectId(), payload);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      void qc.invalidateQueries({ queryKey: ["git", "preview-versions", props.projectId()] });
      props.showInfoBanner(props.t("projectDetail.gitTagPushed", { tag: data.newTag }));
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const cleanPreviewMu = createMutation(() => ({
    mutationFn: async () => {
      console.log("[cleanPreviewMu] mutationFn called, projectId:", props.projectId());
      const r = await gitCleanPreview(props.projectId());
      console.log("[cleanPreviewMu] gitCleanPreview returned:", r);
      if (r.isErr()) {
        console.error("[cleanPreviewMu] gitCleanPreview error:", r.error);
        throw r.error;
      }
      console.log("[cleanPreviewMu] success, value:", r.value);
      return r.value;
    },
    onError: (err: unknown) => {
      console.error("[cleanPreviewMu] onError:", err);
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  const cleanMu = createMutation(() => ({
    mutationFn: async (payload: { resetTracked: boolean; selectedPaths: string[] }) => {
      const r = await gitCleanExecute(props.projectId(), payload.resetTracked, payload.selectedPaths);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
      props.showInfoBanner(props.t("projectDetail.cleanSuccess"));
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as any));
    },
  }));

  return {
    gitStatusQ,
    gitIncomingQ,
    fetchAndRefresh,
    pullMutate: () => pullMu.mutate(),
    pushMutate: () => pushMu.mutate(),
    initMutate: () => initMu.mutate(),
    tagAndPushMutate: (bump: "patch" | "minor" | "major" | "beta") => tagMu.mutate(bump),
    previewVersionsQ,
    fetchPreviewVersions: () => {
      if (!isGitRepository()) return Promise.resolve();
      return previewVersionsQ.refetch();
    },
    discoverVersionFiles: (bump: "patch" | "minor" | "major" | "beta") => discoverFilesMu.mutateAsync(bump),
    bumpVersionAndTag: (payload: { bump: "patch" | "minor" | "major" | "beta"; files: string[] }) => bumpVersionMu.mutate(payload),
    isPulling: () => pullMu.isPending,
    isPushing: () => pushMu.isPending,
    isIniting: () => initMu.isPending,
    isTagging: () => tagMu.isPending,
    isPreviewingVersions: () => previewVersionsQ.isFetching,
    isDiscoveringFiles: () => discoverFilesMu.isPending,
    isBumpingVersion: () => bumpVersionMu.isPending,
    cleanPreview: () => cleanPreviewMu.mutateAsync(),
    cleanExecute: (payload: { resetTracked: boolean; selectedPaths: string[] }) => cleanMu.mutateAsync(payload),
    isCleaningPreview: () => cleanPreviewMu.isPending,
    isCleaning: () => cleanMu.isPending,
  };
}
