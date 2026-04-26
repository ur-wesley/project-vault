import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { Octokit } from "octokit";
import { ResultAsync } from "neverthrow";
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
}>;

export function listRepoLabels(
  owner: string,
  repo: string,
): ResultAsync<{ name: string; color: string }[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const token = await loadToken();
      const octokit = octokitFromToken(token);
      const { data } = await octokit.rest.issues.listLabelsForRepo({
        owner,
        repo,
      });
      return data.map((l) => ({ name: l.name, color: l.color }));
    })(),
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not load labels." }),
  );
}

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

const PURIFY_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
};

export async function loadToken(): Promise<string | null> {
  const env = import.meta.env.VITE_GITHUB_TOKEN;
  if (env != null && env.length > 0) return env;
  const db = await getSetting(GITHUB_TOKEN_SETTING_KEY);
  if (db.isOk() && db.value != null && db.value.length > 0) return db.value;
  return null;
}

function octokitFromToken(token: string | null): Octokit {
  return new Octokit({
    auth: token || undefined,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

function mapToStableError(
  e: unknown,
  fallback: { code: string; message: string },
): StableError {
  if (e != null && typeof e === "object" && "status" in e) {
    const s = (e as { status: number }).status;
    if (s === 401 || s === 403) {
      return {
        code: "GITHUB_UNAUTHORIZED",
        message: "Unauthorized or rate limited by GitHub.",
      };
    }
  }
  if (e instanceof Error) return { code: fallback.code, message: e.message };
  return { code: fallback.code, message: fallback.message };
}

export function readProjectReadmeHtml(projectPath: string): ResultAsync<string, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const raw = await readFirstReadmeFile(projectPath);
      if (raw == null) {
        throw { code: "NO_LOCAL_README", message: "No README file found." };
      }
      ensureLinkHook();
      const html = await marked.parse(raw);
      return DOMPurify.sanitize(html, PURIFY_CONFIG);
    })(),
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not load README." }),
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

export function fetchGitHubViewer(): ResultAsync<
  { login: string; avatarUrl: string | null; profileUrl: string },
  StableError
> {
  return ResultAsync.fromPromise(
    (async () => {
      const token = await loadToken();
      if (!token) throw { code: "GITHUB_UNAUTHORIZED", message: "No token." };
      const octokit = octokitFromToken(token);
      const { data } = await octokit.rest.users.getAuthenticated();
      return {
        login: data.login,
        avatarUrl: data.avatar_url,
        profileUrl: data.html_url,
      };
    })(),
    (e) =>
      mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not load GitHub profile." }),
  );
}

export function listRepoIssues(
  owner: string,
  repo: string,
): ResultAsync<readonly GitHubIssueRow[], StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const token = await loadToken();
      const octokit = octokitFromToken(token);
      const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: "all",
        per_page: 50,
        sort: "updated",
        direction: "desc",
      });
      return data
        .filter((i) => i.pull_request == null)
        .map(
          (i): GitHubIssueRow => ({
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
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not load issues." }),
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
      const token = await loadToken();
      if (!token) throw { code: "GITHUB_UNAUTHORIZED", message: "Login required to create issues." };
      const octokit = octokitFromToken(token);
      const { data } = await octokit.rest.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
      });
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
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not create issue." }),
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
      const token = await loadToken();
      if (!token)
        throw { code: "GITHUB_UNAUTHORIZED", message: "Login required to update issues." };
      const octokit = octokitFromToken(token);
      const { data } = await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: number,
        title,
        body,
        labels,
      });
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
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not update issue." }),
  );
}

export function closeIssue(
  owner: string,
  repo: string,
  number: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const token = await loadToken();
      if (!token) throw { code: "GITHUB_UNAUTHORIZED", message: "Login required to close issues." };
      const octokit = octokitFromToken(token);
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: number,
        state: "closed",
      });
    })(),
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not close issue." }),
  );
}

export function deleteIssue(
  owner: string,
  repo: string,
  number: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    (async () => {
      const token = await loadToken();
      if (!token)
        throw { code: "GITHUB_UNAUTHORIZED", message: "Login required to delete issues." };
      const octokit = octokitFromToken(token);
      await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}", {
        owner,
        repo,
        issue_number: number,
      });
    })(),
    (e) => mapToStableError(e, { code: "INVOKE_FAILED", message: "Could not delete issue." }),
  );
}
