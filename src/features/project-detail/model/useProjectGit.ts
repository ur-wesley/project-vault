import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getGitStatus, gitPull, gitPush, gitInit, gitTagAndPush } from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { stableErrorMessage } from "~/lib/invoke-error";
import type { StableError } from "~/types/error";

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
    mutationFn: async (bump: "patch" | "minor" | "major") => {
      const r = await gitTagAndPush(props.projectId(), bump);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId()) });
      props.showInfoBanner(props.t("projectDetail.gitTagPushed", { tag: data.newTag }));
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
    tagAndPushMutate: (bump: "patch" | "minor" | "major") => tagMu.mutate(bump),
    isPulling: () => pullMu.isPending,
    isPushing: () => pushMu.isPending,
    isIniting: () => initMu.isPending,
    isTagging: () => tagMu.isPending,
  };
}
