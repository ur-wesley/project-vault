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

export type ConcurrentTask = {
  label: string;
  argv: string[];
  cwd?: string | null;
};

export type TaskDto = {
  id: string;
  label: string;
  argv: string[];
  kind: string;
  cwd: string | null;
  description?: string;
  depends: string[];
  source?: string;
  concurrent?: ConcurrentTask[];
};

export type ProjectTaskConfig = {
  tasks: TaskDto[];
  hasMiseConfig: boolean;
  hasJustfile: boolean;
  misePath: string | null;
  justfilePath: string | null;
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
  sizeBytes: number;
  lastEditedAtMs: number | null;
  iconPath: string | null;
};

export type SessionDto = {
  id: string;
  projectId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  command: string | null;
  state: string;
  rootPid: number | null;
  treePids: number[];
  exitCode: number | null;
  stopReason: string | null;
  lastEventAtMs: number;
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

export type SpawnProjectTaskPayload = {
  projectId: string;
  argv: string[];
  acknowledgeRisk: boolean;
  sessionId?: string;
  cwd?: string | null;
  concurrent?: ConcurrentTask[];
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
  type: "command" | "git" | "files";
  config: Record<string, unknown>;
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
  version?: string | null;
};

export type GitIncomingCommit = {
  hash: string;
  message: string;
  author: string;
  authorEmail: string;
  relativeTime: string;
};

export type GitIncomingDto = {
  commits: GitIncomingCommit[];
};

export type GitTagResultDto = {
  newTag: string;
};

export type CleanPreviewEntryDto = {
  path: string;
  sizeBytes: number;
  isDir: boolean;
};

export type GitCleanPreviewDto = {
  entries: CleanPreviewEntryDto[];
  totalBytes: number;
  hasTrackedChanges: boolean;
};

export type ProjectCleanerCategory =
  | "protected"
  | "active"
  | "missing"
  | "git_clean"
  | "git_dirty"
  | "no_git";

export type ProjectCleanerActionKind = "skip" | "clean" | "delete" | "unvault";

export type ProjectCleanerScanOptions = {
  locationId: string;
  unusedDays: number;
  protectRecentDays: number;
  protectFavorites: boolean;
  minPlaytimeMs: number;
};

export type ProjectCleanerRow = {
  projectId: string;
  name: string;
  path: string;
  stack: string;
  category: ProjectCleanerCategory;
  sizeBytes: number;
  lastOpenedAtMs: number | null;
  reclaimableBytes: number;
  suggestedAction: ProjectCleanerActionKind;
  gitBranch?: string | null;
  isDirty?: boolean | null;
};

export type ProjectCleanerSummary = {
  byCategory: Record<string, number>;
  totalReclaimableBytes: number;
};

export type ProjectCleanerScanResult = {
  rows: ProjectCleanerRow[];
  summary: ProjectCleanerSummary;
};

export type ProjectCleanerAction = {
  projectId: string;
  action: ProjectCleanerActionKind;
};

export type ProjectCleanerExecutePayload = {
  actions: ProjectCleanerAction[];
};

export type ProjectCleanerFailure = {
  projectId: string;
  error: string;
};

export type ProjectCleanerExecuteResult = {
  succeeded: number;
  failed: ProjectCleanerFailure[];
  bytesReclaimed: number;
};

export type VersionFileDto = {
  path: string;
  preview: string;
};

export type DiscoverVersionFilesResultDto = {
  currentVersion: string;
  newVersion: string;
  useVPrefix: boolean;
  files: VersionFileDto[];
};

export type GitPreviewVersionsDto = {
  currentVersion: string;
  latestTag?: string | null;
  patchVersion: string;
  minorVersion: string;
  majorVersion: string;
  betaVersion: string;
};

export type BumpVersionAndTagPayload = {
  bump: "patch" | "minor" | "major" | "beta";
  files: string[];
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

export type MiseToolSuggestionDto = {
  name: string;
  version: string;
  reason: string;
};

export type IndexMetaDto = {
  indexedFiles: number;
  indexSizeBytes: number;
  lastUpdatedMs: number | null;
};

export type SearchSnippetDto = {
  lineNumber: number;
  text: string;
  html: string;
};

export type SearchHitDto = {
  path: string;
  score: number;
  highlights: SearchSnippetDto[];
  lineNumbers: number[];
};

export type ScreenInfoDto = {
  id: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
};

export type WindowInfoDto = {
  id: number;
  title: string;
  appName: string;
  width: number;
  height: number;
  x: number;
  y: number;
};

export type ClipboardEntryMetaDto = {
  filePaths: string[];
  width?: number;
  height?: number;
  byteSize?: number;
  mime?: string;
};

export type ClipboardEntryDto = {
  id: string;
  kind: string;
  preview: string;
  contentText?: string | null;
  contentHash: string;
  payloadPath?: string | null;
  meta: ClipboardEntryMetaDto;
  sourceApp?: string | null;
  pinned: boolean;
  createdAtMs: number;
};

export type ClipboardHistorySettingsDto = {
  enabled: boolean;
  maxEntries: number;
  maxImageBytes: number;
  dedupSeconds: number;
  showSource: boolean;
};

export type ClipboardOverlayPositionDto = {
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
};
