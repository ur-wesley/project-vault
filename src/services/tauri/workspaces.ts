import type {
  AgentSessionDto,
  CreatedPrDto,
  ExecutionViewDto,
  ExecutorInfoDto,
  GitFileDiffDto,
  PrStatusDto,
  WorkspaceChangeEntry,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceRepoInfoDto,
} from "~/types/dto";
import { tauriInvoke } from "./utils";

export function workspaceList(input: {
  project?: string;
  includeArchived?: boolean;
  boardId?: string;
  cardId?: string;
}) {
  return tauriInvoke<WorkspaceDto[]>("workspace_list", {
    project: input.project ?? null,
    includeArchived: input.includeArchived ?? false,
    boardId: input.boardId ?? null,
    cardId: input.cardId ?? null,
  });
}

export function workspaceGet(workspaceId: string) {
  return tauriInvoke<WorkspaceDetailDto>("workspace_get", { workspaceId });
}

export function workspaceCreate(input: {
  project: string;
  name: string;
  repoPath?: string;
  boardId?: string;
  cardId?: string;
  executor?: string;
  prompt?: string;
  baseBranch?: string;
}) {
  return tauriInvoke<WorkspaceDetailDto>("workspace_create", { input });
}

export function workspaceDelete(workspaceId: string, deleteBranch?: boolean) {
  return tauriInvoke<void>("workspace_delete", {
    workspaceId,
    deleteBranch: deleteBranch ?? false,
  });
}

export function workspaceArchive(workspaceId: string, archived: boolean) {
  return tauriInvoke<WorkspaceDto>("workspace_archive", { workspaceId, archived });
}

export function workspaceLinkCard(
  workspaceId: string,
  boardId?: string | null,
  cardId?: string | null,
) {
  return tauriInvoke<WorkspaceDto>("workspace_link_card", {
    workspaceId,
    boardId: boardId ?? null,
    cardId: cardId ?? null,
  });
}

export function workspaceChanges(workspaceId: string) {
  return tauriInvoke<WorkspaceChangeEntry[]>("workspace_changes", { workspaceId });
}

export function workspaceFileDiff(workspaceId: string, file: string) {
  return tauriInvoke<GitFileDiffDto>("workspace_file_diff", { workspaceId, file });
}

export function workspacePush(workspaceId: string) {
  return tauriInvoke<void>("workspace_push", { workspaceId });
}

export function workspaceGitInfo(workspaceId: string) {
  return tauriInvoke<WorkspaceRepoInfoDto>("workspace_git_info", { workspaceId });
}

export function prCreate(input: {
  workspaceId: string;
  base?: string;
  title?: string;
  body?: string;
}) {
  return tauriInvoke<CreatedPrDto>("pr_create", { input });
}

export function prStatus(owner: string, repo: string, number: number) {
  return tauriInvoke<PrStatusDto>("pr_status", { owner, repo, number });
}

export function prMerge(input: {
  workspaceId: string;
  owner: string;
  repo: string;
  number: number;
  method?: string;
}) {
  return tauriInvoke<boolean>("pr_merge", { input });
}

export function sessionCreate(workspaceId: string, executor?: string, prompt?: string) {
  return tauriInvoke<AgentSessionDto>("session_create", {
    workspaceId,
    executor: executor ?? null,
    prompt: prompt ?? null,
  });
}

export function sessionList(workspaceId: string) {
  return tauriInvoke<AgentSessionDto[]>("session_list", { workspaceId });
}

export function sessionPrompt(sessionId: string, prompt: string) {
  return tauriInvoke<void>("session_prompt", { sessionId, prompt });
}

export function sessionStop(sessionId: string) {
  return tauriInvoke<AgentSessionDto>("session_stop", { sessionId });
}

export function sessionGet(sessionId: string) {
  return tauriInvoke<ExecutionViewDto>("session_get", { sessionId });
}

export function executorsList() {
  return tauriInvoke<ExecutorInfoDto[]>("executors_list");
}
