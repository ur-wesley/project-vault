import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { openExternal } from "~/lib/open-external";
import { CopyButton } from "~/components/CopyButton";
import { ProjectAvatar } from "~/components/ProjectAvatar";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Header title block: avatar, project name (plain or GitHub
 * link), remote copy button, owner/repo subline.
 * Back nav lives in ProjectDetailHeader so the meta row below
 * aligns after the back button.
 * (Extracted verbatim from ProjectDetailHeader.)
 */
export const HeaderTitle: Component<{
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
}> = (props) => {
  const { t, m, p } = props;

  return (
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <Tooltip>
        <TooltipTrigger as="div">
          <Badge
            variant="secondary"
            class="inline-flex size-6 shrink-0 items-center justify-center p-0.5"
          >
            <ProjectAvatar project={p()} class="size-4" noTooltip />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{p().stack}</TooltipContent>
      </Tooltip>
      <div class="flex min-w-0 flex-col">
        <div class="flex items-center gap-1.5">
          <div class="flex min-w-0 items-center gap-2">
            <Show
              when={m().ghQ.data}
              fallback={
                <h1 class="truncate text-sm font-bold tracking-tight text-foreground">
                  {p().name}
                </h1>
              }
            >
              {(g) => {
                const u = () =>
                  g().owner && g().repo ? `https://github.com/${g().owner}/${g().repo}` : null;
                return (
                  <Show
                    when={u()}
                    fallback={
                      <h1 class="truncate text-sm font-bold tracking-tight text-foreground">
                        {p().name}
                      </h1>
                    }
                  >
                    {(href) => (
                      <Tooltip>
                        <TooltipTrigger
                          as="button"
                          type="button"
                          class="group/gh flex min-w-0 items-center gap-1.5 text-sm font-bold tracking-tight hover:text-primary transition-colors"
                          onClick={() => openExternal(href())}
                        >
                          <span class="iconify mdi--github size-4 shrink-0 text-muted-foreground group-hover/gh:text-primary" />
                          <h1 class="truncate">{p().name}</h1>
                        </TooltipTrigger>
                        <TooltipContent>
                          {
                            t("projectDetail.openOnGithub", {
                              owner: g().owner,
                              repo: g().repo,
                            }) as string
                          }
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </Show>
                );
              }}
            </Show>
          </div>

          <Show when={m().gitRemoteQ.data}>
            {(remoteUrl) => (
              <CopyButton
                value={remoteUrl()}
                tooltip={t("projectDetail.copyGitRemote") as string}
              />
            )}
          </Show>
        </div>
        <Show
          when={
            m().ghQ.data?.owner &&
            m().ghQ.data?.repo &&
            (m().ghQ.data?.repo.toLowerCase() !== p().name.toLowerCase() || m().ghQ.data?.owner)
          }
        >
          <p class="mt-0.5 truncate text-[10px] font-medium leading-tight text-muted-foreground/70">
            {m().ghQ.data?.owner}/{m().ghQ.data?.repo}
          </p>
        </Show>
      </div>
    </div>
  );
};
