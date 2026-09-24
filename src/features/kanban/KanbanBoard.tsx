import { For, Show, createSignal, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DndBoardCard, DndBoardColumn, DndBoardRoot, type BoardDropEvent } from "~/components/dnd";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { snapshotTransform } from "~/components/dnd";
import { backendDropPosition, isNoOpDrop } from "./kanbanDrop";
import { KanbanCardView } from "./KanbanCardView";
import type { KanbanBoardView, KanbanStatus } from "./types";

type Props = Readonly<{
  board: KanbanBoardView;
  /** Column ids to render (visible or all). */
  columns: string[];
  /** Pre-filtered + sorted card ids per column. */
  visibleOrder: Record<string, string[]>;
  sortMode: string;
  onMove: (cardId: string, to: KanbanStatus, position?: number) => void;
  onCreateCard: (status: KanbanStatus, title: string) => void;
  onOpenCard: (id: string) => void;
}>;

export const KanbanBoard: Component<Props> = (props) => {
  const { t } = useI18n();
  const [titles, setTitles] = createSignal<Record<string, string>>({});

  /** Dragging needs manual order; arrows cover the other sort modes. */
  const canDrag = () => props.sortMode === "manual";

  const cardsById = () => {
    const map = new Map<string, KanbanBoardView["cards"][number]>();
    for (const c of props.board.cards) map.set(c.id, c);
    return map;
  };

  const subCounts = () => {
    const counts = new Map<string, number>();
    for (const c of props.board.cards) {
      if (c.parent) counts.set(c.parent, (counts.get(c.parent) ?? 0) + 1);
    }
    return counts;
  };

  const submit = (status: string) => {
    const title = (titles()[status] ?? "").trim();
    if (!title) return;
    props.onCreateCard(status as KanbanStatus, title);
    setTitles((p) => ({ ...p, [status]: "" }));
  };

  const colIndex = (status: string) => props.columns.indexOf(status);

  const handleDrop = (e: BoardDropEvent) => {
    const full = props.board.order[e.toColumn] ?? [];
    const visible = props.visibleOrder[e.toColumn] ?? [];
    const position = backendDropPosition(full, visible, e.activeId, e.toIndex);
    if (e.fromColumn === e.toColumn && isNoOpDrop(full, e.activeId, position)) return;
    props.onMove(e.activeId, e.toColumn as KanbanStatus, position);
  };

  const ghost = ({ id: activeId }: { id: string; columnId: string }) => {
    const card = cardsById().get(activeId);
    if (!card) return null;
    return (
      <div class="scale-[1.02] shadow-xl">
        <KanbanCardView
          card={card}
          tagColors={props.board.tagColors}
          subCount={subCounts().get(card.id) ?? 0}
          onOpen={() => {}}
          onMoveLeft={null}
          onMoveRight={null}
        />
      </div>
    );
  };

  return (
    <DndBoardRoot
      onDrop={handleDrop}
      overlay={ghost}
      ignoreSelector="button,input,textarea,select,a"
    >
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2 xl:grid-cols-4">
        <For each={props.columns}>
          {(status) => (
            <DndBoardColumn id={status}>
              {({ setRef, isOver, dropIndex }) => (
                <section
                  ref={setRef}
                  class={`flex min-h-40 flex-col rounded-lg border bg-muted/30 transition-colors ${isOver() ? "border-primary/60 bg-primary/5" : ""}`}
                >
                  <header class="flex items-center justify-between border-b px-3 py-2">
                    <h3 class="text-xs font-bold uppercase tracking-wider">{status}</h3>
                    <Badge variant="secondary">{props.visibleOrder[status]?.length ?? 0}</Badge>
                  </header>
                  <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                    <For each={props.visibleOrder[status] ?? []}>
                      {(cardId, i) => (
                        <>
                          <Show when={(dropIndex() ?? -1) === i()}>
                            <div class="h-0.5 shrink-0 rounded bg-primary" aria-hidden="true" />
                          </Show>
                          <Show when={cardsById().get(cardId)}>
                            {(card) => (
                              <DndBoardCard columnId={status} id={cardId}>
                                {({ setRef, snapshot, transition, dragListeners }) => (
                                  <KanbanCardView
                                    setRef={setRef}
                                    style={
                                      snapshotTransform(snapshot())
                                        ? {
                                            transform: snapshotTransform(snapshot())!,
                                            transition,
                                          }
                                        : undefined
                                    }
                                    dragActive={snapshot().isActive}
                                    dragListeners={canDrag() ? dragListeners : undefined}
                                    card={card()}
                                    tagColors={props.board.tagColors}
                                    subCount={subCounts().get(card().id) ?? 0}
                                    onOpen={props.onOpenCard}
                                    onMoveLeft={
                                      colIndex(status) > 0
                                        ? () =>
                                            props.onMove(
                                              card().id,
                                              props.columns[colIndex(status) - 1]! as KanbanStatus,
                                            )
                                        : null
                                    }
                                    onMoveRight={
                                      colIndex(status) < props.columns.length - 1
                                        ? () =>
                                            props.onMove(
                                              card().id,
                                              props.columns[colIndex(status) + 1]! as KanbanStatus,
                                            )
                                        : null
                                    }
                                  />
                                )}
                              </DndBoardCard>
                            )}
                          </Show>
                        </>
                      )}
                    </For>
                    <Show
                      when={
                        (dropIndex() ?? -1) === (props.visibleOrder[status] ?? []).length &&
                        (props.visibleOrder[status] ?? []).length > 0
                      }
                    >
                      <div class="h-0.5 shrink-0 rounded bg-primary" aria-hidden="true" />
                    </Show>
                    <Show
                      when={(props.visibleOrder[status] ?? []).length === 0 && dropIndex() == null}
                    >
                      <p class="px-1 py-2 text-center text-[11px] text-muted-foreground">
                        {t("kanban.emptyColumn") as string}
                      </p>
                    </Show>
                  </div>
                  <div class="flex gap-1.5 border-t p-2">
                    <TextField class="flex-1">
                      <TextFieldInput
                        placeholder={t("kanban.cardPlaceholder", { status }) as string}
                        value={titles()[status] ?? ""}
                        onInput={(e) =>
                          setTitles((p) => ({ ...p, [status]: e.currentTarget.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submit(status);
                        }}
                      />
                    </TextField>
                    <Button size="sm" variant="outline" onClick={() => submit(status)}>
                      {t("kanban.add") as string}
                    </Button>
                  </div>
                </section>
              )}
            </DndBoardColumn>
          )}
        </For>
      </div>
    </DndBoardRoot>
  );
};
