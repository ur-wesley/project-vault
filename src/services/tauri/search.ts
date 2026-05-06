import type { IndexMetaDto, SearchHitDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function searchProject(projectId: string, query: string) {
  return tauriInvoke<SearchHitDto[]>("search_project", { projectId, query });
}

export function indexProject(projectId: string) {
  return tauriInvoke<IndexMetaDto>("index_project", { projectId });
}

export function rebuildIndex(projectId: string) {
  return tauriInvoke<IndexMetaDto>("rebuild_index", { projectId });
}

export function getIndexMeta(projectId: string) {
  return tauriInvoke<IndexMetaDto | null>("get_index_meta", { projectId });
}

export function deleteIndex(projectId: string) {
  return tauriInvoke<void>("delete_index", { projectId });
}

export function deleteAllIndices() {
  return tauriInvoke<void>("delete_all_indices");
}
