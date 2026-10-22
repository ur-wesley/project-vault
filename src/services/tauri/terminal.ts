import type { ShellCandidateDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function openShellAtPath(path: string) {
  return tauriInvoke<void>("open_shell_at_path", { payload: { path } });
}

export function openProjectShell(projectId: string) {
  return tauriInvoke<void>("open_project_shell", { payload: { projectId } });
}

export type PtySizeHint = { rows: number | null; cols: number | null };

function ptySizeHint(rows?: number, cols?: number): PtySizeHint | null {
  if (rows == null && cols == null) return null;
  return { rows: rows ?? null, cols: cols ?? null };
}

export function embeddedTerminalSpawn(
  projectId: string,
  shell?: string,
  rows?: number,
  cols?: number,
) {
  return tauriInvoke<string>("embedded_terminal_spawn", {
    projectId,
    shell: shell ?? null,
    size: ptySizeHint(rows, cols),
  });
}

export function embeddedTerminalWrite(sessionId: string, data: string) {
  return tauriInvoke<void>("embedded_terminal_write", { sessionId, data });
}

export function embeddedTerminalResize(sessionId: string, rows: number, cols: number) {
  return tauriInvoke<void>("embedded_terminal_resize", { sessionId, rows, cols });
}

export function embeddedTerminalKill(sessionId: string) {
  return tauriInvoke<void>("embedded_terminal_kill", { sessionId });
}

export function embeddedTerminalIsAlive(sessionId: string) {
  return tauriInvoke<boolean>("embedded_terminal_is_alive", { sessionId });
}

export function embeddedTerminalGetBuffer(sessionId: string) {
  return tauriInvoke<string[]>("embedded_terminal_get_buffer", { sessionId });
}

export function listAvailableShells() {
  return tauriInvoke<ShellCandidateDto[]>("list_available_shells");
}

export function listDiscoveredTools() {
  return tauriInvoke<unknown[]>("list_discovered_tools");
}

export function globalTerminalSpawn(cwd?: string, shell?: string, rows?: number, cols?: number) {
  return tauriInvoke<string>("global_terminal_spawn", {
    cwd: cwd ?? null,
    shell: shell ?? null,
    size: ptySizeHint(rows, cols),
  });
}

export function embeddedTerminalClearBuffer(sessionId: string) {
  return tauriInvoke<void>("embedded_terminal_clear_buffer", { sessionId });
}

export type TerminalSessionDto = {
  sessionId: string;
  projectId: string | null;
  cwd: string;
  startedAtMs: number;
  isActive: boolean;
};

export function listTerminalSessions() {
  return tauriInvoke<TerminalSessionDto[]>("list_terminal_sessions");
}
