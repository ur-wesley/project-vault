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

export type GitChangedFileDto = {
  path: string;
  /** Single-letter porcelain status: M, A, D, R, U or ? (untracked). */
  status: string;
  additions: number;
  deletions: number;
};

export type GitFileDiffDto = {
  path: string;
  diff: string;
  truncated: boolean;
};

export type GitTagResultDto = {
  newTag: string;
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

