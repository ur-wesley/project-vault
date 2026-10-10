import { Show, createMemo, type Component } from "solid-js";

import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import { BeadCreateDialog } from "./BeadCreateDialog";
import { BeadDetailDialog } from "./BeadDetailDialog";
import { BeadsBoard } from "./BeadsBoard";
import { BeadsFilterBar } from "./BeadsFilterBar";
import { BeadsListView } from "./BeadsListView";
import { useBeads } from "./useBeads";

type Props = {
  projectId: string;
  projectPath: string;
};

export const BeadsView: Component<Props> = (props) => {
  const { t } = useI18n();

  const model = useBeads(
    () => props.projectId,
    () => props.projectPath,
  );

  const selectedIssue = createMemo(() => {
    const id = model.selectedIssueId();
    if (!id) return null;
    return (model.issuesQ.data ?? []).find((i) => i.id === id) ?? null;
  });

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col gap-3">
      {/* Loading state */}
      <Show when={model.statusQ.isPending}>
        <div class="flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
          {t("beads.loading") as string}
        </div>
      </Show>

      {/* Error state */}
      <Show when={model.statusQ.isError}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center text-destructive">
          <span class="iconify mdi--alert-circle-outline size-12" />
          <h3 class="text-sm font-semibold">{t("beads.loadIssuesFailed") as string}</h3>
          <p class="max-w-md text-xs text-muted-foreground">
            {model.statusQ.error?.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void model.statusQ.refetch()}>
            {t("beads.retryCheck") as string}
          </Button>
        </div>
      </Show>

      {/* CLI Not Installed */}
      <Show when={!model.statusQ.isPending && !model.statusQ.isError && !model.statusQ.data?.installed}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span class="iconify mdi--alert-circle-outline size-12 text-amber-500/80" />
          <h3 class="text-sm font-semibold">{t("beads.cliNotFoundTitle") as string}</h3>
          <p class="max-w-md text-xs leading-relaxed text-muted-foreground">
            {t("beads.cliNotFoundDesc") as string}
          </p>
          <div class="flex items-center gap-2 mt-2">
            <code class="rounded bg-muted px-2 py-1 font-mono text-xs">
              npm i -g @gastownhall/beads
            </code>
            <Button size="sm" variant="outline" onClick={() => void model.statusQ.refetch()}>
              {t("beads.retryCheck") as string}
            </Button>
          </div>
        </div>
      </Show>

      {/* Not Initialized */}
      <Show
        when={
          !model.statusQ.isPending &&
          model.statusQ.data?.installed &&
          !model.statusQ.data?.initialized
        }
      >
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span class="iconify mdi--dots-hexagon size-12 text-muted-foreground/40" />
          <h3 class="text-sm font-semibold">{t("beads.notInitializedTitle") as string}</h3>
          <p class="max-w-md text-xs leading-relaxed text-muted-foreground">
            {t("beads.notInitializedDesc") as string}
          </p>
          <Button
            size="sm"
            class="mt-2 gap-1.5"
            disabled={model.initMu.isPending}
            onClick={() => model.initMu.mutate()}
          >
            <span class="iconify mdi--play-outline size-4" />
            {model.initMu.isPending ? (t("beads.initializing") as string) : (t("beads.initializeButton") as string)}
          </Button>
        </div>
      </Show>

      {/* Active Beads Interface */}
      <Show
        when={
          !model.statusQ.isPending &&
          model.statusQ.data?.installed &&
          model.statusQ.data?.initialized
        }
      >
        <BeadsFilterBar
          filters={model.filters()}
          layout={model.layout()}
          onFilters={model.setFilters}
          onLayout={model.setLayout}
          onCreateOpen={() => model.setIsCreateOpen(true)}
        />

        <Show when={model.issuesQ.isPending}>
          <div class="flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
            {t("beads.loadingIssues") as string}
          </div>
        </Show>

        <Show when={model.issuesQ.isError}>
          <div class="flex flex-1 items-center justify-center p-8 text-center text-xs text-destructive">
            {t("beads.loadIssuesFailed") as string}
          </div>
        </Show>

        <Show when={!model.issuesQ.isPending && !model.issuesQ.isError}>
          <Show when={model.layout() === "board"}>
            <BeadsBoard
              issues={model.issuesQ.data ?? []}
              filters={model.filters()}
              onOpen={model.setSelectedIssueId}
              onStatusChange={(id, status) => model.updateStatusMu.mutate({ id, status })}
            />
          </Show>

          <Show when={model.layout() === "list"}>
            <BeadsListView
              issues={model.issuesQ.data ?? []}
              filters={model.filters()}
              onOpen={model.setSelectedIssueId}
            />
          </Show>
        </Show>

        {/* Dialogs */}
        <BeadDetailDialog
          projectPath={props.projectPath}
          issue={selectedIssue()}
          onClose={() => model.setSelectedIssueId(null)}
          onStatusChange={(id, status, reason) =>
            model.updateStatusMu.mutate({ id, status, closeReason: reason })
          }
          onAddComment={(id, comment) => model.addCommentMu.mutate({ id, comment })}
          onSelectIssue={model.setSelectedIssueId}
        />

        <BeadCreateDialog
          open={model.isCreateOpen()}
          onClose={() => model.setIsCreateOpen(false)}
          onSubmit={(data) => model.createIssueMu.mutate(data)}
          isSubmitting={model.createIssueMu.isPending}
        />
      </Show>
    </div>
  );
};
