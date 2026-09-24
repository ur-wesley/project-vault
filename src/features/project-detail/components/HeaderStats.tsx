import { Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { formatRelativeTime } from "~/lib/format-date";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import { formatWorktime } from "../lib/format";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Playtime + last-opened stats row.
 * (Extracted verbatim from ProjectDetailHeader, including the pre-existing
 * single-arg formatRelativeTime call — WIP signature drift, not touched.)
 */
export const HeaderStats: Component<{
  t: T;
  p: Accessor<ProjectDto>;
  livePlaytimeMs: Accessor<number>;
}> = (props) => {
  const { t, p, livePlaytimeMs } = props;

  return (
    <div class="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-muted-foreground/70">
      <Tooltip>
        <TooltipTrigger as="div" class="flex items-center gap-1 tabular-nums">
          <span class="iconify mdi--clock-outline size-3 shrink-0" />
          {formatWorktime(livePlaytimeMs())}
        </TooltipTrigger>
        <TooltipContent>{t("projectDetail.totalWorktime") as string}</TooltipContent>
      </Tooltip>
      <Show when={p().lastOpenedAtMs}>
        <span class="text-muted-foreground/40">·</span>
        <span class="truncate tabular-nums">
          {
            t("projectDetail.lastStartedRelative", {
              time: formatRelativeTime(p().lastOpenedAtMs),
            }) as string
          }
        </span>
      </Show>
    </div>
  );
};
