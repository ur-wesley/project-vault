import { Show, createMemo, createSignal } from "solid-js";
import { StackIcon } from "~/components/StackIcon";
import { ProjectAvatar } from "~/components/ProjectAvatar";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { useLivePlaytime } from "~/lib/live-playtime-context";
import { formatRelativeTime } from "~/lib/format-date";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import type { ProjectDto } from "~/types/dto";
import { ProjectDiskUsageDialog } from "./ProjectDiskUsageDialog";

export function ProjectCard(props: {
  project: ProjectDto;
  selected: boolean;
  isRunning: boolean;
  hasDefaultIde: boolean;
  onOpenProject: () => void;
  onOpenProjectTab: (tab: string) => void;
  onToggleFavorite: (e: MouseEvent) => void;
  onPlay: (e: MouseEvent) => void;
}) {
  const { t, localeCode } = useI18n();
  const { getLivePlaytimeMs } = useLivePlaytime();
  const [diskUsageOpen, setDiskUsageOpen] = createSignal(false);

  const livePlaytimeMs = createMemo(() =>
    getLivePlaytimeMs(props.project.id, props.project.totalPlaytimeMs)(),
  );

  const formatPlaytime = (ms: number) => {
    if (ms <= 0) return null;
    const hours = ms / (1000 * 60 * 60);
    if (hours < 0.1) return "< 0.1h";
    return `${hours.toFixed(1)}h`;
  };

  return (
    <div
      role="button"
      tabindex="0"
      class="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border/80 bg-card p-3 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40 hover:shadow-md active:scale-[0.98]"
      classList={{
        "border-primary/50 ring-2 ring-primary/10 bg-primary/5": props.selected,
      }}
      onClick={() => props.onOpenProject()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpenProject();
        }
      }}
    >
      {/* Card Header: Name + Stack */}
      <div class="flex flex-1 items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <Show when={props.project.tags.includes("monorepo")}>
              <StackIcon stack="monorepo" class="size-3.5 shrink-0 opacity-80" />
            </Show>
            <Show when={props.project.iconPath}>
              <ProjectAvatar project={props.project} class="size-5 shrink-0" noTooltip />
            </Show>
            <p class="truncate text-sm font-bold leading-tight text-foreground group-hover:text-primary transition-colors">
              {props.project.name}
            </p>
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger as="div" class="flex items-center gap-1 opacity-70">
                <StackIcon stack={props.project.stack} class="h-3 w-3" />
                <span class="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {props.project.stack}
                </span>
              </TooltipTrigger>
              <TooltipContent>{props.project.stack}</TooltipContent>
            </Tooltip>
            <Show when={props.project.runtimeHint}>
              <div class="flex items-center gap-1 border-l border-border/50 pl-1.5">
                <StackIcon stack={props.project.runtimeHint!} class="size-3 opacity-80" />
                <span class="text-[10px] font-medium text-muted-foreground/80">
                  {props.project.runtimeHint}
                </span>
              </div>
            </Show>
          </div>
        </div>

        {/* Favorite Toggle */}
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
              props.project.favorite
                ? "text-yellow-500 hover:bg-yellow-500/10"
                : "text-muted-foreground/40 hover:text-yellow-500 hover:bg-muted",
            )}
            onClick={(e) => props.onToggleFavorite(e)}
          >
            <span
              class={cn(
                "iconify size-4",
                props.project.favorite ? "mdi--star" : "mdi--star-outline",
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {props.project.favorite
              ? (t("library.unfavorite") as string)
              : (t("library.favorite") as string)}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Card Footer: Metadata + IDE */}
      <div class="mt-auto flex items-center justify-between border-t border-border/40 pt-2">
        <div class="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              as="div"
              class="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5"
            >
              <span class="iconify mdi--file-multiple-outline text-muted-foreground/60 size-3" />
              <span class="text-[10px] font-mono font-medium text-muted-foreground">
                {props.project.fileCount}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("library.fileCount") as string}</TooltipContent>
          </Tooltip>
          <Show when={props.project.sizeBytes > 0}>
            <Tooltip>
              <TooltipTrigger
                as="button"
                type="button"
                class="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 transition-colors hover:bg-muted/80 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setDiskUsageOpen(true);
                }}
              >
                <span class="iconify mdi--harddisk text-muted-foreground/60 size-3" />
                <span class="text-[10px] font-mono font-medium text-muted-foreground">
                  {formatBytes(props.project.sizeBytes)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("library.diskUsageViewBreakdown") as string}</TooltipContent>
            </Tooltip>
          </Show>
          <Show
            when={
              formatRelativeTime(props.project.lastEditedAtMs, localeCode()) ||
              formatPlaytime(livePlaytimeMs())
            }
          >
            <Tooltip>
              <TooltipTrigger
                as="div"
                class="hidden sm:flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5"
              >
                <Show when={formatPlaytime(livePlaytimeMs())}>
                  <span class="iconify mdi--clock-outline text-muted-foreground/60 size-3" />
                  <span class="text-[10px] font-mono font-medium text-muted-foreground">
                    {formatPlaytime(livePlaytimeMs())}
                  </span>
                </Show>
                <Show
                  when={
                    formatRelativeTime(props.project.lastEditedAtMs, localeCode()) &&
                    formatPlaytime(livePlaytimeMs())
                  }
                >
                  <span class="mx-0.5 h-2.5 w-px bg-border/60" />
                </Show>
                <Show
                  when={formatRelativeTime(props.project.lastEditedAtMs, localeCode())}
                >
                  <span class="iconify mdi--pencil-outline text-muted-foreground/60 size-3" />
                  <span class="text-[10px] font-mono font-medium text-muted-foreground">
                    {formatRelativeTime(props.project.lastEditedAtMs, localeCode())}
                  </span>
                </Show>
              </TooltipTrigger>
              <TooltipContent>{`${t("library.totalPlaytime") as string} · ${t("library.lastEdited") as string}`}</TooltipContent>
            </Tooltip>
          </Show>
        </div>

        <Show
          when={props.hasDefaultIde}
          fallback={
            <span class="text-[9px] text-muted-foreground opacity-50">
              {t("library.noIdeFound") as string}
            </span>
          }
        >
          <Tooltip>
            <TooltipTrigger
              as={Button}
              type="button"
              size="icon"
              variant={props.isRunning ? "default" : "secondary"}
              class={cn(
                "size-7 shrink-0 rounded-md transition-all hover:shadow-sm",
                props.isRunning
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20"
                  : "hover:bg-primary hover:text-primary-foreground",
              )}
              onClick={(e) => props.onPlay(e)}
            >
              <Show
                when={props.isRunning}
                fallback={<span class="iconify mdi--play size-4" />}
              >
                <span class="iconify mdi--stop size-4 animate-in zoom-in duration-300" />
              </Show>
            </TooltipTrigger>
            <TooltipContent>
              {props.isRunning
                ? (t("library.stopIde") as string)
                : (t("library.playInIde") as string)}
            </TooltipContent>
          </Tooltip>
        </Show>
      </div>

      {/* Quick Nav Actions */}
      <div class="-mx-3 -mb-3 mt-1 flex divide-x divide-border/40 border-t border-border/40">
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenProjectTab("files");
          }}
        >
          <span class="iconify mdi--folder-open-outline size-3" />
          <span class="truncate">{t("projectDetail.tabFiles")}</span>
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenProjectTab("issues");
          }}
        >
          <span class="iconify mdi--alert-circle-outline size-3" />
          <span class="truncate">{t("projectDetail.tabIssues")}</span>
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenProjectTab("tasks");
          }}
        >
          <span class="iconify mdi--play-circle-outline size-3" />
          <span class="truncate">{t("projectDetail.tabTasks")}</span>
        </button>
        <button
          type="button"
          class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenProjectTab("terminal");
          }}
        >
          <span class="iconify mdi--console-line size-3" />
          <span class="truncate">{t("projectDetail.tabTerminal")}</span>
        </button>
      </div>
      <ProjectDiskUsageDialog
        open={diskUsageOpen()}
        onOpenChange={setDiskUsageOpen}
        projectName={props.project.name}
        projectPath={props.project.path}
        projectSizeBytes={props.project.sizeBytes}
      />
    </div>
  );
}
