import { For, Show, type Component } from "solid-js";
import type { Accessor, Setter } from "solid-js";

import { cn } from "~/lib/utils";
import { toggleProjectPin } from "~/lib/project-pins";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import type { useI18n } from "~/lib/i18n-context";
import type { ProjectDto } from "~/types/dto";
import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type T = ReturnType<typeof useI18n>["t"];

export type TitlebarActionProps = {
  t: T;
  m: Accessor<ProjectDetailModel>;
  p: Accessor<ProjectDto>;
  pinned: Accessor<boolean>;
  tabsEnabled: Accessor<boolean>;
  incomingOpen: Accessor<boolean>;
  setIncomingOpen: Setter<boolean>;
  setDeleteConfirmOpen: Setter<boolean>;
  setCleanDialogOpen: Setter<boolean>;
  setTagDialogOpen: Setter<boolean>;
};

/**
 * Desktop titlebar action row: pin, favorite, git popover, init, explorer,
 * move, clean, delete. (Extracted verbatim from ProjectDetailHeader.)
 */
export const TitlebarDesktopActions: Component<TitlebarActionProps> = (props) => {
  const { t, m, p, pinned, tabsEnabled } = props;

  return (
    <div class="hidden items-stretch sm:flex">
      <Show when={tabsEnabled()}>
        <Tooltip openDelay={400}>
          <TooltipTrigger
            as={Button}
            type="button"
            variant="ghost"
            size="icon"
            class={cn(
              "h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground",
              pinned() && "text-primary hover:text-primary",
            )}
            onClick={() => toggleProjectPin(p().id)}
          >
            <span class={cn("iconify size-4", pinned() ? "mdi--pin" : "mdi--pin-outline")} />
          </TooltipTrigger>
          <TooltipContent>
            {pinned()
              ? (t("projectDetail.pinRemove") as string)
              : (t("projectDetail.pinAdd") as string)}
          </TooltipContent>
        </Tooltip>
      </Show>
      <Tooltip openDelay={400}>
        <TooltipTrigger
          as={Button}
          type="button"
          variant="ghost"
          size="icon"
          class={cn(
            "h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground",
            p().favorite && "text-yellow-500 hover:text-yellow-600",
          )}
          onClick={() => m().favMutate({ id: p().id, favorite: !p().favorite })}
        >
          <span class={cn("iconify size-4", p().favorite ? "mdi--star" : "mdi--star-outline")} />
        </TooltipTrigger>
        <TooltipContent>
          {p().favorite
            ? (t("projectDetail.favRemove") as string)
            : (t("projectDetail.favMark") as string)}
        </TooltipContent>
      </Tooltip>
      <Show when={m().gitStatusQ.data}>
        {(s) => (
          <Popover
            gutter={8}
            onOpenChange={(open) => {
              if (open) m().fetchAndRefresh();
            }}
          >
            <Tooltip openDelay={400}>
              <TooltipTrigger
                as={PopoverTrigger}
                variant="ghost"
                size="icon"
                class="inline-flex h-full w-8 items-center justify-center rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
              >
                <span class="iconify mdi--git size-4" />
              </TooltipTrigger>
              <TooltipContent>
                {
                  t("projectDetail.gitStatusTooltip", {
                    branch: s().branch,
                  }) as string
                }
              </TooltipContent>
            </Tooltip>
            <PopoverContent class="w-64 p-3 text-foreground shadow-xl border-border/40">
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="iconify mdi--git size-4 text-primary/80" />
                    <span class="max-w-[140px] truncate font-mono text-xs font-bold">
                      {s().branch}
                    </span>
                  </div>
                  <Show when={s().isDirty}>
                    <Badge
                      variant="outline"
                      class="h-5 bg-yellow-500/5 px-1.5 text-[9px] border-yellow-500/50 text-yellow-600"
                    >
                      {t("projectDetail.gitModified") as string}
                    </Badge>
                  </Show>
                </div>
                <div class="grid grid-cols-2 gap-2 border-t border-border/40 pt-1">
                  <div class="space-y-1">
                    <p class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {t("projectDetail.gitAhead") as string}
                    </p>
                    <div class="flex items-center gap-1.5">
                      <span class="iconify mdi--arrow-up size-3.5 text-green-500" />
                      <span class="font-mono text-sm font-bold tabular-nums">{s().ahead}</span>
                    </div>
                  </div>
                  <div class="space-y-1">
                    <p class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      {t("projectDetail.gitBehind") as string}
                    </p>
                    <div class="flex items-center gap-1.5">
                      <span class="iconify mdi--arrow-down size-3.5 text-blue-500" />
                      <span class="font-mono text-sm font-bold tabular-nums">{s().behind}</span>
                    </div>
                  </div>
                </div>
                <Show when={m().previewVersionsQ.data}>
                  {(v) => (
                    <div class="border-t border-border/40 pt-2 space-y-1.5">
                      <div class="flex items-center justify-between">
                        <span class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          Version
                        </span>
                        <span class="font-mono text-xs font-bold tabular-nums">
                          {v().currentVersion}
                        </span>
                      </div>
                      <Show when={v().latestTag}>
                        {(tag) => (
                          <div class="flex items-center justify-between">
                            <span class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                              Latest Tag
                            </span>
                            <span class="font-mono text-xs font-bold tabular-nums">{tag()}</span>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={s().hasUpstream}>
                  <div class="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      class="h-8 flex-1 gap-1.5 text-xs font-bold"
                      variant={s().ahead > 0 ? "default" : "secondary"}
                      disabled={m().isPushing() || m().isPulling()}
                      onClick={() => m().pushMutate()}
                    >
                      <Show
                        when={m().isPushing()}
                        fallback={<span class="iconify mdi--upload size-3.5" />}
                      >
                        <span class="iconify mdi--loading animate-spin size-3.5" />
                      </Show>
                      {t("projectDetail.gitPush") as string}
                    </Button>
                    <Button
                      size="sm"
                      class="h-8 flex-1 gap-1.5 text-xs font-bold"
                      variant={s().behind > 0 ? "default" : "secondary"}
                      disabled={m().isPulling() || m().isPushing()}
                      onClick={() => m().pullMutate()}
                    >
                      <Show
                        when={m().isPulling()}
                        fallback={<span class="iconify mdi--download size-3.5" />}
                      >
                        <span class="iconify mdi--loading animate-spin size-3.5" />
                      </Show>
                      {t("projectDetail.gitPull") as string}
                    </Button>
                  </div>
                  <Show when={s().behind > 0}>
                    <div class="border-t border-border/40 pt-2">
                      <button
                        type="button"
                        class="flex w-full items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => props.setIncomingOpen(!props.incomingOpen())}
                      >
                        <span>
                          {
                            t("projectDetail.gitIncomingTitle", {
                              count: s().behind,
                            }) as string
                          }
                        </span>
                        <span
                          class={`iconify mdi--chevron-down size-3.5 transition-transform ${props.incomingOpen() ? "rotate-180" : ""}`}
                        />
                      </button>
                      <Show when={props.incomingOpen()}>
                        <div class="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto">
                          <Show
                            when={!m().gitIncomingQ.isFetching}
                            fallback={
                              <div class="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                                <span class="iconify mdi--loading animate-spin size-3" />
                                {t("projectDetail.gitFetching") as string}
                              </div>
                            }
                          >
                            <Show
                              when={(m().gitIncomingQ.data?.commits.length ?? 0) > 0}
                              fallback={
                                <p class="py-1 text-xs text-muted-foreground">
                                  {t("projectDetail.gitNoIncoming") as string}
                                </p>
                              }
                            >
                              <For each={m().gitIncomingQ.data?.commits}>
                                {(commit) => (
                                  <div class="flex flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-muted/50">
                                    <span
                                      class="truncate text-xs font-medium"
                                      title={commit.message}
                                    >
                                      {commit.message}
                                    </span>
                                    <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                      <span>{commit.author}</span>
                                      <span>·</span>
                                      <span>{commit.relativeTime}</span>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="border-t border-border/40 pt-2">
                    <Button
                      size="sm"
                      class="h-8 w-full gap-1.5 text-xs font-bold"
                      variant="outline"
                      disabled={m().isTagging()}
                      onClick={() => props.setTagDialogOpen(true)}
                    >
                      <Show
                        when={m().isTagging()}
                        fallback={<span class="iconify mdi--tag-plus size-3.5" />}
                      >
                        <span class="iconify mdi--loading animate-spin size-3.5" />
                      </Show>
                      {t("projectDetail.gitPushTag") as string}
                    </Button>
                  </div>
                </Show>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </Show>
      <Show when={m().gitStatusQ.data == null && !m().gitStatusQ.isPending}>
        <Tooltip openDelay={400}>
          <TooltipTrigger
            as={Button}
            type="button"
            variant="ghost"
            size="icon"
            class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
            disabled={m().isIniting()}
            onClick={() => m().initMutate()}
          >
            <Show when={m().isIniting()} fallback={<span class="iconify mdi--git size-4" />}>
              <span class="iconify mdi--loading animate-spin size-4" />
            </Show>
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.gitInit") as string}</TooltipContent>
        </Tooltip>
      </Show>
      <Tooltip openDelay={400}>
        <TooltipTrigger
          as={Button}
          type="button"
          variant="ghost"
          size="icon"
          class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
          onClick={() => void m().onOpenProjectInFileManager(p().path)}
        >
          <span class="iconify mdi--folder-open size-4" />
        </TooltipTrigger>
        <TooltipContent>{t("projectDetail.openInSystemExplorer") as string}</TooltipContent>
      </Tooltip>
      <Tooltip openDelay={400}>
        <TooltipTrigger
          as={Button}
          type="button"
          variant="ghost"
          size="icon"
          class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
          onClick={() => {
            m().setMoveTargetLocationId(null);
            m().setMoveOpen(true);
          }}
        >
          <span class="iconify mdi--file-move size-4" />
        </TooltipTrigger>
        <TooltipContent>{t("projectDetail.moveProject") as string}</TooltipContent>
      </Tooltip>
      <Show when={m().gitStatusQ.data}>
        <Tooltip openDelay={400}>
          <TooltipTrigger
            as={Button}
            type="button"
            variant="ghost"
            size="icon"
            class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
            onClick={() => props.setCleanDialogOpen(true)}
          >
            <span class="iconify mdi--broom size-4" />
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.cleanProject") as string}</TooltipContent>
        </Tooltip>
      </Show>
      <Tooltip openDelay={400}>
        <TooltipTrigger
          as={Button}
          type="button"
          variant="ghost"
          size="icon"
          class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => props.setDeleteConfirmOpen(true)}
        >
          <span class="iconify mdi--trash-can-outline size-4" />
        </TooltipTrigger>
        <TooltipContent>{t("projectDetail.deleteProject") as string}</TooltipContent>
      </Tooltip>
    </div>
  );
};
