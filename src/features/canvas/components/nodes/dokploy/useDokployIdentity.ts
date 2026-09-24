import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { createQuery } from "@tanstack/solid-query";

import { getGitHubRepoForProject, getGitRemoteUrl } from "~/services/tauri/projects";
import { parseGitRemote } from "~/services/tauri/dokploy";
import type { ProjectDto } from "~/types/dto";

export type DokployIdentity = { owner: string; repo: string; remoteUrl: string | null } | null;

/**
 * Git-identity domain: `.git/config` first, normalized remote URL, DB
 * snapshot fallback. (Extracted verbatim from DokployNode.)
 */
export function useDokployIdentity(project: Accessor<ProjectDto>) {
  const projectId = createMemo(() => project().id);

  // Live git identity: `.git/config` first, then the normalized remote URL,
  // then the (possibly stale) DB snapshot. The full remote URL is the
  // richest match signal, so it is always resolved when available.
  const gitRefQ = createQuery(() => ({
    queryKey: ["git", "github-ref", projectId()] as const,
    queryFn: async () => {
      const r = await getGitHubRepoForProject(projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    retry: false,
  }));
  const remoteUrlQ = createQuery(() => ({
    queryKey: ["git", "remote", projectId(), "dokploy"] as const,
    queryFn: async () => {
      const r = await getGitRemoteUrl(projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    retry: false,
  }));

  const identity = createMemo((): DokployIdentity => {
    const live = gitRefQ.data;
    if (live?.owner && live?.repo) {
      return { owner: live.owner, repo: live.repo, remoteUrl: remoteUrlQ.data ?? null };
    }
    const remoteUrl = remoteUrlQ.data ?? null;
    if (remoteUrl) {
      const triple = parseGitRemote(remoteUrl);
      if (triple.repo) {
        return { owner: triple.owner, repo: triple.repo, remoteUrl };
      }
    }
    const p = project();
    if (p.githubOwner && p.githubRepo) {
      return { owner: p.githubOwner, repo: p.githubRepo, remoteUrl };
    }
    return null;
  });

  return { projectId, gitRefQ, remoteUrlQ, identity };
}

export type DokployIdentityModel = ReturnType<typeof useDokployIdentity>;
