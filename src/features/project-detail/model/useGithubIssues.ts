import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  closeIssue,
  createIssue,
  listRepoIssues,
  listRepoLabels,
  updateIssue,
  createLabel,
  type GitHubIssueRow,
} from "~/services/github";
import {
  listIssues,
  createIssueLocal,
  updateIssueLocal,
  deleteAllLocalIssues,
  type LocalIssueDto,
} from "~/services/tauri/issues";
import { queryKeys } from "~/services/query-keys";


export type ExtendedIssueRow = GitHubIssueRow & { isLocal: boolean };

export type UseGithubIssuesProps = {
  projectId: () => string;
  github: () => { owner: string; repo: string } | null;
  t: (key: string, args?: any) => string;
  setMutationError: (msg: string | null) => void;
  onIssueCreated?: (issue: ExtendedIssueRow) => void;
  onIssueUpdated?: (issue: ExtendedIssueRow) => void;
  selectedLabels: () => string[];
};

function localToGithubIssue(i: LocalIssueDto): GitHubIssueRow {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    htmlUrl: "",
    state: i.state as "open" | "closed",
    userLogin: "local",
    updatedAt: i.updatedAtMs > 0 ? new Date(i.updatedAtMs).toISOString() : new Date().toISOString(),
    labels: i.tags.map((name) => ({ name, color: "cccccc" })),
  };
}

function localToExtended(i: LocalIssueDto): ExtendedIssueRow {
  return { ...localToGithubIssue(i), isLocal: true };
}

function githubToExtended(i: GitHubIssueRow): ExtendedIssueRow {
  return { ...i, isLocal: false };
}

