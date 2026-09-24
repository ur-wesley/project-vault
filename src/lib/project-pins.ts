import { createSignal } from "solid-js";

const STORAGE_KEY = "pv-pinned-projects";
const PINS_EVENT = "pv:pins-changed";

function readPins(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function writePins(ids: string[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  notifyPinsChanged(ids);
}

function notifyPinsChanged(ids: string[]) {
  setPinsSignal(ids);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string[]>(PINS_EVENT, { detail: ids }));
}

const [pinsSignal, setPinsSignal] = createSignal<string[]>(
  typeof localStorage === "undefined" ? [] : readPins(),
);

/** Reactive accessor for the ordered pinned project ids. */
export function usePinnedProjects() {
  return pinsSignal;
}

export function refreshPinnedProjects(): string[] {
  const pins = readPins();
  setPinsSignal(pins);
  return pins;
}

export { PINS_EVENT };

export function getPinnedProjects(): string[] {
  return readPins();
}

export function isProjectPinned(projectId: string): boolean {
  if (!projectId) return false;
  return readPins().includes(projectId);
}

export function pinProject(projectId: string): string[] {
  if (!projectId) return readPins();
  const pins = readPins();
  if (pins.includes(projectId)) return pins;
  const next = [...pins, projectId];
  writePins(next);
  return next;
}

export function unpinProject(projectId: string): string[] {
  if (!projectId) return readPins();
  const next = readPins().filter((id) => id !== projectId);
  writePins(next);
  return next;
}

export function toggleProjectPin(projectId: string): string[] {
  if (!projectId) return readPins();
  return isProjectPinned(projectId) ? unpinProject(projectId) : pinProject(projectId);
}

/** Drop pins whose project no longer exists. Returns pruned list. */
export function prunePinnedProjects(existingIds: Set<string> | string[]): string[] {
  const set = Array.isArray(existingIds) ? new Set(existingIds) : existingIds;
  const next = readPins().filter((id) => set.has(id));
  writePins(next);
  return next;
}

export function setPinnedProjects(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  writePins(next);
  return next;
}

/**
 * Pure arrayMove: returns a new order with `fromId` moved to `toId`'s
 * position. Unknown or identical ids return a copy unchanged.
 */
export function movePinnedProject(ids: string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
