import { Match, Show, Switch, createMemo, type Component } from "solid-js";
import { createQuery } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { openExternal } from "~/lib/open-external";
import { stableErrorMessage } from "~/lib/invoke-error";
import { cn } from "~/lib/utils";
import { latestRunStatus, listWorkflowRuns } from "~/services/github-actions";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto } from "~/types/dto";

const ActionsStatusPill: Component<{
  projectId: string;
  owner: string;
  repo: string;
}> = (props) => {
  const { t } = useI18n();
  const runsQ = createQuery(() => ({
    queryKey: queryKeys.githubActionRuns(props.projectId),
    queryFn: async () => {
      const r = await listWorkflowRuns(props.owner, props.repo, 5);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    refetchInterval: 60_000,
    retry: false,
  }));

  const status = createMemo(() => latestRunStatus(runsQ.data));
  const latest = createMemo(() => runsQ.data?.[0] ?? null);
  const actionsUrl = `https://github.com/${props.owner}/${props.repo}/actions`;

  return (
    <div class="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 py-0.5 pl-1.5 pr-1">
      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          class="flex min-w-0 items-center gap-1.5"
          onClick={() => {
            const href = latest()?.htmlUrl ?? actionsUrl;
            void openExternal(href);
          }}
        >
          <Show
            when={runsQ.isPending}
            fallback={
              <Switch
                fallback={
                  <span class="iconify mdi--github size-3.5 shrink-0 text-muted-foreground" />
                }
              >
                <Match when={status() === "success"}>
                  <span class="iconify mdi--check-circle size-3.5 shrink-0 text-green-500" />
                </Match>
                <Match when={status() === "failure"}>
                  <span class="iconify mdi--alert-circle size-3.5 shrink-0 text-destructive" />
                </Match>
                <Match when={status() === "running"}>
                  <span class="iconify mdi--loading animate-spin size-3.5 shrink-0 text-blue-500" />
                </Match>
              </Switch>
            }
          >
            <span class="iconify mdi--loading animate-spin size-3.5 shrink-0 text-muted-foreground" />
          </Show>
          <span class="max-w-[160px] truncate text-[11px] font-semibold">
            <Show when={latest()} fallback={t("projectDetail.integrationsActions") as string}>
              {(run) => <span>{run().displayTitle}</span>}
            </Show>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <Show
            when={runsQ.isError}
            fallback={t("projectDetail.integrationsActionsOpen") as string}
          >
            {runsQ.error
              ? stableErrorMessage(t, runsQ.error as never)
              : (t("projectDetail.integrationsActionsOpen") as string)}
          </Show>
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => void runsQ.refetch()}
        title={t("common.refresh") as string}
      >
        <span class="iconify mdi--refresh size-3" />
      </button>
    </div>
  );
};

const DeployBadges: Component<{ project: ProjectDto }> = (props) => {
  const { t } = useI18n();
  const tags = createMemo(() => props.project.tags ?? []);
  const hasDokploy = createMemo(() => tags().includes("dokploy"));
  const hasDocker = createMemo(() => tags().includes("docker") || tags().includes("compose"));

  return (
    <Show when={hasDokploy() || hasDocker()}>
      <div class="flex shrink-0 items-center gap-1.5">
        <Show when={hasDokploy()}>
          <Tooltip>
            <TooltipTrigger as="div">
              <Badge
                variant="secondary"
                class="gap-1 border-indigo-500/30 bg-indigo-500/10 text-[10px] text-indigo-400"
              >
                <span class="iconify mdi--cloud-upload-outline size-3" />
                {t("projectDetail.integrationsDokploy") as string}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{t("projectDetail.integrationsDokployHint") as string}</TooltipContent>
          </Tooltip>
        </Show>
        <Show when={hasDocker()}>
          <Tooltip>
            <TooltipTrigger as="div">
              <Badge variant="outline" class="gap-1 text-[10px]">
                <span class="iconify mdi--docker size-3" />
                Docker
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{t("projectDetail.integrationsDockerHint") as string}</TooltipContent>
          </Tooltip>
        </Show>
      </div>
    </Show>
  );
};

export const IntegrationsBar: Component<{
  project: () => ProjectDto;
  github: () => { owner: string; repo: string } | null;
  class?: string;
}> = (props) => {
  const hasActions = createMemo(() => (props.project().tags ?? []).includes("github-actions"));
  const hasDeploy = createMemo(() => {
    const tags = props.project().tags ?? [];
    return tags.includes("dokploy") || tags.includes("docker") || tags.includes("compose");
  });

  return (
    <Show when={hasActions() || hasDeploy()}>
      <div class={cn("flex min-w-0 flex-nowrap items-center gap-1.5", props.class)}>
        <Show when={hasActions() && props.github() != null}>
          <ActionsStatusPill
            projectId={props.project().id}
            owner={props.github()!.owner}
            repo={props.github()!.repo}
          />
        </Show>
        <Show when={hasActions() && props.github() == null}>
          <Badge variant="outline" class="shrink-0 gap-1 text-[10px]">
            <span class="iconify mdi--github size-3" />
            Actions
          </Badge>
        </Show>
        <DeployBadges project={props.project()} />
      </div>
    </Show>
  );
};
