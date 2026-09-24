import { For, Show, type Component, type JSX } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import type { KanbanCardMeta } from "./types";

export const KANBAN_PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-600 border-red-500/30",
  high: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  medium: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  low: "bg-muted text-muted-foreground",
};

export type CardDragListeners = {
  onPointerDown: (e: PointerEvent) => void;
  onDragStart: (e: Event) => void;
};

type Props = Readonly<{
  card: KanbanCardMeta;
  tagColors: Record<string, string>;
  subCount: number;
  /** Ref forwarded to the card node (drag engine registration). */
  setRef?: (el: HTMLElement) => void;
  /** Transform/transition from the drag engine (sibling displacement). */
  style?: JSX.CSSProperties;
  /** True while this card is the drag source. */
  dragActive?: boolean;
  /** When set, the grip handle and title arm a drag. Omit to disable. */
  dragListeners?: CardDragListeners;
  onOpen: (id: string) => void;
  onMoveLeft: (() => void) | null;
  onMoveRight: (() => void) | null;
}>;

export const KanbanCardView: Component<Props> = (props) => {
  const { t } = useI18n();
  const tagStyle = (tag: string) => {
    const color = (props.tagColors ?? {})[tag];
    return color ? { "border-color": `${color}88`, color } : {};
  };
  const draggable = () => props.dragListeners != null;

  return (
    <article
      ref={props.setRef}
      data-card-id={props.card.id}
      onClick={() => props.onOpen(props.card.id)}
      title={t("kanban.openCard") as string}
      style={props.style}
      class={`rounded-md border bg-card p-2.5 shadow-sm hover:border-primary/40 ${props.dragActive ? "opacity-40" : ""}`}
    >
      <div class="flex items-start gap-1">
        <Show when={draggable()}>
          <span
            title={t("kanban.dragCard") as string}
            aria-hidden="true"
            {...props.dragListeners}
            class="mt-0.5 shrink-0 cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              props.dragListeners?.onPointerDown(e);
            }}
          >
            <span class="iconify mdi--drag size-4" />
          </span>
        </Show>
        <p
          class={`min-w-0 flex-1 text-sm font-medium leading-snug ${draggable() ? "cursor-grab active:cursor-grabbing" : ""}`}
          {...(draggable() ? props.dragListeners : {})}
        >
          {props.card.title}
        </p>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge variant="outline" class={KANBAN_PRIORITY_STYLE[props.card.priority] ?? ""}>
          {props.card.priority}
        </Badge>
        <Show when={props.card.due}>
          <Badge variant="outline">
            {t("kanban.duePrefix") as string} {props.card.due}
          </Badge>
        </Show>
        <For each={props.card.assignees.slice(0, 2)}>
          {(a) => (
            <Badge variant="secondary" title={a}>
              <span class="iconify mdi--account size-3" />
              {a}
            </Badge>
          )}
        </For>
        <Show when={props.card.assignees.length > 2}>
          <Badge variant="secondary">+{props.card.assignees.length - 2}</Badge>
        </Show>
        <For each={props.card.tags.slice(0, 3)}>
          {(tag) => (
            <Badge variant="secondary" style={tagStyle(tag)}>
              {tag}
            </Badge>
          )}
        </For>
        <Show when={props.subCount > 0}>
          <Badge variant="secondary" title={t("kanban.subIssues") as string}>
            <span class="iconify mdi--file-tree size-3" />
            {props.subCount}
          </Badge>
        </Show>
        <Show when={props.card.relations.length > 0}>
          <Badge variant="secondary" title={t("kanban.relations") as string}>
            <span class="iconify mdi--link-variant size-3" />
            {props.card.relations.length}
          </Badge>
        </Show>
        <Show when={props.card.links.issues.length > 0}>
          <Badge variant="secondary" title={t("kanban.linkedIssues") as string}>
            <span class="iconify mdi--github size-3" />
            {props.card.links.issues.length}
          </Badge>
        </Show>
      </div>
      <div class="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Show when={props.onMoveLeft}>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 px-1.5 text-[11px]"
            title={t("kanban.moveLeft") as string}
            onClick={() => props.onMoveLeft?.()}
          >
            ←
          </Button>
        </Show>
        <Show when={props.onMoveRight}>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 px-1.5 text-[11px]"
            title={t("kanban.moveRight") as string}
            onClick={() => props.onMoveRight?.()}
          >
            →
          </Button>
        </Show>
      </div>
    </article>
  );
};
