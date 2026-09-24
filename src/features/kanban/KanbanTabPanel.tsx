import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import {
  kanbanCreateBoard,
  kanbanCreateCard,
  kanbanDeleteBoard,
  kanbanGetBoard,
  kanbanListBoards,
  kanbanMoveCard,
} from "~/services/tauri/kanban";
import { KanbanBoard } from "./KanbanBoard";
import { KanbanCardDialog } from "./KanbanCardDialog";
import { EMPTY_FILTERS, KanbanFilterBar, type KanbanFilters } from "./KanbanFilterBar";
import { KanbanListView } from "./KanbanListView";
import {
  KANBAN_VISIBLE_STATUSES,
  type KanbanBoardView,
  type KanbanSortMode,
  type KanbanStatus,
} from "./types";

type Props = Readonly<{
  projectId: string;
  github: { owner: string; repo: string } | null;
}>;

const priorityRank = (p: string) => ({ urgent: 0, high: 1, medium: 2 })[p] ?? 3;

export const KanbanTabPanel: Component<Props> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [boardId, setBoardId] = createSignal<string | null>(null);
  const [newBoardTitle, setNewBoardTitle] = createSignal("");
  const [selectedCardId, setSelectedCardId] = createSignal<string | null>(null);
  const [filters, setFilters] = createSignal<KanbanFilters>({ ...EMPTY_FILTERS });
  const [sort, setSort] = createSignal<KanbanSortMode>("manual");
  const [showAll, setShowAll] = createSignal(false);
  const [view, setView] = createSignal<"board" | "list">("board");
  const [confirmBoardDelete, setConfirmBoardDelete] = createSignal(false);

  const boardsQ = createQuery(() => ({
    queryKey: ["kanban-boards", props.projectId],
    queryFn: async () => {
      const r = await kanbanListBoards(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  createEffect(() => {
    const boards = boardsQ.data;
    if (boards && boards.length > 0 && !boardId()) setBoardId(boards[0]!.id);
  });

  const boardQ = createQuery(() => ({
    queryKey: ["kanban-board", props.projectId, boardId()],
    queryFn: async (): Promise<KanbanBoardView | null> => {
      const id = boardId();
      if (!id) return null;
      const r = await kanbanGetBoard(props.projectId, id);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: boardId() !== null,
  }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["kanban-boards", props.projectId] });
    qc.invalidateQueries({ queryKey: ["kanban-board", props.projectId, boardId()] });
  };

  const matchesFilters = (c: KanbanBoardView["cards"][number]) => {
    const f = filters();
    if (c.archived) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.priority && c.priority !== f.priority) return false;
    if (f.tag && !c.tags.includes(f.tag)) return false;
    if (f.assignee && !c.assignees.includes(f.assignee)) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!c.title.toLowerCase().includes(q) && !c.body.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const sortCards = (list: KanbanBoardView["cards"]) => {
    const mode = sort();
    const arr = [...list];
    if (mode === "priority")
      arr.sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id),
      );
    else if (mode === "due")
      arr.sort((a, b) => (a.due ?? "~").localeCompare(b.due ?? "~") || a.id.localeCompare(b.id));
    else if (mode === "title")
      arr.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    return arr;
  };

  const displayColumns = createMemo(() => {
    const cols = boardQ.data?.columns ?? [];
    if (showAll()) return cols;
    return cols.filter((c) => (KANBAN_VISIBLE_STATUSES as string[]).includes(c));
  });

  const visibleOrder = createMemo(() => {
    const board = boardQ.data;
    const out: Record<string, string[]> = {};
    if (!board) return out;
    const byId = new Map(board.cards.map((c) => [c.id, c]));
    for (const col of displayColumns()) {
      const ids = (board.order[col] ?? []).filter((id) => {
        const c = byId.get(id);
        return c && matchesFilters(c);
      });
      out[col] =
        sort() === "manual" ? ids : sortCards(ids.map((id) => byId.get(id)!)).map((c) => c.id);
    }
    return out;
  });

  const flatList = createMemo(() => {
    const board = boardQ.data;
    if (!board) return [];
    const cards = board.cards.filter(matchesFilters);
    if (sort() === "manual") {
      const rank = new Map<string, number>();
      for (const col of displayColumns()) {
        for (const id of visibleOrder()[col] ?? []) {
          if (!rank.has(id)) rank.set(id, rank.size);
        }
      }
      return [...cards].sort((a, b) => (rank.get(a.id) ?? 999999) - (rank.get(b.id) ?? 999999));
    }
    return sortCards(cards);
  });

  const tagOptions = createMemo(() => {
    const set = new Set<string>();
    for (const c of boardQ.data?.cards ?? []) for (const tag of c.tags) set.add(tag);
    return [...set].sort();
  });

  const assigneeOptions = createMemo(() => {
    const set = new Set<string>();
    for (const c of boardQ.data?.cards ?? []) for (const a of c.assignees) set.add(a);
    return [...set].sort();
  });

  // Tauri invokes have been observed hanging forever (lost callback ids),
  // which looks exactly like "cannot move": no toast, no refresh, card snaps
  // back. The timeout converts silence into a visible warning + refresh.
  const MOVE_TIMEOUT_MS = 15000;
  const move = async (cardId: string, to: KanbanStatus, position?: number) => {
    const id = boardId();
    if (!id) return;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      notify({ title: t("kanban.moveTimedOut") as string, severity: "warning" });
      invalidate();
    }, MOVE_TIMEOUT_MS);
    try {
      const r = await kanbanMoveCard(props.projectId, id, cardId, to, position);
      if (timedOut) {
        // Late answer after a timeout: just reconcile with the backend.
        invalidate();
        return;
      }
      if (r.isErr())
        notify({
          title: t("kanban.moveFailed") as string,
          body: r.error.message,
          severity: "error",
        });
      else invalidate();
    } finally {
      window.clearTimeout(timer);
    }
  };

  const createCard = async (status: KanbanStatus, title: string) => {
    const id = boardId();
    if (!title || !id) return;
    const r = await kanbanCreateCard({ project: props.projectId, boardId: id, title, status });
    if (r.isErr())
      notify({
        title: t("kanban.createFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else invalidate();
  };

  const createBoard = async () => {
    const title = newBoardTitle().trim();
    if (!title) return;
    const r = await kanbanCreateBoard({ project: props.projectId, title });
    if (r.isErr())
      notify({
        title: t("kanban.boardCreateFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setNewBoardTitle("");
      setBoardId(r.value.id);
      invalidate();
    }
  };

  const deleteBoard = async () => {
    const id = boardId();
    if (!id) return;
    if (!confirmBoardDelete()) {
      setConfirmBoardDelete(true);
      return;
    }
    const r = await kanbanDeleteBoard(props.projectId, id);
    if (r.isErr())
      notify({
        title: t("kanban.deleteFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setConfirmBoardDelete(false);
      setBoardId(null);
      invalidate();
    }
  };

  createEffect(() => {
    // Reset two-click confirm when switching boards.
    boardId();
    setConfirmBoardDelete(false);
  });

  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let boardTitleInput: HTMLInputElement | undefined;
  const hasNoBoards = () => (boardsQ.data ?? []).length === 0 && !boardsQ.isPending;

  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <For each={boardsQ.data ?? []}>
          {(b) => (
            <Button
              size="sm"
              variant={b.id === boardId() ? "default" : "outline"}
              onClick={() => setBoardId(b.id)}
            >
              {b.title}
              <Badge variant="secondary" class="ml-1.5">
                {b.cardCount}
              </Badge>
            </Button>
          )}
        </For>
        <div class="ml-auto flex items-center gap-1.5">
          <TextField class="w-44">
            <TextFieldInput
              ref={boardTitleInput}
              placeholder={t("kanban.newBoardPlaceholder") as string}
              value={newBoardTitle()}
              onInput={(e) => setNewBoardTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createBoard();
              }}
            />
          </TextField>
          <Button size="sm" variant="outline" onClick={() => void createBoard()}>
            {t("kanban.newBoard") as string}
          </Button>
          <Show when={boardId()}>
            <Button
              size="sm"
              variant={confirmBoardDelete() ? "destructive" : "ghost"}
              onClick={() => void deleteBoard()}
            >
              {confirmBoardDelete() ? (t("kanban.confirmDelete") as string) : "×"}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={hasNoBoards()}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span class="iconify mdi--view-column-outline size-12 text-muted-foreground/40" />
          <p class="text-sm font-semibold">{t("kanban.emptyTitle") as string}</p>
          <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {t("kanban.emptyDescription") as string}{" "}
            <code class="rounded bg-muted px-1 py-0.5 font-mono">.vault/kanban/</code>.
          </p>
          <Button size="sm" class="mt-1 gap-1.5" onClick={() => boardTitleInput?.focus()}>
            <span class="iconify mdi--plus size-4" />
            {t("kanban.newBoard") as string}
          </Button>
        </div>
      </Show>

      <Show when={boardQ.data}>
        <KanbanFilterBar
          filters={filters()}
          sort={sort()}
          tagOptions={tagOptions()}
          assigneeOptions={assigneeOptions()}
          showAll={showAll()}
          view={view()}
          onFilters={setFilters}
          onSort={setSort}
          onShowAll={setShowAll}
          onView={setView}
        />
      </Show>

      <Show when={boardId() !== null && boardQ.isPending}>
        <p class="text-xs text-muted-foreground">{t("kanban.loading") as string}</p>
      </Show>
      <Show when={boardId() !== null && boardQ.isError}>
        <p class="text-xs text-destructive">{t("kanban.loadFailed") as string}</p>
      </Show>

      <Show when={boardQ.data}>
        {(board) => (
          <>
            <Show when={view() === "board"}>
              <KanbanBoard
                board={board()}
                columns={displayColumns()}
                visibleOrder={visibleOrder()}
                sortMode={sort()}
                onMove={(id, to, pos) => void move(id, to, pos)}
                onCreateCard={(status, title) => void createCard(status, title)}
                onOpenCard={setSelectedCardId}
              />
            </Show>
            <Show when={view() === "list"}>
              <KanbanListView
                cards={flatList()}
                tagColors={board().tagColors}
                onOpen={setSelectedCardId}
              />
            </Show>
            <Show when={boardId()}>
              {(id) => (
                <KanbanCardDialog
                  projectId={props.projectId}
                  boardId={id()}
                  board={board()}
                  cardId={selectedCardId()}
                  github={props.github}
                  onClose={() => setSelectedCardId(null)}
                  onChanged={invalidate}
                  onSelectCard={setSelectedCardId}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};
