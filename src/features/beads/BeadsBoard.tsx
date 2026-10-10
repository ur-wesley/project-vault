import { For, Show, createMemo, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { useI18n } from "~/lib/i18n-context";
import type { BeadIssueDto } from "~/types/dto/beads";
import { BeadsCardView } from "./BeadsCardView";
import {
  BEADS_STATUS_COLUMNS,
  type BeadsColumnStatus,
  type BeadsFilters,
} from "./types";

type Props = {
  issues: BeadIssueDto[];
  filters: BeadsFilters;
  onOpen: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
};

export const BeadsBoard: Component<Props> = (props) => {
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

  const issuesByColumn = createMemo(() => {
    const map: Record<BeadsColumnStatus, BeadIssueDto[]> = {
      open: [],
      in_progress: [],
      blocked: [],
      deferred: [],
      closed: [],
    };

    for (const issue of filteredIssues()) {
      const col = (issue.status.toLowerCase() as BeadsColumnStatus);
      if (map[col]) {
        map[col].push(issue);
      } else {
        map.open.push(issue);
      }
    }

    return map;
  });

  const columnLabel = (col: BeadsColumnStatus) => {
    switch (col) {
      case "open":
        return t("beads.colOpen") as string;
      case "in_progress":
        return t("beads.colInProgress") as string;
      case "blocked":
        return t("beads.colBlocked") as string;
      case "deferred":
        return t("beads.colDeferred") as string;
      case "closed":
        return t("beads.colClosed") as string;
    }
  };

  return (
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <For each={BEADS_STATUS_COLUMNS}>
        {(column) => {
          const items = () => issuesByColumn()[column] ?? [];
          return (
            <section class="flex min-h-40 flex-col rounded-lg border bg-muted/30">
              <header class="flex items-center justify-between border-b px-3 py-2">
                <h3 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {columnLabel(column)}
                </h3>
                <Badge variant="secondary" class="font-mono text-xs">
                  {items().length}
                </Badge>
              </header>

              <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                <For each={items()}>
                  {(issue) => (
                    <BeadsCardView
                      issue={issue}
                      onOpen={props.onOpen}
                      onStatusChange={props.onStatusChange}
                    />
                  )}
                </For>

                <Show when={items().length === 0}>
                  <div class="flex flex-1 items-center justify-center py-8 text-center">
                    <p class="text-xs text-muted-foreground/60">
                      {t("beads.emptyColumn") as string}
                    </p>
                  </div>
                </Show>
              </div>
            </section>
          );
        }}
      </For>
    </div>
  );
};
