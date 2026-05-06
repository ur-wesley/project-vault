import type { SessionDto, StartSessionPayload } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function startSession(payload: StartSessionPayload) {
  return tauriInvoke<SessionDto>("start_session", { payload });
}

export function endSession(sessionId: string) {
  return tauriInvoke<SessionDto>("end_session", { sessionId });
}

export function listSessionsForProject(projectId: string, limit: number, offset: number) {
  return tauriInvoke<SessionDto[]>("list_sessions_for_project", { projectId, limit, offset });
}

export function listActiveSessions(projectId: string) {
  return tauriInvoke<SessionDto[]>("list_active_sessions", { project_id: projectId });
}

export function listAllActiveSessions() {
  return tauriInvoke<SessionDto[]>("list_all_active_sessions");
}

export type ProcessDto = {
  sessionId: string;
  projectId: string;
  projectName: string;
  command: string | null;
  state: string;
  rootPid: number | null;
  ports: number[];
  startedAtMs: number;
  lastEventAtMs: number;
  kind: string;
};

export function listAllProcesses() {
  return tauriInvoke<ProcessDto[]>("list_all_processes");
}

export function clearSessionsForProject(projectId: string) {
  return tauriInvoke<number>("clear_sessions_for_project", { projectId });
}

export function getSessionCountForProject(projectId: string, stateFilter?: string) {
  return tauriInvoke<number>("get_session_count_for_project", { projectId, stateFilter });
}

export function recoverOrphanSessions() {
  return tauriInvoke<number>("recover_orphan_sessions");
}
