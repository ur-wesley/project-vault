import type { ProjectDto } from "~/types/dto";

const TOUCHED_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export function filterProjectList(
  projects: readonly ProjectDto[],
  filter: string,
  search: string,
  githubLogin?: string | null,
  nowMs: number = Date.now(),
): ProjectDto[] {
  let list = [...projects];
  if (filter === "favorites") {
    list = list.filter((p) => p.favorite).sort((a, b) => a.name.localeCompare(b.name));
  } else if (filter === "recent") {
    list = list
      .filter((p) => p.lastOpenedAtMs != null)
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.lastOpenedAtMs ?? 0) - (a.lastOpenedAtMs ?? 0);
      });
  } else if (filter === "touched-10d") {
    const cutoff = nowMs - TOUCHED_WINDOW_MS;
    list = list
      .filter((p) => p.lastEditedAtMs != null && p.lastEditedAtMs >= cutoff)
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.lastEditedAtMs ?? 0) - (a.lastEditedAtMs ?? 0);
      });
  } else if (filter === "git") {
    list = list.filter((p) => p.tags.includes("git"));
  } else if (filter === "github") {
    list = list.filter((p) => p.githubOwner != null);
  } else if (filter === "own") {
    list = list.filter(
      (p) => githubLogin != null && p.githubOwner?.toLowerCase() === githubLogin.toLowerCase(),
    );
  } else {
    if (filter.startsWith("loc:")) {
      const id = filter.slice(4);
      list = list.filter((p) => p.locationId === id);
    } else if (filter.startsWith("stack:")) {
      const st = filter.slice(6);
      list = list.filter((p) => p.stack === st);
    }
    list.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const s = search.trim().toLowerCase();
  if (s) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.path.toLowerCase().includes(s) ||
        p.stack.toLowerCase().includes(s),
    );
  }
  return list;
}

export function buildStacksList(projects: readonly ProjectDto[]): string[] {
  const s = new Set<string>();
  for (const p of projects) s.add(p.stack);
  return [...s].sort();
}
