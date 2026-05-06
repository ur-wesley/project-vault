import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import type {
  DiscoverVersionFilesResultDto,
  GitCleanPreviewDto,
} from "~/types/dto";
import { Portal } from "solid-js/web";

import { StackIcon } from "~/components/StackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/checkbox";
import { useI18n } from "~/lib/i18n-context";
import { formatRelativeTime } from "~/lib/format-date";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import { formatWorktime } from "../lib/format";
import { LanguageBar } from "./LanguageBar";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { useLivePlaytime } from "~/lib/live-playtime-context";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type ProjectDetailHeaderProps = Readonly<{
  model: ProjectDetailModel;
}>;

// GitHub-like language colors
export const ProjectDetailHeader: Component<ProjectDetailHeaderProps> = (
  props,
) => {
  const { t } = useI18n();
  const { getLivePlaytimeMs } = useLivePlaytime();
  const m = () => props.model;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
  const [tagDialogOpen, setTagDialogOpen] = createSignal(false);
  const [tagStep, setTagStep] = createSignal<"bump" | "files">("bump");
  const [selectedBump, setSelectedBump] = createSignal<
    "patch" | "minor" | "major" | "beta"
  >("patch");
  const [discoveredFiles, setDiscoveredFiles] =
    createSignal<DiscoverVersionFilesResultDto | null>(null);
  const [selectedVersionFiles, setSelectedVersionFiles] = createSignal<
    Set<string>
  >(new Set<string>());
  const [tagError, setTagError] = createSignal<string | null>(null);
  const [cleanDialogOpen, setCleanDialogOpen] = createSignal(false);
  const [cleanPreview, setCleanPreview] =
    createSignal<GitCleanPreviewDto | null>(null);
  const [cleanSelected, setCleanSelected] = createSignal<Set<string>>(
    new Set<string>(),
  );
  const [cleanResetTracked, setCleanResetTracked] = createSignal(false);

  const openExternal = (href: string) =>
    isTauri()
      ? void openUrl(href)
      : window.open(href, "_blank", "noopener,noreferrer");

  return (
    <div class="shrink-0 border-b border-border/40 bg-background/50">
      <Show when={m().projectQ.data}>
        {(p) => {
          const livePlaytimeMs = createMemo(() =>
            getLivePlaytimeMs(p().id, p().totalPlaytimeMs)(),
          );
          return (
            <div class="flex items-center justify-between gap-6 px-4 py-3">
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="flex items-center gap-2 shrink-0">
                    <Tooltip>
                      <TooltipTrigger
                        as={Button}
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="h-7 px-1.5"
                        onClick={() => m().props.onBack()}
                      >
                        <span class="iconify mdi--arrow-left size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("projectDetail.backToLibrary") as string}
                      </TooltipContent>
                    </Tooltip>
                    <Separator orientation="vertical" class="h-4" />
                  </div>
                  <div class="flex min-w-0 items-center gap-3">
                    <Tooltip>
                      <TooltipTrigger as="div">
                        <Badge
                          variant="secondary"
                          class="inline-flex size-6 shrink-0 items-center justify-center p-0.5"
                        >
                          <StackIcon stack={p().stack} class="size-4" />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{p().stack}</TooltipContent>
                    </Tooltip>
                    <div class="flex min-w-0 flex-col">
                      <div class="flex items-center gap-2">
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
                              const u = createMemo(() =>
                                g().owner && g().repo
                                  ? `https://github.com/${g().owner}/${g().repo}`
                                  : null,
                              );
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
                      </div>
                      <Show
                        when={
                          m().ghQ.data?.owner &&
                          m().ghQ.data?.repo &&
                          (m().ghQ.data?.repo.toLowerCase() !==
                            p().name.toLowerCase() ||
                            m().ghQ.data?.owner)
                        }
                      >
                        <p class="mt-0.5 truncate text-[10px] font-medium leading-tight text-muted-foreground/70">
                          {m().ghQ.data?.owner}/{m().ghQ.data?.repo}
                        </p>
                      </Show>
                    </div>
                  </div>
                </div>
                <div class="ml-1 flex min-w-0 items-center gap-4">
                  <div class="flex min-w-0">
                    <Tooltip>
                      <TooltipTrigger
                        as="div"
                        class="group/path flex min-w-0 cursor-pointer items-center gap-2"
                        onClick={() =>
                          void m().onOpenProjectInFileManager(p().path)
                        }
                      >
                        <span class="iconify mdi--folder size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/path:text-primary" />
                        <p class="truncate font-mono text-[10px] text-muted-foreground/80 transition-colors group-hover/path:text-foreground">
                          {p().path}
                        </p>
                        <Show when={p().sizeBytes > 0}>
                          <span class="shrink-0 text-[10px] text-muted-foreground/40 transition-colors group-hover/path:text-muted-foreground/60">
                            · {formatBytes(p().sizeBytes)}
                          </span>
                        </Show>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("library.openInFileManager") as string}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <div class="flex flex-col items-center gap-1 shrink-0 self-center">
                <Show when={(m().idesQ.data?.length ?? 0) > 0}>
                  <div class="flex items-center rounded-full bg-primary/10 p-0.5 shadow-sm ring-1 ring-primary/20 transition-all hover:ring-primary/40">
                    <Show
                      when={m().ideRunningQ.data === true}
                      fallback={
                        <button
                          type="button"
                          class={cn(
                            "flex h-8 items-center gap-2 rounded-l-full pl-5 pr-4 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 active:scale-95",
                            m().selectedIdeExecutable() == null &&
                              "pointer-events-none opacity-30 grayscale",
                          )}
                          onClick={() => {
                            const ex = m().selectedIdeExecutable();
                            if (ex) void m().onOpenIde(p().id, ex);
                          }}
                        >
                          <Show when={m().selectedIdeOption()?.icon}>
                            <span
                              class={cn(
                                "iconify size-4.5",
                                m().selectedIdeOption()?.icon,
                              )}
                            />
                          </Show>
                          <span class="max-w-[120px] truncate">
                            {m().selectedIdeOption()?.label ??
                              (t("library.openInIde") as string)}
                          </span>
                          <span class="iconify mdi--play ml-0.5 size-5" />
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class="flex h-8 animate-in fade-in slide-in-from-right-0.5 items-center gap-2 rounded-l-full pl-5 pr-4 text-[11px] font-black uppercase tracking-widest text-destructive transition-colors duration-300 hover:bg-destructive/10 active:scale-95"
                        onClick={() => void m().onStopIde(p().id)}
                      >
                        <span class="iconify mdi--stop size-4.5" />
                        <span>{t("library.stopIde") as string}</span>
                      </button>
                    </Show>
                    <div class="mx-0.5 h-5 w-px bg-primary/20" />
                    <DropdownMenu gutter={8}>
                      <DropdownMenuTrigger
                        as={Button}
                        variant="ghost"
                        size="icon"
                        class="size-8 rounded-r-full text-primary transition-colors hover:bg-primary/10 focus:ring-0"
                      >
                        <span class="iconify mdi--chevron-down size-4.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent class="w-56 p-1.5 shadow-xl border-border/40">
                        <For each={m().ideSelectOptions()}>
                          {(opt) => (
                            <DropdownMenuItem
                              class="flex cursor-pointer items-center gap-2 px-2.5 py-2"
                              onClick={() =>
                                m().onIdeSelected(p().id, opt.executable)
                              }
                            >
                              <Show when={opt.icon}>
                                <span
                                  class={cn(
                                    "iconify size-4 shrink-0 text-muted-foreground",
                                    opt.icon,
                                  )}
                                />
                              </Show>
                              <span class="flex-1 text-xs font-bold tracking-tight text-foreground">
                                {opt.label}
                              </span>
                              <Show
                                when={
                                  m().selectedIdeExecutable() === opt.executable
                                }
                              >
                                <span class="iconify mdi--check size-3.5 text-primary" />
                              </Show>
                            </DropdownMenuItem>
                          )}
                        </For>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Show>
                <div class="flex items-center gap-2 px-3">
                  <Tooltip>
                    <TooltipTrigger
                      as="div"
                      class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground/80"
                    >
                      <span class="iconify mdi--clock-outline size-3" />
                      {formatWorktime(livePlaytimeMs())}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("projectDetail.totalWorktime") as string}
                    </TooltipContent>
                  </Tooltip>
                  <Show when={p().lastOpenedAtMs}>
                    <Separator
                      orientation="vertical"
                      class="h-2.5 opacity-40"
                    />
                    <div class="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">
                      {
                        t("projectDetail.lastStartedRelative", {
                          time: formatRelativeTime(p().lastOpenedAtMs),
                        }) as string
                      }
                    </div>
                  </Show>
                </div>
              </div>

              <Portal
                mount={document.getElementById("window-title-bar-actions")!}
              >
                <div class="flex h-full items-stretch animate-in fade-in slide-in-from-right-2 duration-300">
                  <Separator
                    orientation="vertical"
                    class="h-full w-px bg-border/60"
                  />

                  {/* Desktop View: Action Row */}
                  <div class="hidden items-stretch sm:flex">
                    <Tooltip openDelay={400}>
                      <TooltipTrigger
                        as={Button}
                        type="button"
                        variant="ghost"
                        size="icon"
                        class={cn(
                          "h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground",
                          p().favorite &&
                            "text-yellow-500 hover:text-yellow-600",
                        )}
                        onClick={() =>
                          m().favMutate({ id: p().id, favorite: !p().favorite })
                        }
                      >
                        <span
                          class={cn(
                            "iconify size-4",
                            p().favorite ? "mdi--star" : "mdi--star-outline",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {p().favorite
                          ? (t("projectDetail.favRemove") as string)
                          : (t("projectDetail.favMark") as string)}
                      </TooltipContent>
                    </Tooltip>
                    <Show when={m().gitStatusQ.data}>
                      {(s) => (
                        <Popover gutter={8}>
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
                                    <span class="font-mono text-sm font-bold tabular-nums">
                                      {s().ahead}
                                    </span>
                                  </div>
                                </div>
                                <div class="space-y-1">
                                  <p class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                    {t("projectDetail.gitBehind") as string}
                                  </p>
                                  <div class="flex items-center gap-1.5">
                                    <span class="iconify mdi--arrow-down size-3.5 text-blue-500" />
                                    <span class="font-mono text-sm font-bold tabular-nums">
                                      {s().behind}
                                    </span>
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
                                          <span class="font-mono text-xs font-bold tabular-nums">
                                            {tag()}
                                          </span>
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
                                    variant={
                                      s().ahead > 0 ? "default" : "secondary"
                                    }
                                    disabled={
                                      m().isPushing() || m().isPulling()
                                    }
                                    onClick={() => m().pushMutate()}
                                  >
                                    <Show
                                      when={m().isPushing()}
                                      fallback={
                                        <span class="iconify mdi--upload size-3.5" />
                                      }
                                    >
                                      <span class="iconify mdi--loading animate-spin size-3.5" />
                                    </Show>
                                    {t("projectDetail.gitPush") as string}
                                  </Button>
                                  <Button
                                    size="sm"
                                    class="h-8 flex-1 gap-1.5 text-xs font-bold"
                                    variant={
                                      s().behind > 0 ? "default" : "secondary"
                                    }
                                    disabled={
                                      m().isPulling() || m().isPushing()
                                    }
                                    onClick={() => m().pullMutate()}
                                  >
                                    <Show
                                      when={m().isPulling()}
                                      fallback={
                                        <span class="iconify mdi--download size-3.5" />
                                      }
                                    >
                                      <span class="iconify mdi--loading animate-spin size-3.5" />
                                    </Show>
                                    {t("projectDetail.gitPull") as string}
                                  </Button>
                                </div>
                                <div class="border-t border-border/40 pt-2">
                                  <Button
                                    size="sm"
                                    class="h-8 w-full gap-1.5 text-xs font-bold"
                                    variant="outline"
                                    disabled={m().isTagging()}
                                    onClick={() => setTagDialogOpen(true)}
                                  >
                                    <Show
                                      when={m().isTagging()}
                                      fallback={
                                        <span class="iconify mdi--tag-plus size-3.5" />
                                      }
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
                    <Show
                      when={
                        m().gitStatusQ.data == null && !m().gitStatusQ.isPending
                      }
                    >
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
                          <Show
                            when={m().isIniting()}
                            fallback={<span class="iconify mdi--git size-4" />}
                          >
                            <span class="iconify mdi--loading animate-spin size-4" />
                          </Show>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("projectDetail.gitInit") as string}
                        </TooltipContent>
                      </Tooltip>
                    </Show>
                    <Tooltip openDelay={400}>
                      <TooltipTrigger
                        as={Button}
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
                        onClick={() =>
                          void m().onOpenProjectInFileManager(p().path)
                        }
                      >
                        <span class="iconify mdi--folder-open size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("projectDetail.openInSystemExplorer") as string}
                      </TooltipContent>
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
                      <TooltipContent>
                        {t("projectDetail.moveProject") as string}
                      </TooltipContent>
                    </Tooltip>
                    <Show when={m().gitStatusQ.data}>
                      <Tooltip openDelay={400}>
                        <TooltipTrigger
                          as={Button}
                          type="button"
                          variant="ghost"
                          size="icon"
                          class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground"
                          onClick={async () => {
                            setCleanDialogOpen(true);
                            setCleanPreview(null);
                            setCleanSelected(new Set());
                            setCleanResetTracked(false);
                            try {
                              const result = await m().cleanPreview();
                              setCleanPreview(result);
                              setCleanSelected(new Set(result.entries.map((e) => e.path)));
                            } catch {
                              /* onError in mutation handles toast */
                            }
                          }}
                        >
                          <span class="iconify mdi--broom size-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("projectDetail.cleanProject") as string}
                        </TooltipContent>
                      </Tooltip>
                    </Show>
                    <Tooltip openDelay={400}>
                      <TooltipTrigger
                        as={Button}
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        <span class="iconify mdi--trash-can-outline size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("projectDetail.deleteProject") as string}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Mobile View: Dropdown Chevron */}
                  <div class="flex items-stretch sm:hidden">
                    <DropdownMenu gutter={0}>
                      <DropdownMenuTrigger
                        as={Button}
                        variant="ghost"
                        size="icon"
                        class="h-full w-10 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0"
                      >
                        <span class="iconify mdi--chevron-down size-5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent class="w-56">
                        <Show when={m().gitStatusQ.data}>
                          {(s) => (
                            <div>
                              <div class="mb-1 flex items-center justify-between border-b border-border/40 bg-muted/30 px-2 py-1.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <span class="iconify mdi--git size-4 text-primary/80" />
                                  <span class="max-w-[100px] truncate font-mono text-[10px] font-bold">
                                    {s().branch}
                                  </span>
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0">
                                  <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums">
                                    <span class="iconify mdi--arrow-up size-3 text-green-500" />
                                    {s().ahead}
                                  </span>
                                  <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums">
                                    <span class="iconify mdi--arrow-down size-3 text-blue-500" />
                                    {s().behind}
                                  </span>
                                </div>
                              </div>
                              <Show when={s().hasUpstream}>
                                <DropdownMenuItem
                                  disabled={m().isPushing() || m().isPulling()}
                                  onClick={() => m().pushMutate()}
                                >
                                  <Show
                                    when={m().isPushing()}
                                    fallback={
                                      <span class="iconify mdi--upload size-4" />
                                    }
                                  >
                                    <span class="iconify mdi--loading animate-spin size-4" />
                                  </Show>
                                  <span>
                                    {
                                      t(
                                        "projectDetail.gitPushTooltip",
                                      ) as string
                                    }
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={m().isPulling() || m().isPushing()}
                                  onClick={() => m().pullMutate()}
                                >
                                  <Show
                                    when={m().isPulling()}
                                    fallback={
                                      <span class="iconify mdi--download size-4" />
                                    }
                                  >
                                    <span class="iconify mdi--loading animate-spin size-4" />
                                  </Show>
                                  <span>
                                    {
                                      t(
                                        "projectDetail.gitPullTooltip",
                                      ) as string
                                    }
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={m().isTagging()}
                                  onClick={() => setTagDialogOpen(true)}
                                >
                                  <Show
                                    when={m().isTagging()}
                                    fallback={
                                      <span class="iconify mdi--tag-plus size-4" />
                                    }
                                  >
                                    <span class="iconify mdi--loading animate-spin size-4" />
                                  </Show>
                                  <span>
                                    {t("projectDetail.gitPushTag") as string}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </Show>
                            </div>
                          )}
                        </Show>
                        <Show
                          when={
                            m().gitStatusQ.data == null &&
                            !m().gitStatusQ.isPending
                          }
                        >
                          <DropdownMenuItem
                            disabled={m().isIniting()}
                            onClick={() => m().initMutate()}
                          >
                            <Show
                              when={m().isIniting()}
                              fallback={
                                <span class="iconify mdi--git size-4" />
                              }
                            >
                              <span class="iconify mdi--loading animate-spin size-4" />
                            </Show>
                            <span>{t("projectDetail.gitInit") as string}</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </Show>
                        <DropdownMenuItem
                          onClick={() =>
                            m().favMutate({
                              id: p().id,
                              favorite: !p().favorite,
                            })
                          }
                        >
                          <span
                            class={cn(
                              "iconify size-4",
                              p().favorite
                                ? "mdi--star text-yellow-500"
                                : "mdi--star-outline",
                            )}
                          />
                          <span>
                            {p().favorite
                              ? (t("projectDetail.gitUnstar") as string)
                              : (t("projectDetail.gitStar") as string)}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            void m().onOpenProjectInFileManager(p().path)
                          }
                        >
                          <span class="iconify mdi--folder-open size-4" />
                          <span>
                            {t("projectDetail.openInSystemExplorer") as string}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            m().setMoveTargetLocationId(null);
                            m().setMoveOpen(true);
                          }}
                        >
                          <span class="iconify mdi--file-move size-4" />
                          <span>
                            {t("projectDetail.moveProject") as string}
                          </span>
                        </DropdownMenuItem>
                        <Show when={m().gitStatusQ.data}>
                          <DropdownMenuItem
                            onClick={async () => {
                              setCleanDialogOpen(true);
                              setCleanPreview(null);
                              setCleanSelected(new Set());
                              setCleanResetTracked(false);
                              try {
                                const result = await m().cleanPreview();
                                setCleanPreview(result);
                                setCleanSelected(new Set(result.entries.map((e) => e.path)));
                              } catch {
                                /* onError in mutation handles toast */
                              }
                            }}
                          >
                            <span class="iconify mdi--broom size-4" />
                            <span>
                              {t("projectDetail.cleanProject") as string}
                            </span>
                          </DropdownMenuItem>
                        </Show>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          class="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => setDeleteConfirmOpen(true)}
                        >
                          <span class="iconify mdi--trash-can-outline size-4" />
                          <span>
                            {t("projectDetail.deleteProject") as string}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Portal>
            </div>
          );
        }}
      </Show>

      <LanguageBar projectId={m().props.projectId} />

      <Dialog
        open={tagDialogOpen()}
        onOpenChange={(open) => {
          setTagDialogOpen(open);
          setTagError(null);
          if (!open) {
            setTagStep("bump");
            setDiscoveredFiles(null);
            setSelectedVersionFiles(new Set<string>());
          }
        }}
      >
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <Show
              when={tagStep() !== "bump"}
              fallback={
                <div>
                  <DialogTitle>
                    {t("projectDetail.gitPushTagTitle") as string}
                  </DialogTitle>
                  <DialogDescription>
                    {t("projectDetail.gitPushTagDescription") as string}
                  </DialogDescription>
                </div>
              }
            >
              <DialogTitle>
                {t("projectDetail.gitBumpTitle") as string}
              </DialogTitle>
              <DialogDescription>
                {discoveredFiles()
                  ? (t("projectDetail.gitBumpDescription", {
                      current: discoveredFiles()!.currentVersion,
                      new: discoveredFiles()!.newVersion,
                    }) as string)
                  : ""}
              </DialogDescription>
            </Show>
          </DialogHeader>

          <Show when={tagStep() === "bump"}>
            <Show when={tagError()}>
              <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {tagError()}
              </div>
            </Show>
            <div class="grid grid-cols-4 gap-3 py-2">
              <Button
                variant="outline"
                class="flex flex-col gap-1 h-auto py-3"
                disabled={m().isDiscoveringFiles()}
                onClick={async () => {
                  setSelectedBump("patch");
                  setTagError(null);
                  try {
                    const result = await m().discoverVersionFiles("patch");
                    setDiscoveredFiles(result);
                    setSelectedVersionFiles(
                      new Set<string>(result.files.map((f) => f.path)),
                    );
                    setTagStep("files");
                  } catch (e: any) {
                    setTagError(e?.message || String(e));
                  }
                }}
              >
                <Show
                  when={m().isDiscoveringFiles() && selectedBump() === "patch"}
                  fallback={
                    <div class="flex flex-col gap-1">
                      <span class="text-lg font-bold">patch</span>
                      <span class="text-[10px] text-muted-foreground">
                        <Show
                          when={m().previewVersionsQ.data}
                          fallback={<span>x.x.1 → x.x.2</span>}
                        >
                          {(v) => (
                            <span>
                              {v().currentVersion} → {v().patchVersion}
                            </span>
                          )}
                        </Show>
                      </span>
                    </div>
                  }
                >
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
              <Button
                variant="outline"
                class="flex flex-col gap-1 h-auto py-3"
                disabled={m().isDiscoveringFiles()}
                onClick={async () => {
                  setSelectedBump("minor");
                  setTagError(null);
                  try {
                    const result = await m().discoverVersionFiles("minor");
                    setDiscoveredFiles(result);
                    setSelectedVersionFiles(
                      new Set<string>(result.files.map((f) => f.path)),
                    );
                    setTagStep("files");
                  } catch (e: any) {
                    setTagError(e?.message || String(e));
                  }
                }}
              >
                <Show
                  when={m().isDiscoveringFiles() && selectedBump() === "minor"}
                  fallback={
                    <div class="flex flex-col gap-1">
                      <span class="text-lg font-bold">minor</span>
                      <span class="text-[10px] text-muted-foreground">
                        <Show
                          when={m().previewVersionsQ.data}
                          fallback={<span>x.1.x → x.2.0</span>}
                        >
                          {(v) => (
                            <span>
                              {v().currentVersion} → {v().minorVersion}
                            </span>
                          )}
                        </Show>
                      </span>
                    </div>
                  }
                >
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
              <Button
                variant="outline"
                class="flex flex-col gap-1 h-auto py-3"
                disabled={m().isDiscoveringFiles()}
                onClick={async () => {
                  setSelectedBump("major");
                  setTagError(null);
                  try {
                    const result = await m().discoverVersionFiles("major");
                    setDiscoveredFiles(result);
                    setSelectedVersionFiles(
                      new Set<string>(result.files.map((f) => f.path)),
                    );
                    setTagStep("files");
                  } catch (e: any) {
                    setTagError(e?.message || String(e));
                  }
                }}
              >
                <Show
                  when={m().isDiscoveringFiles() && selectedBump() === "major"}
                  fallback={
                    <div class="flex flex-col gap-1">
                      <span class="text-lg font-bold">major</span>
                      <span class="text-[10px] text-muted-foreground">
                        <Show
                          when={m().previewVersionsQ.data}
                          fallback={<span>1.x.x → 2.0.0</span>}
                        >
                          {(v) => (
                            <span>
                              {v().currentVersion} → {v().majorVersion}
                            </span>
                          )}
                        </Show>
                      </span>
                    </div>
                  }
                >
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
              <Button
                variant="outline"
                class="flex flex-col gap-1 h-auto py-3"
                disabled={m().isDiscoveringFiles()}
                onClick={async () => {
                  setSelectedBump("beta");
                  setTagError(null);
                  try {
                    const result = await m().discoverVersionFiles("beta");
                    setDiscoveredFiles(result);
                    setSelectedVersionFiles(
                      new Set<string>(result.files.map((f) => f.path)),
                    );
                    setTagStep("files");
                  } catch (e: any) {
                    setTagError(e?.message || String(e));
                  }
                }}
              >
                <Show
                  when={m().isDiscoveringFiles() && selectedBump() === "beta"}
                  fallback={
                    <div class="flex flex-col gap-1">
                      <span class="text-lg font-bold">beta</span>
                      <span class="text-[10px] text-muted-foreground">
                        <Show
                          when={m().previewVersionsQ.data}
                          fallback={<span>x.x.x → x.x.x-beta.0</span>}
                        >
                          {(v) => (
                            <span>
                              {v().currentVersion} → {v().betaVersion}
                            </span>
                          )}
                        </Show>
                      </span>
                    </div>
                  }
                >
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagDialogOpen(false)}>
                {t("common.cancel") as string}
              </Button>
            </DialogFooter>
          </Show>

          <Show when={tagStep() === "files" && discoveredFiles()}>
            {(data) => (
              <div class="space-y-3">
                <Show
                  when={data().files.length > 0}
                  fallback={
                    <div class="text-center py-4 space-y-3">
                      <p class="text-sm text-muted-foreground">
                        {t("projectDetail.gitBumpNoFiles") as string}
                      </p>
                      <div class="flex justify-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={m().isBumpingVersion()}
                          onClick={() => setTagStep("bump")}
                        >
                          <span class="iconify mdi--arrow-left size-3.5" />
                          {t("common.back") as string}
                        </Button>
                        <Button
                          size="sm"
                          disabled={m().isBumpingVersion()}
                          onClick={() => {
                            m().tagAndPushMutate(selectedBump());
                            setTagDialogOpen(false);
                          }}
                        >
                          <Show
                            when={m().isBumpingVersion()}
                            fallback={
                              <span class="iconify mdi--tag-plus size-3.5" />
                            }
                          >
                            <span class="iconify mdi--loading animate-spin size-3.5" />
                          </Show>
                          {t("projectDetail.gitPushTagOnly") as string}
                        </Button>
                      </div>
                    </div>
                  }
                >
                  <div class="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                    <For each={data().files}>
                      {(file) => (
                        <div class="flex items-start gap-2">
                          <Checkbox
                            id={`version-file-${file.path}`}
                            checked={selectedVersionFiles().has(file.path)}
                            onChange={(checked) => {
                              setSelectedVersionFiles((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(file.path);
                                else next.delete(file.path);
                                return next;
                              });
                            }}
                          />
                          <div class="flex-1 min-w-0">
                            <label
                              for={`version-file-${file.path}`}
                              class="text-xs font-mono font-medium cursor-pointer"
                            >
                              {file.path}
                            </label>
                            <p class="text-[10px] text-muted-foreground font-mono truncate">
                              {file.preview}
                            </p>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      disabled={m().isBumpingVersion()}
                      onClick={() => setTagStep("bump")}
                    >
                      <span class="iconify mdi--arrow-left size-3.5" />
                      {t("common.back") as string}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setTagDialogOpen(false)}
                      disabled={m().isBumpingVersion()}
                    >
                      {t("common.cancel") as string}
                    </Button>
                    <Button
                      disabled={
                        m().isBumpingVersion() ||
                        selectedVersionFiles().size === 0
                      }
                      onClick={() => {
                        m().bumpVersionAndTag({
                          bump: selectedBump(),
                          files: Array.from(selectedVersionFiles()),
                        });
                        setTagDialogOpen(false);
                      }}
                    >
                      <Show
                        when={m().isBumpingVersion()}
                        fallback={
                          <span class="iconify mdi--tag-plus size-3.5" />
                        }
                      >
                        <span class="iconify mdi--loading animate-spin size-3.5" />
                      </Show>
                      {t("projectDetail.gitBumpCommitTagPush") as string}
                    </Button>
                  </DialogFooter>
                </Show>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cleanDialogOpen()}
        onOpenChange={(v) => {
          setCleanDialogOpen(v);
          if (!v) {
            setCleanPreview(null);
            setCleanSelected(new Set());
            setCleanResetTracked(false);
          }
        }}
      >
        <AlertDialogContent class="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projectDetail.cleanProjectTitle") as string}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectDetail.cleanProjectDescription") as string}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div class="max-h-60 overflow-y-auto rounded-md border border-border/40 bg-muted/20">
            <Show
              when={cleanPreview()}
              fallback={
                <div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <span class="iconify mdi--loading animate-spin size-4" />
                  {t("projectDetail.cleanLoading") as string}
                </div>
              }
            >
              {(preview) => (
                <Show
                  when={preview().entries.length > 0}
                  fallback={
                    <div class="py-8 text-center text-sm text-muted-foreground">
                      {t("projectDetail.cleanNoFiles") as string}
                    </div>
                  }
                >
                  <For each={preview().entries}>
                    {(entry) => {
                      const isChild = preview().entries.some(
                        (e) =>
                          e.isDir &&
                          !cleanSelected().has(e.path) &&
                          entry.path !== e.path &&
                          entry.path.startsWith(e.path + "/"),
                      );
                      return (
                        <div
                          class={cn(
                            "flex items-center justify-between gap-2 border-b border-border/20 px-3 py-1.5 last:border-b-0",
                            isChild && "opacity-40",
                          )}
                        >
                          <div class="flex min-w-0 items-center gap-2">
                            <Checkbox
                              checked={cleanSelected().has(entry.path)}
                              disabled={isChild}
                              onChange={(checked) => {
                                setCleanSelected((prev) => {
                                  const next = new Set(prev);
                                  checked
                                    ? next.add(entry.path)
                                    : next.delete(entry.path);
                                  return next;
                                });
                              }}
                            />
                            <span
                              class={cn(
                                "iconify size-3.5 shrink-0",
                                entry.isDir
                                  ? "mdi--folder text-yellow-500"
                                  : "mdi--file text-muted-foreground",
                              )}
                            />
                            <span class="truncate font-mono text-xs">
                              {entry.path}
                            </span>
                          </div>
                          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {formatBytes(entry.sizeBytes)}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              )}
            </Show>
          </div>
          <Show when={cleanPreview()?.entries && cleanPreview()!.entries.length > 0}>
            <div class="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm font-medium">
              <span>
                {(() => {
                  const selectedCount = cleanSelected().size;
                  const totalBytes = cleanPreview()!.entries
                    .filter((e) => cleanSelected().has(e.path))
                    .reduce((sum, e) => sum + e.sizeBytes, 0);
                  return t("projectDetail.cleanTotal", { count: selectedCount }) as string;
                })()}
              </span>
              <span class="font-mono">
                {formatBytes(
                  cleanPreview()!.entries
                    .filter((e) => cleanSelected().has(e.path))
                    .reduce((sum, e) => sum + e.sizeBytes, 0),
                )}
              </span>
            </div>
          </Show>
          <Show when={cleanPreview()?.hasTrackedChanges}>
            <div class="flex items-center gap-2 pt-1">
              <Checkbox
                id="clean-reset-tracked"
                checked={cleanResetTracked()}
                onChange={setCleanResetTracked}
              />
              <label
                for="clean-reset-tracked"
                class="cursor-pointer text-xs text-muted-foreground"
              >
                {t("projectDetail.cleanResetTracked") as string}
              </label>
            </div>
          </Show>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setCleanDialogOpen(false)}>
              {t("wizard.cancel") as string}
            </Button>
            <Button
              variant="destructive"
              disabled={cleanSelected().size === 0 || m().isCleaning()}
              onClick={() => {
                setCleanDialogOpen(false);
                m().cleanExecute({
                  resetTracked: cleanResetTracked(),
                  selectedPaths: Array.from(cleanSelected()),
                });
              }}
            >
              <Show
                when={m().isCleaning()}
                fallback={<span class="iconify mdi--broom size-3.5" />}
              >
                <span class="iconify mdi--loading animate-spin size-3.5" />
              </Show>
              {t("projectDetail.cleanConfirm") as string}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeleteProjectDialog
        model={m()}
        open={deleteConfirmOpen()}
        onOpenChange={setDeleteConfirmOpen}
      />
    </div>
  );
};
