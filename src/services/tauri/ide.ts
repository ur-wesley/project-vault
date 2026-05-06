import type { IdeCandidateDto, OpenProjectIdePayload } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function listDiscoveredIdes() {
  return tauriInvoke<IdeCandidateDto[]>("list_discovered_ides");
}

export function openProjectInIde(payload: OpenProjectIdePayload) {
  return tauriInvoke<void>("open_project_in_ide", { payload });
}

export function stopProjectIde(projectId: string) {
  return tauriInvoke<void>("stop_project_ide", { projectId });
}

export function isProjectIdeRunning(projectId: string) {
  return tauriInvoke<boolean>("is_project_ide_running", { projectId });
}
