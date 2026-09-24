import { ResultAsync } from "neverthrow";

import { loadToken } from "~/services/github";
import { isRecord, isStableError } from "~/lib/guards";
import type { StableError } from "~/types/error";

export type GitHubActionRun = Readonly<{
  id: number;
  name: string | null;
  displayTitle: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}>;

export type GitHubWorkflow = Readonly<{
  id: number;
  name: string;
  path: string;
  state: string;
  htmlUrl: string | null;
}>;

async function actionsFetch(path: string): Promise<Response> {
  const token = await loadToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

function runDisplayTitle(r: Record<string, unknown>): string {
  if (typeof r.display_title === "string") return r.display_title;
  const headCommit = isRecord(r.head_commit) ? r.head_commit : undefined;
  if (typeof headCommit?.message === "string") return headCommit.message;
  const n = typeof r.run_number === "number" ? r.run_number : null;
  const id = typeof r.id === "number" ? r.id : 0;
  return `#${n ?? id}`;
}

function workflowName(w: Record<string, unknown>, id: number): string {
  if (typeof w.name === "string") return w.name;
  if (typeof w.path === "string") return w.path;
  return `workflow-${id}`;
}

function toStable(e: unknown, message: string): StableError {
  if (isStableError(e)) return e;
  if (e instanceof Error) return { code: "INVOKE_FAILED", message: e.message };
  return { code: "INVOKE_FAILED", message };
}

function authError(res: Response): StableError {
  if (res.status === 401 || res.status === 403) {
    return {
      code: "GITHUB_UNAUTHORIZED",
      message: "Unauthorized or rate limited by GitHub.",
    };
  }
  if (res.status === 404) {
    return {
      code: "NOT_FOUND",
      message: "Repository or Actions data not found.",
    };
  }
  return { code: "INVOKE_FAILED", message: "Could not load Actions status." };
}

export function listWorkflowRuns(
  owner: string,
  repo: string,
  perPage = 5,
): ResultAsync<readonly GitHubActionRun[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await actionsFetch(`/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`);
      if (!res.ok) throw authError(res);
      const data: unknown = await res.json();
      const runs: unknown[] = Array.isArray(isRecord(data) ? data.workflow_runs : undefined)
        ? (data as { workflow_runs: unknown[] }).workflow_runs
        : [];
      return runs.map((entry): GitHubActionRun => {
        const r = isRecord(entry) ? entry : {};
        return {
          id: typeof r.id === "number" ? r.id : 0,
          name: typeof r.name === "string" ? r.name : null,
          displayTitle: runDisplayTitle(r),
          event: typeof r.event === "string" ? r.event : "unknown",
          status: typeof r.status === "string" ? r.status : null,
          conclusion: typeof r.conclusion === "string" ? r.conclusion : null,
          branch: typeof r.head_branch === "string" ? r.head_branch : null,
          createdAt: typeof r.created_at === "string" ? r.created_at : "",
          updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
          htmlUrl: typeof r.html_url === "string" ? r.html_url : "",
        };
      });
    })(),
    (e) => toStable(e, "Could not load Actions status."),
  );
}

export function listWorkflows(
  owner: string,
  repo: string,
): ResultAsync<readonly GitHubWorkflow[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await actionsFetch(`/repos/${owner}/${repo}/actions/workflows`);
      if (!res.ok) throw authError(res);
      const data: unknown = await res.json();
      const workflows: unknown[] = Array.isArray(isRecord(data) ? data.workflows : undefined)
        ? (data as { workflows: unknown[] }).workflows
        : [];
      return workflows.map((entry): GitHubWorkflow => {
        const w = isRecord(entry) ? entry : {};
        const id = typeof w.id === "number" ? w.id : 0;
        return {
          id,
          name: workflowName(w, id),
          path: typeof w.path === "string" ? w.path : "",
          state: typeof w.state === "string" ? w.state : "unknown",
          htmlUrl: typeof w.html_url === "string" ? w.html_url : null,
        };
      });
    })(),
    (e) => toStable(e, "Could not load workflows."),
  );
}

export function latestRunStatus(
  runs: readonly GitHubActionRun[] | undefined,
): "success" | "failure" | "running" | "unknown" {
  const latest = runs?.[0];
  if (!latest) return "unknown";
  if (
    latest.status === "in_progress" ||
    latest.status === "queued" ||
    latest.status === "waiting"
  ) {
    return "running";
  }
  if (latest.conclusion === "success") return "success";
  if (latest.conclusion === "failure" || latest.conclusion === "timed_out") {
    return "failure";
  }
  return "unknown";
}
