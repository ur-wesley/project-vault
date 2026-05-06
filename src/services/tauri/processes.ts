import { tauriInvoke } from "./utils";

export function stopAllProjectProcesses(projectId: string) {
  return tauriInvoke<void>("stop_all_project_processes", { projectId });
}
