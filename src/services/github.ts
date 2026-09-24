import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { ResultAsync } from "neverthrow";

import { renderMarkdownHtml } from "~/services/markdown";
import { mapInvokeError } from "~/services/tauri/utils";
import { getSetting } from "~/services/tauri/settings";
import { isRecord } from "~/lib/guards";
import type { StableError } from "~/types/error";

export const GITHUB_TOKEN_SETTING_KEY = "github_token";

export type GitHubLabel = { name: string; color: string };

export type GitHubIssueRow = Readonly<{
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  state: "open" | "closed";
  userLogin: string | null;
  updatedAt: string;
  labels: { name: string; color: string }[];
  isPending?: boolean; // For optimistic updates
}>;

type GitHubLabelApi = string | { name?: unknown; color?: unknown };

function mapLabel(l: unknown): GitHubLabel {
  if (typeof l === "string") return { name: l, color: "cccccc" };
  if (isRecord(l)) {
    return {
      name: typeof l.name === "string" ? l.name : "",
      color: typeof l.color === "string" ? l.color : "cccccc",
    };
  }
  return { name: "", color: "cccccc" };
}

function mapLabels(labels: unknown): GitHubLabel[] {
  return Array.isArray(labels) ? (labels as GitHubLabelApi[]).map(mapLabel) : [];
}

function asIssueRow(i: unknown): GitHubIssueRow {
  const r = isRecord(i) ? i : {};
  const user = isRecord(r.user) ? r.user : undefined;
  return {
    number: typeof r.number === "number" ? r.number : 0,
    title: typeof r.title === "string" ? r.title : "",
    body: typeof r.body === "string" ? r.body : "",
    htmlUrl: typeof r.html_url === "string" ? r.html_url : "",
    state: r.state === "closed" ? "closed" : "open",
    userLogin: typeof user?.login === "string" ? user.login : null,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
    labels: mapLabels(r.labels),
  };
}

async function githubFetch(
  path: string,
  method: string = "GET",
  body?: unknown,
): Promise<Response> {
  const token = await loadToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return response;
}

function mapResponseToError(
  res: Response,
  fallback: { code: string; message: string },
): StableError {
  if (res.status === 401 || res.status === 403) {
    return {
      code: "GITHUB_UNAUTHORIZED",
      message: "Unauthorized or rate limited by GitHub.",
    };
  }
  if (res.status === 404 && fallback.message.toLowerCase().includes("delete")) {
    return {
      code: "NOT_FOUND",
      message:
        "Issue deletion is not supported on this repository (requires admin rights or Enterprise).",
    };
  }
  return { code: fallback.code, message: fallback.message };
}

export async function loadToken(): Promise<string | null> {
  const env = import.meta.env.VITE_GITHUB_TOKEN;
  if (env != null && env.length > 0) return env;
  const db = await getSetting(GITHUB_TOKEN_SETTING_KEY);
  if (db.isOk() && db.value != null && db.value.length > 0) return db.value;
  return null;
}

export function listRepoLabels(
  owner: string,
  repo: string,
): ResultAsync<{ name: string; color: string }[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/labels`);
      if (!res.ok)
        throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not load labels." });
      const data: unknown = await res.json();
      return Array.isArray(data) ? data.map((l) => mapLabel(l)) : [];
    })(),
    (e) => mapInvokeError(e),
  );
}

export function fetchGitHubViewer(): ResultAsync<
  { login: string; avatarUrl: string | null; profileUrl: string },
  StableError
> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch("/user");
      if (!res.ok)
        throw mapResponseToError(res, {
          code: "INVOKE_FAILED",
          message: "Could not load GitHub profile.",
        });
      const data: unknown = await res.json();
      const r = isRecord(data) ? data : {};
      return {
        login: typeof r.login === "string" ? r.login : "",
        avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null,
        profileUrl: typeof r.html_url === "string" ? r.html_url : "",
      };
    })(),
    (e) => mapInvokeError(e),
  );
}

export function createLabel(
  owner: string,
  repo: string,
  name: string,
  color: string = "cccccc",
): ResultAsync<{ name: string; color: string }, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/labels`, "POST", { name, color });
      if (!res.ok) {
        if (res.status === 422) {
          // Label already exists
          return { name, color };
        }
        throw mapResponseToError(res, {
          code: "INVOKE_FAILED",
          message: `Could not create label ${name}.`,
        });
      }
      const data: unknown = await res.json();
      const r = isRecord(data) ? data : {};
      return {
        name: typeof r.name === "string" ? r.name : name,
        color: typeof r.color === "string" ? r.color : color,
      };
    })(),
    (e) => mapInvokeError(e),
  );
}

export function listRepoIssues(
  owner: string,
  repo: string,
): ResultAsync<readonly GitHubIssueRow[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(
        `/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`,
      );
      if (!res.ok)
        throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not load issues." });
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return [];
      return data.filter((i) => !isRecord(i) || i.pull_request == null).map((i) => asIssueRow(i));
    })(),
    (e) => mapInvokeError(e),
  );
}

export function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): ResultAsync<GitHubIssueRow, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues`, "POST", {
        title,
        body,
        labels,
      });
      if (!res.ok)
        throw mapResponseToError(res, {
          code: "INVOKE_FAILED",
          message: "Could not create issue.",
        });
      const data: unknown = await res.json();
      return asIssueRow(data);
    })(),
    (e) => mapInvokeError(e),
  );
}

export function updateIssue(
  owner: string,
  repo: string,
  number: number,
  title: string,
  body: string,
  labels?: string[],
): ResultAsync<GitHubIssueRow, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, "PATCH", {
        title,
        body,
        labels,
      });
      if (!res.ok)
        throw mapResponseToError(res, {
          code: "INVOKE_FAILED",
          message: "Could not update issue.",
        });
      const data: unknown = await res.json();
      return asIssueRow(data);
    })(),
    (e) => mapInvokeError(e),
  );
}

export function closeIssue(
  owner: string,
  repo: string,
  number: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, "PATCH", {
        state: "closed",
      });
      if (!res.ok)
        throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not close issue." });
    })(),
    (e) => mapInvokeError(e),
  );
}

export function deleteIssue(
  owner: string,
  repo: string,
  number: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, "DELETE");
      if (!res.ok)
        throw mapResponseToError(res, {
          code: "INVOKE_FAILED",
          message: "Could not delete issue.",
        });
    })(),
    (e) => mapInvokeError(e),
  );
}

export function readProjectReadmeHtml(projectPath: string): ResultAsync<string, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const raw = await readFirstReadmeFile(projectPath);
      if (raw == null) throw { code: "NO_LOCAL_README", message: "No README file found." };
      return await renderMarkdownHtml(raw);
    })(),
    (e) => mapInvokeError(e),
  );
}
const README_NAMES = [
  "README.md",
  "Readme.md",
  "readme.md",
  "README.MD",
  "README.mkd",
  "README.mdown",
  "README",
  "README.rst",
  "README.txt",
] as const;
async function readFirstReadmeFile(projectRoot: string): Promise<string | null> {
  try {
    const entries = await readDir(projectRoot);
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.name);
    for (const name of README_NAMES) {
      if (files.includes(name)) {
        const p = await join(projectRoot, name);
        return await readTextFile(p);
      }
    }
    const lowerReadmeNames = README_NAMES.map((n) => n.toLowerCase());
    const found = files.find((f) => lowerReadmeNames.includes(f.toLowerCase()));
    if (found) {
      const p = await join(projectRoot, found);
      return await readTextFile(p);
    }
  } catch (e) {
    console.error("failed to read directory for readme detection", e);
  }
  return null;
}
