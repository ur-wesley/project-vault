import type { SpawnProjectTaskPayload, SpawnProjectTaskResponse } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function spawnProjectTask(payload: SpawnProjectTaskPayload) {
  return tauriInvoke<SpawnProjectTaskResponse>("spawn_project_task", { payload });
}

export function stopProjectTask(sessionId: string) {
  return tauriInvoke<void>("stop_project_task", { sessionId });
}

export function readProjectTaskConfig(projectId: string) {
  return tauriInvoke<unknown>("read_project_task_config", { projectId });
}

export function writeProjectTask(projectId: string, task: unknown) {
  return tauriInvoke<void>("write_project_task", { payload: { projectId, task } });
}

export function deleteProjectTask(projectId: string, task: unknown) {
  return tauriInvoke<void>("delete_project_task", { payload: { projectId, task } });
}
