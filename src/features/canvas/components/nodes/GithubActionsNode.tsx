import { For, Show, createMemo, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";

import { useI18n } from "~/lib/i18n-context";
import { openExternal } from "~/lib/open-external";
import { stableErrorMessage } from "~/lib/invoke-error";
import { latestRunStatus, listWorkflowRuns } from "~/services/github-actions";
import { queryKeys } from "~/services/query-keys";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";

function getActionsBadge(isLinked: boolean, status: string): string {
  if (!isLinked) return "Not linked";
  if (status === "running") return "Running";
  if (status === "success") return "Passing";
  if (status === "failure") return "Failing";
  return "Actions";
}

function getActionsBadgeVariant(status: string): "nominal" | "red" | "amber" {
  if (status === "failure") return "red";
  if (status === "running") return "amber";
  return "nominal";
}

export const GithubActionsNode: Component<CanvasNodeComponentProps> = (props) => {
  const { t } = useI18n();
  const projectId = createMemo(() => props.project().id);
  const github = createMemo(() => {
    const p = props.project();
    if (p.githubOwner && p.githubRepo) {
      return { owner: p.githubOwner, repo: p.githubRepo };
    }
    return null;
  });

  const runsQ = createQuery(() => ({
    queryKey: queryKeys.githubActionRuns(projectId()),
    queryFn: async () => {
      const g = github();
      if (!g) return [];
      const r = await listWorkflowRuns(g.owner, g.repo, 5);
      if (r.isErr()) throw r.error;
      return [...r.value];
    },
    enabled: github() != null,
    refetchInterval: 60_000,
    retry: false,
  }));

  const status = createMemo(() => latestRunStatus(runsQ.data));
  const latest = createMemo(() => runsQ.data?.[0] ?? null);

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--github"
      badge={getActionsBadge(github() != null, status())}
      badgeVariant={getActionsBadgeVariant(status())}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable={false}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex flex-col gap-2">
        <Show
          when={github() != null}
          fallback={
            <p class="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {t("projectDetail.integrationsActionsLinkHint") as string}
            </p>
          }
        >
          <Show when={runsQ.isPending}>
            <div class="flex items-center justify-center py-4">
              <span class="iconify mdi--loading animate-spin size-5 text-muted-foreground/40" />
            </div>
          </Show>
          <Show when={runsQ.isError}>
            <p class="rounded bg-destructive/10 p-2 text-[11px] text-destructive">
              {stableErrorMessage(t, runsQ.error as never)}
            </p>
          </Show>
          <Show when={runsQ.isSuccess && (runsQ.data?.length ?? 0) === 0}>
            <p class="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {t("projectDetail.integrationsActionsEmpty") as string}
            </p>
          </Show>
          <Show when={(runsQ.data?.length ?? 0) > 0}>
            <div class="flex flex-col gap-1">
              <For each={runsQ.data!.slice(0, 5)}>
                {(run) => (
                  <button
                    type="button"
                    onClick={() => void openExternal(run.htmlUrl)}
                    class="flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted"
                  >
                    <span
                      class="iconify size-3.5 shrink-0"
                      classList={{
                        "mdi--check-circle text-green-500": run.conclusion === "success",
                        "mdi--alert-circle text-destructive":
                          run.conclusion === "failure" || run.conclusion === "timed_out",
                        "mdi--loading animate-spin text-blue-500":
                          run.status === "in_progress" ||
                          run.status === "queued" ||
                          run.status === "waiting",
                        "mdi--circle-outline text-muted-foreground":
                          run.status !== "in_progress" &&
                          run.status !== "queued" &&
                          run.status !== "waiting" &&
                          run.conclusion !== "success" &&
                          run.conclusion !== "failure" &&
                          run.conclusion !== "timed_out",
                      }}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-foreground">
                        {run.displayTitle}
                      </span>
                      <span class="block truncate font-mono text-[10px] text-muted-foreground">
                        {run.branch ?? run.event}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={latest()}>
            {(run) => (
              <button
                type="button"
                onClick={() => void openExternal(run().htmlUrl)}
                class="flex items-center justify-center gap-1.5 rounded border border-border/60 bg-secondary/50 py-1 text-[11px] font-medium transition-all hover:bg-secondary active:scale-95"
              >
                <span class="iconify mdi--open-in-new size-3.5" />
                {t("projectDetail.integrationsActionsOpen") as string}
              </button>
            )}
          </Show>
        </Show>
      </div>
    </CanvasNodeContainer>
  );
};
