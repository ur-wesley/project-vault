import type { EmbeddedTerminalInstance } from "../EmbeddedTerminal";

export type PersistedTerminalState = {
  instances: EmbeddedTerminalInstance[];
  activeId: string | null;
};

const STORAGE_PREFIX = "project-vault:terminals";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

export function saveTerminalState(
  projectId: string,
  instances: readonly EmbeddedTerminalInstance[],
  activeId: string | null,
): void {
  try {
    const state: PersistedTerminalState = {
      instances: instances.map((inst) => ({
        id: inst.id,
        name: inst.name,
        defaultName: inst.defaultName,
        shell: inst.shell,
        icon: inst.icon,
        sessionId: inst.sessionId,
        attachSessionId: inst.attachSessionId,
      })),
      activeId,
    };
    localStorage.setItem(storageKey(projectId), JSON.stringify(state));
  } catch {
    // localStorage may be full or unavailable; silently ignore
  }
}

export function loadTerminalState(projectId: string): PersistedTerminalState | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTerminalState;
    if (!Array.isArray(parsed.instances)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearTerminalState(projectId: string): void {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    // ignore
  }
}
