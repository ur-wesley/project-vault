import type { TaskDto } from "./tasks";

export type ProjectDto = {
  id: string;
  locationId: string;
  name: string;
  path: string;
  stack: string;
  runtimeHint: string | null;
  favorite: boolean;
  lastOpenedAtMs: number | null;
  lastViewedAtMs: number | null;
  totalPlaytimeMs: number;
  tasks: TaskDto[];
  tags: string[];
  githubOwner: string | null;
  githubRepo: string | null;
  fileCount: number;
  sizeBytes: number;
  lastEditedAtMs: number | null;
  iconPath: string | null;
};

export type IdeCandidateDto = {
  id: string;
  label: string;
  executable: string;
  icon: string | null;
  iconData: string | null;
};

export type ShellCandidateDto = {
  id: string;
  label: string;
  executable: string;
};

export type ToolCandidateDto = {
  id: string;
  label: string;
  executable: string;
  version: string | null;
  available: boolean;
};

export type OpenProjectIdePayload = {
  projectId: string;
  executable: string;
};

export type CreateProjectPayload = {
  locationId: string;
  projectName: string;
  templateId: string;
};

export type CreateProjectResultDto = {
  projectPath: string;
  filesWritten: number;
  postCreateLog: string | null;
  sessionId: string | null;
  projectId: string | null;
};

export type RunTemplateCommandPayload = {
  command: string;
  cwd: string;
};

export type RunTemplateCommandResultDto = {
  sessionId: string;
};

export type ImportProjectPayload = {
  sourcePath: string;
  destinationLocationId: string;
  deleteSource: boolean;
};

export type MoveProjectPayload = {
  projectId: string;
  destinationParent: string;
};

export type MoveProjectResultDto = {
  project: ProjectDto;
  cleanupWarning: string | null;
};

export type MoveProjectProgress = {
  projectId: string;
  phase: string;
  filesTotal: number;
  bytesTotal: number;
  filesDone: number;
  bytesDone: number;
};

