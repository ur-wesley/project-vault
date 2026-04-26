export type LocationDto = {
  id: string;
  path: string;
  name: string;
  sortIndex: number;
  enabled: boolean;
  isDefault: boolean;
};

export type PathDiskSpaceDto = {
  path: string;
  totalBytes: number;
  availableBytes: number;
};

export type TaskDto = {
  id: string;
  label: string;
  argv: string[];
  kind: string;
};

export type ProjectDto = {
  id: string;
  locationId: string;
  name: string;
  path: string;
  stack: string;
  runtimeHint: string | null;
  favorite: boolean;
  lastOpenedAtMs: number | null;
  totalPlaytimeMs: number;
  tasks: TaskDto[];
  tags: string[];
  githubOwner: string | null;
  githubRepo: string | null;
  fileCount: number;
  lastEditedAtMs: number | null;
};

export type SessionDto = {
  id: string;
  projectId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  command: string | null;
};

export type AddLocationPayload = {
  path: string;
  name?: string | null;
};

export type UpdateLocationPayload = {
  id: string;
  path?: string | null;
  name?: string | null;
  sortIndex?: number | null;
  enabled?: boolean | null;
  isDefault?: boolean | null;
};

export type LocationOrderEntry = {
  id: string;
  sortIndex: number;
};

export type SetFavoritePayload = {
  id: string;
  favorite: boolean;
};

export type StartSessionPayload = {
  projectId: string;
  command?: string | null;
  sessionId?: string;
};

export type ScanResultDto = {
  projectsDiscovered: number;
  projectsUpserted: number;
  projectsPruned: number;
  dirsSkippedErrors: number;
  monoreposExpanded: number;
  workspaceWarnings: number;
};

export type IdeCandidateDto = {
  id: string;
  label: string;
  executable: string;
  icon: string | null;
};

export type ShellCandidateDto = {
  id: string;
  label: string;
  executable: string;
};

export type OpenProjectIdePayload = {
  projectId: string;
  executable: string;
};

export type SpawnProjectTaskPayload = {
  projectId: string;
  argv: string[];
  acknowledgeRisk: boolean;
  sessionId?: string;
};

export type SpawnProjectTaskResponse = {
  sessionId: string;
  streamOutput: boolean;
};

export type SettingEntryDto = {
  key: string;
  value: string;
};

export type ExportSnapshotDto = {
  exportedAtMs: number;
  locations: LocationDto[];
  projects: ProjectDto[];
};

export type TemplateSummaryDto = {
  id: string;
  name: string;
  description: string;
};

export type CreateProjectPayload = {
  parentPath: string;
  projectName: string;
  templateId: string;
  runPostCreate: boolean;
};

export type CreateProjectResultDto = {
  projectPath: string;
  filesWritten: number;
  postCreateLog: string | null;
};

export type GitHubRepoRefDto = {
  owner: string;
  repo: string;
};

export type GitStatusDto = {
  branch: string;
  ahead: number;
  behind: number;
  isDirty: boolean;
  hasUpstream: boolean;
};

export type ImportProjectPayload = {
  sourcePath: string;
  destinationLocationId: string;
  deleteSource: boolean;
};

export type GitHubDeviceStartDto = {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceWaitPayload = {
  deviceCode: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceWaitDto = {
  deviceCode: string;
  intervalSec: number;
  expiresIn: number;
};

export type GitHubDeviceTokenDto = {
  accessToken: string;
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

export type MiseToolDto = {
  name: string;
  version: string;
  source: string;
  isActive: boolean;
};
