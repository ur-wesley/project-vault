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
} from "~/services/tauri/git";
import { queryKeys } from "~/services/query-keys";
import { stableErrorMessage } from "~/lib/invoke-error";


export type UseProjectGitProps = Readonly<{
  projectId: Accessor<string>;
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
    refetchInterval: 1000 * 60,
  }));

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

  const previewVersionsQ = createQuery(() => ({
    queryKey: ["git", "preview-versions", props.projectId()] as const,
    queryFn: async () => {
      const r = await gitPreviewVersions(props.projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: true,
    staleTime: 1000 * 60 * 5,
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
      const r = await gitCleanPreview(props.projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onError: (err: unknown) => {
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
    pullMutate: () => pullMu.mutate(),
    pushMutate: () => pushMu.mutate(),
    initMutate: () => initMu.mutate(),
    tagAndPushMutate: (bump: "patch" | "minor" | "major" | "beta") => tagMu.mutate(bump),
    previewVersionsQ,
    fetchPreviewVersions: () => previewVersionsQ.refetch(),
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
