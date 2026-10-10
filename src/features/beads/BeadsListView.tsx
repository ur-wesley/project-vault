import { For, Show, createMemo, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import type { BeadIssueDto } from "~/types/dto/beads";
import {
  PRIORITY_MAP,
  TYPE_BADGE_STYLE,
  type BeadsFilters,
} from "./types";

type Props = {
  issues: BeadIssueDto[];
  filters: BeadsFilters;
  onOpen: (id: string) => void;
};

export const BeadsListView: Component<Props> = (props) => {
  const { t } = useI18n();

  const filteredIssues = createMemo(() => {
    const f = props.filters;
    const q = f.search.trim().toLowerCase();

    return props.issues.filter((issue) => {
      if (f.issueType && issue.issueType.toLowerCase() !== f.issueType.toLowerCase()) {
        return false;
      }
      if (f.priority !== "" && issue.priority.toString() !== f.priority) {
        return false;
      }
      if (f.status && issue.status.toLowerCase() !== f.status.toLowerCase()) {
        return false;
      }
      if (f.onlyBlocked && !issue.isBlocked && issue.status !== "blocked") {
        return false;
      }
      if (f.onlyReady && (issue.isBlocked || issue.status === "blocked" || issue.status === "closed")) {
        return false;
      }
      if (q) {
        const idMatch = issue.id.toLowerCase().includes(q);
        const titleMatch = issue.title.toLowerCase().includes(q);
        const descMatch = (issue.description ?? "").toLowerCase().includes(q);
        if (!idMatch && !titleMatch && !descMatch) return false;
      }
      return true;
    });
  });

  return (
    <div class="min-h-0 flex-1 overflow-auto rounded-lg border">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 bg-muted/80 backdrop-blur">
          <tr class="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th class="px-3 py-2 font-semibold">{t("beads.colId") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colTitle") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colType") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colStatus") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colPriority") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colParent") as string}</th>
            <th class="px-3 py-2 font-semibold">{t("beads.colAssignee") as string}</th>
          </tr>
        </thead>
        <tbody>
          <For each={filteredIssues()}>
            {(issue) => {
              const priorityMeta = PRIORITY_MAP[issue.priority] ?? PRIORITY_MAP[4]!;
              const typeStyle = TYPE_BADGE_STYLE[issue.issueType.toLowerCase()] ?? "border-border bg-muted/50 text-foreground";
              const isBlocked = Boolean(issue.isBlocked || issue.status === "blocked");

              return (
                <tr
                  class={cn(
                    "cursor-pointer border-t hover:bg-muted/40 transition-colors",
                    isBlocked && "bg-amber-500/[0.02]",
                  )}
                  onClick={() => props.onOpen(issue.id)}
                >
                  <td class="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {issue.id}
                  </td>
                  <td class="max-w-md px-3 py-2 font-medium">
                    <div class="flex items-center gap-1.5">
                      <Show when={isBlocked}>
                        <span class="iconify mdi--lock-outline size-3.5 text-amber-500 shrink-0" />
                      </Show>
                      <span class="truncate">{issue.title}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <Badge variant="outline" class={cn("text-[10px] uppercase py-0 px-1.5", typeStyle)}>
                      {issue.issueType}
                    </Badge>
                  </td>
                  <td class="px-3 py-2">
                    <Badge variant="secondary" class="text-[10px]">
                      {issue.status}
                    </Badge>
                  </td>
                  <td class="px-3 py-2">
                    <Badge variant="outline" class={cn("text-[10px] font-bold py-0 px-1.5", priorityMeta.badgeClass)}>
                      {priorityMeta.label}
                    </Badge>
                  </td>
                  <td class="px-3 py-2 text-xs font-mono text-muted-foreground">
                    {issue.parent ?? "—"}
                  </td>
                  <td class="px-3 py-2 text-xs text-muted-foreground">
                    {issue.assignee ?? "—"}
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>

      <Show when={filteredIssues().length === 0}>
        <p class="px-3 py-8 text-center text-xs text-muted-foreground">
          {t("beads.noIssuesFound") as string}
        </p>
      </Show>
    </div>
  );
};
