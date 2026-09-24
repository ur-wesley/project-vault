export type WorkspaceDto = {
  id: string;
  projectId: string;
  cardBoard: string | null;
  cardId: string | null;
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  status: string;
  archived: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentSessionDto = {
  id: string;
  workspaceId: string;
  executor: string;
  ptySessionId: string;
  status: string;
  lastPrompt: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WorkspaceChangeEntry = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

import type { GitFileDiffDto } from "./git";

export type { GitFileDiffDto };

export type WorkspaceRepoInfoDto = {
  branch: string;
  base: string;
  owner: string | null;
  repo: string | null;
  pushed: boolean;
};

export type CreatedPrDto = { number: number; htmlUrl: string };

export type PrStatusDto = {
  number: number;
  htmlUrl: string;
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  head: string;
  base: string;
};

export type WorkspaceDetailDto = {
  workspace: WorkspaceDto;
  sessions: AgentSessionDto[];
  changes: WorkspaceChangeEntry[];
};

export type ExecutionViewDto = {
  session: AgentSessionDto;
  liveStatus: string;
  exitCode: number | null;
  outputTail: string;
};

export type ExecutorInfoDto = { id: string; display: string; available: boolean };

