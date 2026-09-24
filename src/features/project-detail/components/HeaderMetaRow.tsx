import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { CopyButton } from "~/components/CopyButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { formatBytes } from "~/lib/format-bytes";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { IntegrationsBar } from "./IntegrationsBar";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Header meta row: project path + copy, disk usage, integrations.
 * (Extracted verbatim from ProjectDetailHeader.)
 */
export const HeaderMetaRow: Component<{
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
  github: Accessor<{ owner: string; repo: string } | null>;
  onOpenDiskUsage: () => void;
}> = (props) => {
  const { t, m, p, github, onOpenDiskUsage } = props;

  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div class="flex min-w-0 shrink items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            as="div"
            class="group/path flex min-w-0 cursor-pointer items-center gap-2"
            onClick={() => void m().onOpenProjectInFileManager(p().path)}
          >
            <span class="iconify mdi--folder size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/path:text-primary" />
            <p class="truncate font-mono text-[10px] text-muted-foreground/80 transition-colors group-hover/path:text-foreground">
              {p().path}
            </p>
          </TooltipTrigger>
          <TooltipContent>{t("library.openInFileManager") as string}</TooltipContent>
        </Tooltip>

        <CopyButton
          value={p().path}
          tooltip={t("projectDetail.copyPath") as string}
          iconClass="size-3"
          checkClass="size-3 text-green-500"
        />
      </div>
      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          class="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 py-0.5 pl-2 pr-1.5 transition-colors hover:bg-muted/80"
          onClick={onOpenDiskUsage}
        >
          <span class="flex items-center gap-1">
            <span class="iconify mdi--file-multiple-outline size-3 shrink-0 text-muted-foreground/60" />
            <span class="text-[10px] font-mono font-medium tabular-nums text-muted-foreground">
              {p().fileCount}
            </span>
          </span>
          <Show when={p().sizeBytes > 0}>
            <span class="h-3 w-px shrink-0 bg-border/60" />
            <span class="flex items-center gap-1">
              <span class="iconify mdi--harddisk size-3 shrink-0 text-muted-foreground/60" />
              <span class="text-[10px] font-mono font-medium tabular-nums text-muted-foreground">
                {formatBytes(p().sizeBytes)}
              </span>
            </span>
          </Show>
        </TooltipTrigger>
        <TooltipContent>{t("library.diskUsageViewBreakdown") as string}</TooltipContent>
      </Tooltip>
      <IntegrationsBar project={p} github={github} class="shrink-0" />
    </div>
  );
};
