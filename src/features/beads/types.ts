import type { BeadIssueDto } from "~/types/dto/beads";

export type BeadsViewLayout = "board" | "list";

export interface BeadsFilters {
  search: string;
  issueType: string;
  priority: string;
  status: string;
  onlyReady: boolean;
  onlyBlocked: boolean;
}

export const EMPTY_BEADS_FILTERS: BeadsFilters = {
  search: "",
  issueType: "",
  priority: "",
  status: "",
  onlyReady: false,
  onlyBlocked: false,
};

export const BEADS_STATUS_COLUMNS = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
] as const;

export type BeadsColumnStatus = (typeof BEADS_STATUS_COLUMNS)[number];

export const BEADS_ISSUE_TYPES = [
  "task",
  "epic",
  "feature",
  "bug",
  "chore",
  "decision",
  "spike",
] as const;

export const PRIORITY_MAP: Record<number, { label: string; badgeClass: string }> = {
  0: { label: "P0", badgeClass: "border-red-500/50 bg-red-500/10 text-red-500 dark:text-red-400" },
  1: { label: "P1", badgeClass: "border-orange-500/50 bg-orange-500/10 text-orange-500 dark:text-orange-400" },
  2: { label: "P2", badgeClass: "border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  3: { label: "P3", badgeClass: "border-blue-500/50 bg-blue-500/10 text-blue-500 dark:text-blue-400" },
  4: { label: "P4", badgeClass: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};

export const TYPE_BADGE_STYLE: Record<string, string> = {
  epic: "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold",
  feature: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  bug: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  task: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  chore: "border-stone-500/40 bg-stone-500/10 text-stone-500 dark:text-stone-400",
  decision: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  spike: "border-pink-500/40 bg-pink-500/10 text-pink-600 dark:text-pink-400",
};

export type BeadCardProps = {
  issue: BeadIssueDto;
  onOpen: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
};
