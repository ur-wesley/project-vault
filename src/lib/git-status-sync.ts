import type { QueryClient } from "@tanstack/solid-query";
import { queryKeys } from "~/services/query-keys";

export const GIT_STATUS_CHANGE_TYPES = new Set(["git", "version-bump", "git-clean"]);

export function isGitStatusChangeType(changeType: string): boolean {
  return GIT_STATUS_CHANGE_TYPES.has(changeType);
}

export function invalidateGitProjectQueries(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.gitIncoming(projectId) });
  void qc.invalidateQueries({ queryKey: ["git", "preview-versions", projectId] });
  void qc.invalidateQueries({ queryKey: queryKeys.githubRepo(projectId) });
  void qc.invalidateQueries({ queryKey: ["git", "remote", projectId] });
}
