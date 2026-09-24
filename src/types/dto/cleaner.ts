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

