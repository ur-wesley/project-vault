import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { ResultAsync, ok, err } from "neverthrow";
import { marked } from "marked";

import { getSetting } from "~/services/tauri";
import type { StableError } from "~/types/error";

export const GITHUB_TOKEN_SETTING_KEY = "github_token";

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

async function githubFetch(
  path: string,
  method: string = "GET",
  body?: any,
): Promise<Response> {
  const token = await loadToken();
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
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
      message: "Issue deletion is not supported on this repository (requires admin rights or Enterprise).",
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
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not load labels." });
      const data = await res.json();
      return data.map((l: any) => ({ name: l.name, color: l.color }));
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
  );
}

export function fetchGitHubViewer(): ResultAsync<
  { login: string; avatarUrl: string | null; profileUrl: string },
  StableError
> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch("/user");
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not load GitHub profile." });
      const data = await res.json();
      return {
        login: data.login,
        avatarUrl: data.avatar_url,
        profileUrl: data.html_url,
      };
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
  );
}

export function listRepoIssues(
  owner: string,
  repo: string,
): ResultAsync<readonly GitHubIssueRow[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`);
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not load issues." });
      const data = await res.json();
      return data
        .filter((i: any) => i.pull_request == null)
        .map(
          (i: any): GitHubIssueRow => ({
            number: i.number,
            title: i.title,
            body: i.body ?? "",
            htmlUrl: i.html_url,
            state: i.state as "open" | "closed",
            userLogin: i.user?.login ?? null,
            updatedAt: i.updated_at,
            labels: (i.labels as any[]).map((l) => ({
              name: typeof l === "string" ? l : l.name ?? "",
              color: typeof l === "string" ? "cccccc" : l.color ?? "cccccc",
            })),
          }),
        ) as readonly GitHubIssueRow[];
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
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
      const res = await githubFetch(`/repos/${owner}/${repo}/issues`, "POST", { title, body, labels });
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not create issue." });
      const data = await res.json();
      return {
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        htmlUrl: data.html_url,
        state: data.state as "open" | "closed",
        userLogin: data.user?.login ?? null,
        updatedAt: data.updated_at,
        labels: (data.labels as any[]).map((l) => ({
          name: typeof l === "string" ? l : l.name ?? "",
          color: typeof l === "string" ? "cccccc" : l.color ?? "cccccc",
        })),
      };
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
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
      const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, "PATCH", { title, body, labels });
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not update issue." });
      const data = await res.json();
      return {
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        htmlUrl: data.html_url,
        state: data.state as "open" | "closed",
        userLogin: data.user?.login ?? null,
        updatedAt: data.updated_at,
        labels: (data.labels as any[]).map((l) => ({
          name: typeof l === "string" ? l : l.name ?? "",
          color: typeof l === "string" ? "cccccc" : l.color ?? "cccccc",
        })),
      };
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
  );
}

export function closeIssue(
  owner: string,
  repo: string,
  number: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, "PATCH", { state: "closed" });
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not close issue." });
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
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
      if (!res.ok) throw mapResponseToError(res, { code: "INVOKE_FAILED", message: "Could not delete issue." });
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
  );
}

// README logic remains same
const hookInstalled = { current: false };
function ensureLinkHook(): void {
  if (typeof window === "undefined" || hookInstalled.current) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if ("target" in node) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  hookInstalled.current = true;
}
const PURIFY_CONFIG: DOMPurifyConfig = { USE_PROFILES: { html: true } };

const renderer = new marked.Renderer();
renderer.code = function (token) {
  const code = token.text;
  const lang = (token.lang || "").match(/\S*/)?.[0] || "";
  return `<pre class="notranslate border border-border/40"><button class="markdown-copy-btn" type="button" aria-label="Copy code"><span class="iconify mdi--content-copy h-3.5 w-3.5"></span></button><code class="language-${lang}">${code}</code></pre>`;
};

export function readProjectReadmeHtml(projectPath: string): ResultAsync<string, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const raw = await readFirstReadmeFile(projectPath);
      if (raw == null) throw { code: "NO_LOCAL_README", message: "No README file found." };
      ensureLinkHook();
      const html = await marked.parse(raw, { renderer });
      return DOMPurify.sanitize(html, PURIFY_CONFIG);
    })(),
    (e) => (e as any).code ? (e as StableError) : { code: "INVOKE_FAILED", message: (e as Error).message },
  );
}
const README_NAMES = ["README.md", "Readme.md", "readme.md", "README.MD", "README.mkd", "README.mdown", "README", "README.rst", "README.txt"] as const;
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