export function useGithubIssues(props: UseGithubIssuesProps) {
  const qc = useQueryClient();

  const issuesQueryKey = createMemo(() => [
    ...queryKeys.githubProjectIssues(props.projectId()),
    props.github()?.owner,
    props.github()?.repo,
  ]);

  const rawLabelsQ = createQuery(() => ({
    queryKey: ["github", "labels", props.github()?.owner, props.github()?.repo, props.projectId()],
    queryFn: async () => {
      const g = props.github();
      if (!g) {
        // For local issues, aggregate from existing local issues
        const r = await listIssues(props.projectId());
        if (r.isErr()) return [];
        const tags = new Set<string>();
        for (const issue of r.value) {
          for (const tag of issue.tags) {
            tags.add(tag);
          }
        }
        return Array.from(tags).map((name) => ({ name, color: "cccccc" }));
      }
      const r = await listRepoLabels(g.owner, g.repo);
      if (r.isErr()) throw r.error;
      return r.value;
    },
  }));

  // Aggregated labels for the UI: rawLabels + any newly added selected labels
  const labels = createMemo(() => {
    const raw = rawLabelsQ.data ?? [];
    const selected = props.selectedLabels();
    const result = [...raw];
    for (const name of selected) {
      if (!result.some((l) => l.name === name)) {
        result.push({ name, color: "cccccc" });
      }
    }
    return result;
  });

  const ensureLabelsExist = async (owner: string, repo: string, labelsToEnsure: string[]) => {
    // Only check against labels that actually exist on GitHub
    const existing = rawLabelsQ.data ?? [];
    for (const name of labelsToEnsure) {
      if (!existing.some((l) => l.name === name)) {
        await createLabel(owner, repo, name);
      }
    }
  };

  const issuesQ = createQuery(() => ({
    queryKey: [
      ...queryKeys.githubProjectIssues(props.projectId()),
      props.github()?.owner,
      props.github()?.repo,
    ],
    queryFn: async () => {
      const g = props.github();
      if (g == null) {
        const r = await listIssues(props.projectId());
        if (r.isErr()) throw r.error;
        return r.value.map(localToExtended);
      }
      
      // Fetch BOTH
      const [localRes, githubRes] = await Promise.all([
        listIssues(props.projectId()),
        listRepoIssues(g.owner, g.repo)
      ]);
      
      const locals = localRes.isOk() ? localRes.value.map(localToExtended) : [];
      const githubs = githubRes.isOk() ? githubRes.value.map(githubToExtended) : [];
      
      return [...locals, ...githubs].sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));

  const localIssuesQ = createQuery(() => ({
    queryKey: ["projects", props.projectId(), "local-issues-only"],
    queryFn: async () => {
      const r = await listIssues(props.projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    // Always fetch this if we have a GitHub remote, so we can show the sync prompt
    enabled: props.github() != null,
  }));

  const syncM = createMutation(() => ({
    mutationFn: async () => {
      const g = props.github();
      if (!g) throw new Error("No GitHub remote configured");
      
      const r = await listIssues(props.projectId());
      if (r.isErr()) throw r.error;
      const locals = r.value;

      for (const issue of locals) {
        await ensureLabelsExist(g.owner, g.repo, issue.tags);
        const cr = await createIssue(g.owner, g.repo, issue.title, issue.body ?? "", issue.tags);
        if (cr.isErr()) throw cr.error;
        
        if (issue.state === "closed") {
            const up = await closeIssue(g.owner, g.repo, cr.value.number);
            if (up.isErr()) throw up.error;
        }
      }

      const dr = await deleteAllLocalIssues(props.projectId());
      if (dr.isErr()) throw dr.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: issuesQueryKey() });
      void localIssuesQ.refetch();
      void rawLabelsQ.refetch();
    },
    onError: (err: any) => {
      props.setMutationError(stableErrorMessage(props.t, err));
    },
  }));

  const createM = createMutation(() => ({
    mutationFn: async (args: { title: string; body: string; labels: string[]; local?: boolean }) => {
      const g = props.github();
      if (!g || args.local) {
        const r = await createIssueLocal(props.projectId(), {
          title: args.title,
          body: args.body,
          tags: args.labels,
        });
        if (r.isErr()) throw r.error;
        return localToExtended(r.value);
      }
      await ensureLabelsExist(g.owner, g.repo, args.labels);
      const r = await createIssue(g.owner, g.repo, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return githubToExtended(r.value);
    },
    onMutate: async (newIssue) => {
      props.setMutationError(null);
      const queryKey = issuesQueryKey();
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<ExtendedIssueRow[]>(queryKey) ?? [];

      const ghViewer = qc.getQueryData<{ login: string }>(queryKeys.githubViewer());
      const tempId = Math.random() * -1000;
      const tempIssue: ExtendedIssueRow = {
        number: tempId,
        title: newIssue.title,
        body: newIssue.body,
        htmlUrl: "",
        state: "open",
        userLogin: ghViewer?.login ?? "local",
        updatedAt: new Date().toISOString(),
        labels: newIssue.labels.map((name) => ({ name, color: "cccccc" })),
        isPending: true,
        isLocal: newIssue.local ?? false,
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
        qc.setQueryData<ExtendedIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [data];
          return old.map((i) => (i.number === context.tempId ? data : i));
        });
        void qc.invalidateQueries({ queryKey: context.queryKey });
      }
      void rawLabelsQ.refetch();
      void localIssuesQ.refetch();
      props.onIssueCreated?.(data);
    },
  }));

  const updateM = createMutation(() => ({
    mutationFn: async (args: { number: number; title: string; body: string; labels: string[]; isLocal: boolean }) => {
      const g = props.github();
      if (!g || args.isLocal) {
        const r = await updateIssueLocal(props.projectId(), args.number, {
          title: args.title,
          body: args.body,
          tags: args.labels,
        });
        if (r.isErr()) throw r.error;
        return localToExtended(r.value);
      }
      await ensureLabelsExist(g.owner, g.repo, args.labels);
      const r = await updateIssue(g.owner, g.repo, args.number, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return githubToExtended(r.value);
    },
    onMutate: async (updatedIssue) => {
      props.setMutationError(null);
      const queryKey = issuesQueryKey();
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<ExtendedIssueRow[]>(queryKey);

      if (previousIssues) {
        qc.setQueryData(
          queryKey,
          previousIssues.map((i) =>
            i.number === updatedIssue.number && i.isLocal === updatedIssue.isLocal
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
        qc.setQueryData<ExtendedIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [data];
          return old.map((i) => (i.number === data.number && i.isLocal === data.isLocal ? data : i));
        });
        void qc.invalidateQueries({ queryKey: context.queryKey });
      }
      void rawLabelsQ.refetch();
      void localIssuesQ.refetch();
      props.onIssueUpdated?.(data);
    },
  }));

  const closeM = createMutation(() => ({
    mutationFn: async (args: { number: number; isLocal: boolean }) => {
      const g = props.github();
      if (!g || args.isLocal) {
        const r = await updateIssueLocal(props.projectId(), args.number, {
          state: "closed",
        });
        if (r.isErr()) throw r.error;
        return localToExtended(r.value);
      }
      const r = await closeIssue(g.owner, g.repo, args.number);
      if (r.isErr()) throw r.error;
      return { number: args.number, isLocal: false } as any; 
    },
    onMutate: async (args) => {
      props.setMutationError(null);
      const queryKey = issuesQueryKey();
      await qc.cancelQueries({ queryKey });
      const previousIssues = qc.getQueryData<ExtendedIssueRow[]>(queryKey);

      if (previousIssues) {
        qc.setQueryData(
          queryKey,
          previousIssues.map((i) =>
            i.number === args.number && i.isLocal === args.isLocal ? { ...i, state: "closed" as const, isPending: true } : i,
          ),
        );
      }

      return { previousIssues, queryKey };
    },
    onError: (err: any, _args, context) => {
      props.setMutationError(stableErrorMessage(props.t, err));
      if (context?.previousIssues) {
        qc.setQueryData(context.queryKey, context.previousIssues);
      }
    },
    onSuccess: (_data, args, context) => {
      if (context?.queryKey) {
        qc.setQueryData<ExtendedIssueRow[]>(context.queryKey, (old) => {
          if (!old) return [];
          return old.map((i) =>
            i.number === args.number && i.isLocal === args.isLocal ? { ...i, state: "closed" as const, isPending: false } : i,
          );
        });
        void qc.invalidateQueries({ queryKey: context.queryKey });
      }
      void localIssuesQ.refetch();
    },
  }));

  return {
    labels,
    issuesQ,
    localIssuesQ,
    syncM,
    createM,
    updateM,
    closeM,
  };
}
