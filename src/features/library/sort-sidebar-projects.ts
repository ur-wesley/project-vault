import type { ProjectDto } from "~/types/dto";

export function sortSidebarProjects(projects: readonly ProjectDto[]): ProjectDto[] {
  return [...projects].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    const dv = (b.lastViewedAtMs ?? 0) - (a.lastViewedAtMs ?? 0);
    if (dv !== 0) return dv;
    return a.name.localeCompare(b.name);
  });
}
