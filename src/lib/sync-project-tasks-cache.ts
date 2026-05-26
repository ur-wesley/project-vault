import type { QueryClient } from "@tanstack/solid-query";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto, TaskDto } from "~/types/dto";

export function syncProjectTasksInCache(
  qc: QueryClient,
  projectId: string,
  tasks: TaskDto[],
) {
  qc.setQueryData<ProjectDto>(queryKeys.project(projectId), (old) => {
    if (!old) return old;
    return { ...old, tasks };
  });
  qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => {
    if (!old) return old;
    return old.map((p) => (p.id === projectId ? { ...p, tasks } : p));
  });
}
