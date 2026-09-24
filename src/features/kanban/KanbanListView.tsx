import { For, Show, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { useI18n } from "~/lib/i18n-context";
import { KANBAN_PRIORITY_STYLE } from "./KanbanCardView";
import type { KanbanCardMeta } from "./types";

type Props = Readonly<{
  cards: KanbanCardMeta[];
  tagColors: Record<string, string>;
  onOpen: (id: string) => void;
}>;

export const KanbanListView: Component<Props> = (props) => {
  const { t } = useI18n();

  return (
    <div class="min-h-0 flex-1 overflow-auto rounded-lg border">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 bg-muted/80 backdrop-blur">
          <tr class="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th class="px-3 py-2 font-semibold">{t("kanban.colTitle") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("kanban.colStatus") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("kanban.colPriority") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("kanban.colAssignees") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("kanban.colTags") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("kanban.colDue") as string}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.cards}>
            {(card) => (
              <tr
                class="cursor-pointer border-t hover:bg-muted/40"
                onClick={() => props.onOpen(card.id)}
              >
                <td class="max-w-64 truncate px-3 py-2 font-medium">{card.title}</td>
                <td class="px-3 py-2">
                  <Badge variant="secondary">{card.status}</Badge>
                </td>
                <td class="px-3 py-2">
                  <Badge variant="outline" class={KANBAN_PRIORITY_STYLE[card.priority] ?? ""}>
                    {card.priority}
                  </Badge>
                </td>
                <td class="px-3 py-2 text-xs text-muted-foreground">{card.assignees.join(", ")}</td>
                <td class="px-3 py-2">
                  <span class="flex flex-wrap gap-1">
                    <For each={card.tags}>
                      {(tag) => {
                        const color = (props.tagColors ?? {})[tag];
                        return (
                          <Badge
                            variant="secondary"
                            style={color ? { "border-color": `${color}88`, color } : {}}
                          >
                            {tag}
                          </Badge>
                        );
                      }}
                    </For>
                  </span>
                </td>
                <td class="px-3 py-2 text-xs text-muted-foreground">{card.due ?? "—"}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={props.cards.length === 0}>
        <p class="px-3 py-6 text-center text-xs text-muted-foreground">
          {t("kanban.noCardsFound") as string}
        </p>
      </Show>
    </div>
  );
};
