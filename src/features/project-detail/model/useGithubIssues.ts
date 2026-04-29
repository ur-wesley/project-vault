import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  closeIssue,
  createIssue,
  listRepoIssues,
  listRepoLabels,
  updateIssue,
  type GitHubIssueRow,
} from "~/services/github";
import { queryKeys } from "~/services/query-keys";
import type { StableError } from "~/types/error";

export type UseGithubIssuesProps = {
  projectId: () => string;
  github: () => { owner: string; repo: string } | null;
  t: (key: string, args?: any) => string;
  setMutationError: (msg: string | null) => void;
  onIssueCreated?: (issue: GitHubIssueRow) => void;
  onIssueUpdated?: (issue: GitHubIssueRow) => void;
};

export function useGithubIssues(props: UseGithubIssuesProps) {
  const qc = useQueryClient();

  const labelsQ = createQuery(() => ({
    queryKey: ["github", "labels", props.github()?.owner, props.github()?.repo],
    queryFn: async () => {
      const g = props.github();
      if (!g) return [];
      const r = await listRepoLabels(g.owner, g.repo);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: props.github() != null,
  }));

  const issuesQ = createQuery(() => ({
    queryKey: queryKeys.githubProjectIssues(props.projectId()),
    queryFn: async () => {
      const g = props.github();
      if (g == null) throw { code: "INVOKE_FAILED", message: "No GitHub remote." };
      const r = await listRepoIssues(g.owner, g.repo);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: props.github() != null,
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));

  const createM = createMutation(() => ({
    mutationFn: async (args: { title: string; body: string; labels: string[] }) => {
      const g = props.github();
      if (!g) throw new Error("No remote");
      const r = await createIssue(g.owner, g.repo, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onMutate: async (newIssue) => {
      props.setMutationError(null);
      const queryKey = queryKeys.githubProjectIssues(props.projectId());
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<GitHubIssueRow[]>(queryKey) ?? [];

      const ghViewer = qc.getQueryData<{ login: string }>(queryKeys.githubViewer());
      const tempId = Math.random() * -1000;
      const tempIssue: GitHubIssueRow = {
        number: tempId,
        title: newIssue.title,
        body: newIssue.body,
        htmlUrl: "",
        state: "open",
        userLogin: ghViewer?.login ?? "you",
        updatedAt: new Date().toISOString(),
        labels: newIssue.labels.map(name => ({ name, color: "cccccc" })),
        isPending: true,
      };

      qc.setQueryData(queryKey, [tempIssue, ...previousIssues]);

      return { previousIssues, queryKey, tempId };
    },
    onError: (err: any, _newIssue, context) => {
      props.setMutationError(stableErrorMessage(props.t, err));
      if (context?.previousIssues) {
        qc.setQueryData(context.queryKey, context.previousIssues);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.queryKey) {
        qc.setQueryData<GitHubIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [data];
          return old.map(i => i.number === context.tempId ? data : i);
        });
      }
      props.onIssueCreated?.(data);
    },
  }));

  const updateM = createMutation(() => ({
    mutationFn: async (args: { number: number; title: string; body: string; labels: string[] }) => {
      const g = props.github();
      if (!g) throw new Error("No remote");
      const r = await updateIssue(g.owner, g.repo, args.number, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onMutate: async (updatedIssue) => {
      props.setMutationError(null);
      const queryKey = queryKeys.githubProjectIssues(props.projectId());
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<GitHubIssueRow[]>(queryKey);

      if (previousIssues) {
        qc.setQueryData(
          queryKey,
          previousIssues.map((i) =>
            i.number === updatedIssue.number
              ? {
                  ...i,
                  title: updatedIssue.title,
                  body: updatedIssue.body,
                  labels: updatedIssue.labels.map((name) => ({ name, color: "cccccc" })),
                  updatedAt: new Date().toISOString(),
                  isPending: true,
                }
              : i,
          ),
        );
      }

      return { previousIssues, queryKey };
    },
    onError: (err: any, _updatedIssue, context) => {
      props.setMutationError(stableErrorMessage(props.t, err));
      if (context?.previousIssues) {
        qc.setQueryData(context.queryKey, context.previousIssues);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.queryKey) {
        qc.setQueryData<GitHubIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [data];
          return old.map(i => i.number === data.number ? data : i);
        });
      }
      props.onIssueUpdated?.(data);
    },
  }));

  const closeM = createMutation(() => ({
    mutationFn: async (number: number) => {
      const g = props.github();
      if (!g) throw new Error("No remote");
      const r = await closeIssue(g.owner, g.repo, number);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onMutate: async (number) => {
      props.setMutationError(null);
      const queryKey = queryKeys.githubProjectIssues(props.projectId());
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<GitHubIssueRow[]>(queryKey);

      if (previousIssues) {
        qc.setQueryData(
          queryKey,
          previousIssues.map((i) =>
            i.number === number ? { ...i, state: "closed" as const, isPending: true } : i,
          ),
        );
      }

      return { previousIssues, queryKey };
    },
    onError: (err: any, _number, context) => {
      props.setMutationError(stableErrorMessage(props.t, err));
      if (context?.previousIssues) {
        qc.setQueryData(context.queryKey, context.previousIssues);
      }
    },
    onSuccess: (_data, number, context) => {
      if (context?.queryKey) {
        qc.setQueryData<GitHubIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [];
          return old.map(i => i.number === number ? { ...i, state: "closed" as const, isPending: false } : i);
        });
      }
    },
  }));

  return {
    labelsQ,
    issuesQ,
    createM,
    updateM,
    closeM,
  };
}
