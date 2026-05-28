import type { GitCleanPreviewDto, GitIncomingDto, GitPreviewVersionsDto, GitStatusDto, GitTagResultDto, DiscoverVersionFilesResultDto, BumpVersionAndTagPayload } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function getGitStatus(projectId: string) {
  return tauriInvoke<GitStatusDto | null>("get_git_status", { projectId });
}

export function gitPull(projectId: string) {
  return tauriInvoke<void>("git_pull", { projectId });
}

export function gitPush(projectId: string) {
  return tauriInvoke<void>("git_push", { projectId });
}

export function gitFetch(projectId: string) {
  return tauriInvoke<void>("git_fetch", { projectId });
}

export function gitIncoming(projectId: string) {
  return tauriInvoke<GitIncomingDto>("git_incoming", { projectId });
}

export function gitInit(projectId: string) {
  return tauriInvoke<void>("git_init", { projectId });
}

export function gitTagAndPush(projectId: string, bump: "patch" | "minor" | "major" | "beta") {
  return tauriInvoke<GitTagResultDto>("git_tag_and_push", { projectId, bump });
}

export function gitPreviewVersions(projectId: string) {
  return tauriInvoke<GitPreviewVersionsDto>("git_preview_versions", { projectId });
}

export function gitDiscoverVersionFiles(
  projectId: string,
  bump: "patch" | "minor" | "major" | "beta",
) {
  return tauriInvoke<DiscoverVersionFilesResultDto>("git_discover_version_files", { projectId, bump });
}

export function gitBumpVersionAndTag(projectId: string, payload: BumpVersionAndTagPayload) {
  return tauriInvoke<GitTagResultDto>("git_bump_version_and_tag", { projectId, payload });
}

export function gitCleanPreview(projectId: string) {
  return tauriInvoke<GitCleanPreviewDto>("git_clean_preview", { projectId });
}

export function gitCleanExecute(projectId: string, resetTracked: boolean, selectedPaths: string[]) {
  return tauriInvoke<void>("git_clean_execute", { projectId, resetTracked, selectedPaths });
}

export function startGitWatcher(projectId: string, projectPath: string) {
  return tauriInvoke<void>("start_git_watcher", { projectId, projectPath });
}

export function stopGitWatcher(projectId: string) {
  return tauriInvoke<void>("stop_git_watcher", { projectId });
}
