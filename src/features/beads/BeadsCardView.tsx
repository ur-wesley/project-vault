import { Show, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import {
  PRIORITY_MAP,
  TYPE_BADGE_STYLE,
  type BeadCardProps,
} from "./types";

export const BeadsCardView: Component<BeadCardProps> = (props) => {
  const { t } = useI18n();
  const issue = () => props.issue;

  const priorityMeta = () => PRIORITY_MAP[issue().priority] ?? PRIORITY_MAP[4]!;
  const typeStyle = () => TYPE_BADGE_STYLE[issue().issueType.toLowerCase()] ?? "border-border bg-muted/50 text-foreground";

  const isBlocked = () => Boolean(issue().isBlocked || (issue().status === "blocked"));

  return (
    <article
      class={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-all hover:border-primary/50 hover:shadow-md cursor-pointer",
        isBlocked() && "border-amber-500/40 bg-amber-500/[0.02]",
      )}
      onClick={() => props.onOpen(issue().id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen(issue().id);
        }
      }}
    >
      <header class="flex items-start justify-between gap-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" class="font-mono text-[10px] tracking-tight text-muted-foreground">
            {issue().id}
          </Badge>
          <Badge
            variant="outline"
            class={cn("text-[10px] uppercase tracking-wider py-0 px-1.5", typeStyle())}
          >
            {issue().issueType}
          </Badge>
          <Badge
            variant="outline"
            class={cn("text-[10px] font-bold py-0 px-1.5", priorityMeta().badgeClass)}
          >
            {priorityMeta().label}
          </Badge>
        </div>

        <Show when={props.onStatusChange}>
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="size-6 text-muted-foreground opacity-60 hover:opacity-100"
              >
                <span class="iconify mdi--dots-horizontal size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <Show when={issue().status !== "open"}>
                  <DropdownMenuItem onClick={() => props.onStatusChange?.(issue().id, "open")}>
                    {t("beads.statusOpen") as string}
                  </DropdownMenuItem>
                </Show>
                <Show when={issue().status !== "in_progress"}>
                  <DropdownMenuItem onClick={() => props.onStatusChange?.(issue().id, "in_progress")}>
                    {t("beads.statusInProgress") as string}
                  </DropdownMenuItem>
                </Show>
                <Show when={issue().status !== "blocked"}>
                  <DropdownMenuItem onClick={() => props.onStatusChange?.(issue().id, "blocked")}>
                    {t("beads.statusBlocked") as string}
                  </DropdownMenuItem>
                </Show>
                <Show when={issue().status !== "closed"}>
                  <DropdownMenuItem onClick={() => props.onStatusChange?.(issue().id, "closed")}>
                    {t("beads.statusClosed") as string}
                  </DropdownMenuItem>
                </Show>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Show>
      </header>

      <h4 class="text-xs font-semibold leading-snug line-clamp-2">
        {issue().title}
      </h4>

      <Show when={issue().description}>
        <p class="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
          {issue().description}
        </p>
      </Show>

      <footer class="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <Show when={isBlocked()}>
          <span class="flex items-center gap-0.5 font-medium text-amber-500 dark:text-amber-400">
            <span class="iconify mdi--lock-outline size-3" />
            {t("beads.blocked") as string}
          </span>
        </Show>

        <Show when={issue().parent}>
          <span class="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px]">
            <span class="iconify mdi--source-commit-next-local size-3" />
            {issue().parent}
          </span>
        </Show>

        <Show when={(issue().commentCount ?? 0) > 0}>
          <span class="flex items-center gap-0.5 ml-auto">
            <span class="iconify mdi--comment-outline size-3" />
            {issue().commentCount}
          </span>
        </Show>

        <Show when={issue().assignee}>
          <span class={cn("flex items-center gap-0.5", (issue().commentCount ?? 0) === 0 && "ml-auto")}>
            <span class="iconify mdi--account-circle-outline size-3" />
            {issue().assignee}
          </span>
        </Show>
      </footer>
    </article>
  );
};
