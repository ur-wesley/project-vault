export type KanbanStatus = "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";

export type KanbanPriority = "urgent" | "high" | "medium" | "low";

export type KanbanRelationKind = "blocking" | "related" | "duplicate";

export type KanbanRelation = { to: string; kind: string };

export type KanbanBoardSummary = {
  id: string;
  title: string;
  columns: string[];
  cardCount: number;
};

export type KanbanCardMeta = {
  id: string;
  board: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  tags: string[];
  assignees: string[];
  parent: string | null;
  relations: KanbanRelation[];
  due: string | null;
  archived: boolean;
  links: { tasks: string[]; files: string[]; issues: string[]; workspaces: string[] };
  checklist: { label: string; done: boolean }[];
};

export type KanbanCard = KanbanCardMeta & { body?: string };

export type KanbanBoardView = {
  id: string;
  title: string;
  columns: string[];
  order: Record<string, string[]>;
  tagColors: Record<string, string>;
  cards: (KanbanCardMeta & { body: string })[];
};

export type KanbanTagInfo = { name: string; color: string | null; count: number };

export const KANBAN_VISIBLE_STATUSES: KanbanStatus[] = ["todo", "doing", "review", "done"];
export const KANBAN_HIDDEN_STATUSES: KanbanStatus[] = ["backlog", "cancelled"];
export const KANBAN_ALL_STATUSES: KanbanStatus[] = [
  "backlog",
  "todo",
  "doing",
  "review",
  "done",
  "cancelled",
];
export const KANBAN_PRIORITIES: KanbanPriority[] = ["urgent", "high", "medium", "low"];

export type KanbanSortMode = "manual" | "priority" | "due" | "title";
export const KANBAN_SORT_MODES: KanbanSortMode[] = ["manual", "priority", "due", "title"];
