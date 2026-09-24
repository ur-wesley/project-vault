import type {
  KanbanBoardSummary,
  KanbanBoardView,
  KanbanCard,
  KanbanRelation,
  KanbanTagInfo,
} from "~/features/kanban/types";
import { tauriInvoke } from "./utils";

/**
 * Backend (Tauri/MCP serde) emits snake_case (`tag_colors`, `card_count`)
 * while the frontend types use camelCase (`tagColors`, `cardCount`).
 * Normalize at this seam so every consumer gets the camelCase shape
 * regardless of which key style the backend sent.
 */
export type RawKanbanBoardView = KanbanBoardView & {
  tag_colors?: Record<string, string>;
};

export function normalizeKanbanBoardView(raw: RawKanbanBoardView): KanbanBoardView {
  return {
    ...raw,
    tagColors: raw.tagColors ?? raw.tag_colors ?? {},
  };
}

export type RawKanbanBoardSummary = KanbanBoardSummary & {
  card_count?: number;
};

export function normalizeKanbanBoardSummary(raw: RawKanbanBoardSummary): KanbanBoardSummary {
  return {
    ...raw,
    cardCount: raw.cardCount ?? raw.card_count ?? 0,
  };
}

export function kanbanListBoards(project: string) {
  return tauriInvoke<RawKanbanBoardSummary[]>("kanban_list_boards", {
    project,
  }).map((boards) => boards.map(normalizeKanbanBoardSummary));
}

export function kanbanGetBoard(project: string, boardId: string) {
  return tauriInvoke<RawKanbanBoardView>("kanban_get_board", {
    project,
    boardId,
  }).map(normalizeKanbanBoardView);
}

export function kanbanCreateBoard(input: { project: string; boardId?: string; title: string }) {
  return tauriInvoke<RawKanbanBoardView>("kanban_create_board", { input }).map(
    normalizeKanbanBoardView,
  );
}

export function kanbanCreateCard(input: {
  project: string;
  boardId: string;
  cardId?: string;
  title: string;
  body?: string;
  status?: string;
  priority?: string;
  tags?: string[];
  assignees?: string[];
  parent?: string;
  relations?: KanbanRelation[];
  due?: string;
}) {
  return tauriInvoke<KanbanCard>("kanban_create_card", { input });
}

export function kanbanUpdateCard(input: {
  project: string;
  boardId: string;
  cardId: string;
  title?: string;
  body?: string;
  status?: string;
  priority?: string;
  tags?: string[];
  assignees?: string[];
  parent?: string | null;
  relations?: KanbanRelation[];
  due?: string | null;
  archived?: boolean;
  links?: { tasks: string[]; files: string[]; issues: string[] };
}) {
  return tauriInvoke<KanbanCard>("kanban_update_card", { input });
}

export function kanbanListCards(input: {
  project: string;
  boardId: string;
  status?: string;
  priority?: string;
  tag?: string;
  assignee?: string;
  search?: string;
  parent?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
}) {
  return tauriInvoke<KanbanCard[]>("kanban_list_cards", { input });
}

export function kanbanDeleteCard(project: string, boardId: string, cardId: string) {
  return tauriInvoke<void>("kanban_delete_card", { project, boardId, cardId });
}

export function kanbanDeleteBoard(project: string, boardId: string) {
  return tauriInvoke<void>("kanban_delete_board", { project, boardId });
}

export function kanbanListTags(project: string, boardId: string) {
  return tauriInvoke<KanbanTagInfo[]>("kanban_list_tags", { project, boardId });
}

export function kanbanSetTagColor(project: string, boardId: string, name: string, color: string) {
  return tauriInvoke<void>("kanban_set_tag_color", { project, boardId, name, color });
}

export function kanbanMoveCard(
  project: string,
  boardId: string,
  cardId: string,
  to: string,
  position?: number,
) {
  return tauriInvoke<RawKanbanBoardView>("kanban_move_card", {
    project,
    boardId,
    cardId,
    to,
    position: position ?? null,
  }).map(normalizeKanbanBoardView);
}
