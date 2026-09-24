import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";

/**
 * GitHub identity resolution: command data first, project fields fallback.
 * (Extracted verbatim from ProjectDetailHeader.)
 */
export function useHeaderGithub(m: Accessor<ProjectDetailModel>) {
  const github = createMemo(() => {
    const g = m().ghQ.data as { owner?: string; repo?: string } | undefined;
    if (g?.owner && g?.repo) return { owner: g.owner, repo: g.repo };
    const proj = m().projectQ.data;
    if (proj?.githubOwner && proj?.githubRepo) {
      return { owner: proj.githubOwner, repo: proj.githubRepo };
    }
    return null;
  });
  return github;
}
