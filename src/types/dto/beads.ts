export interface BeadDependencyDto {
  issueId: string;
  dependsOnId: string;
  type: string;
  createdAt?: string | null;
  createdBy?: string | null;
  metadata?: string | null;
}

export interface BeadIssueDto {
  id: string;
  title: string;
  description?: string | null;
  status: string; // "open" | "in_progress" | "blocked" | "deferred" | "closed"
  priority: number; // 0 (urgent/P0), 1 (high/P1), 2 (medium/P2), 3 (low/P3), 4 (P4)
  issueType: string; // "epic" | "task" | "bug" | "feature" | "chore" | etc.
  owner?: string | null;
  assignee?: string | null;
  isBlocked?: boolean | null;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  parent?: string | null;
  dependencies?: BeadDependencyDto[];
  dependencyCount?: number | null;
  dependentCount?: number | null;
  commentCount?: number | null;
}

export interface BeadCommentDto {
  id?: string | null;
  issueId?: string | null;
  author?: string | null;
  text: string;
  createdAt?: string | null;
}

export interface BeadsStatusDto {
  installed: boolean;
  initialized: boolean;
  version?: string | null;
  issueCount: number;
}

export interface CreateBeadInput {
  projectPath: string;
  title: string;
  issueType: string;
  priority: number;
  description?: string;
}

export interface UpdateBeadStatusInput {
  projectPath: string;
  id: string;
  status: string;
  closeReason?: string;
}

export interface AddBeadCommentInput {
  projectPath: string;
  id: string;
  comment: string;
}
