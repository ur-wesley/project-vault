import { tauriInvoke } from "./utils";

export type LocalIssueDto = {
  id?: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
};

export type CreateIssueInput = {
  title: string;
  body: string | null;
  tags: string[];
};

export type UpdateIssueInput = {
  title?: string;
  body?: string | null;
  state?: string;
  tags?: string[];
};

export function listIssues(projectId: string) {
  return tauriInvoke<LocalIssueDto[]>("list_issues", { projectId });
}

export function getIssue(projectId: string, number: number) {
  return tauriInvoke<LocalIssueDto>("get_issue", { projectId, number });
}

export function createIssueLocal(projectId: string, input: CreateIssueInput) {
  return tauriInvoke<LocalIssueDto>("create_issue", { projectId, input });
}

export function updateIssueLocal(projectId: string, number: number, input: UpdateIssueInput) {
  return tauriInvoke<LocalIssueDto>("update_issue", { projectId, number, input });
}

export function deleteIssue(projectId: string, number: number) {
  return tauriInvoke<void>("delete_issue", { projectId, number });
}

export function deleteAllLocalIssues(projectId: string) {
  return tauriInvoke<void>("delete_all_local_issues", { projectId });
}
