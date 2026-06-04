import type {
  CreateProjectPayload,
  CreateProjectResultDto,
  ExportSnapshotDto,
  GitHubRepoRefDto,
  ImportProjectPayload,
  MoveProjectPayload,
  MoveProjectResultDto,
  ProjectDto,
  SetFavoritePayload,
} from "~/types/dto";
import { tauriInvoke } from "./utils";

export function listProjects() {
  return tauriInvoke<ProjectDto[]>("list_projects");
}

export function getProject(id: string) {
  return tauriInvoke<ProjectDto>("get_project", { id });
}

export function refreshProject(projectId: string) {
  return tauriInvoke<ProjectDto>("refresh_project", { projectId });
}

export function getProjectLanguages(projectId: string) {
  return tauriInvoke<Record<string, number>>("get_project_languages", { projectId });
}

export function getGitHubRepoForProject(projectId: string) {
  return tauriInvoke<GitHubRepoRefDto | null>("get_github_repo_for_project", { projectId });
}

export function getGitRemoteUrl(projectId: string) {
  return tauriInvoke<string | null>("get_git_remote_url", { projectId });
}

export function upsertProject(project: ProjectDto) {
  return tauriInvoke<ProjectDto>("upsert_project", { project });
}

export function deleteProject(id: string, deleteFromDisk = false) {
  return tauriInvoke<void>("delete_project", { payload: { id, deleteFromDisk } });
}

export function setProjectFavorite(payload: SetFavoritePayload) {
  return tauriInvoke<ProjectDto>("set_project_favorite", { payload });
}

export function setProjectTag(payload: { id: string; tag: string }) {
  return tauriInvoke<ProjectDto>("set_project_tag", { payload });
}

export function removeProjectTag(payload: { id: string; tag: string }) {
  return tauriInvoke<ProjectDto>("remove_project_tag", { payload });
}

export function touchProjectOpened(id: string) {
  return tauriInvoke<ProjectDto>("touch_project_opened", { id });
}

export function importProject(payload: ImportProjectPayload) {
  return tauriInvoke<void>("import_project", { payload });
}

export function moveProject(payload: MoveProjectPayload) {
  return tauriInvoke<MoveProjectResultDto>("move_project", { payload });
}

export function listRunningProjects() {
  return tauriInvoke<string[]>("list_running_projects");
}

export function getLocationProjectSizes(locationId: string) {
  return tauriInvoke<{ projectId: string; path: string; name: string; sizeBytes: number }[]>(
    "get_location_project_sizes",
    { locationId },
  );
}

export function getLargestEntries(path: string, limit: number) {
  return tauriInvoke<{ path: string; name: string; sizeBytes: number; isDir: boolean }[]>(
    "get_largest_entries",
    { path, limit },
  );
}

export function exportLibrarySnapshot() {
  return tauriInvoke<ExportSnapshotDto>("export_library_snapshot");
}
