import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import { pluginHeaderWidgets } from "~/lib/plugin-header-widgets";
import { invoke } from "@tauri-apps/api/core";

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
import { CleanProjectDialog } from "./CleanProjectDialog";
import { TagVersionDialog } from "./TagVersionDialog";
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
  const p = () => m().projectQ.data!;
  const livePlaytimeMs = createMemo(() => {
    const proj = m().projectQ.data;
    return proj ? getLivePlaytimeMs(proj.id, proj.totalPlaytimeMs)() : 0;
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
  const [tagDialogOpen, setTagDialogOpen] = createSignal(false);
  const [cleanDialogOpen, setCleanDialogOpen] = createSignal(false);
  const [incomingOpen, setIncomingOpen] = createSignal(false);
  const [copiedPath, setCopiedPath] = createSignal(false);
  const [copiedRemote, setCopiedRemote] = createSignal(false);

  const openExternal = (href: string) =>
    isTauri()
      ? void openUrl(href)
      : window.open(href, "_blank", "noopener,noreferrer");

  return (
    <div class="shrink-0 border-b border-border/40 bg-background/50">
      <Show when={m().projectQ.data}>
            <div class="flex items-start justify-between gap-6 px-4 py-3">
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

                        <Show when={m().gitRemoteQ.data}>
                          {(remoteUrl) => (
                            <Tooltip>
                              <TooltipTrigger
                                as="button"
                                type="button"
                                class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(remoteUrl());
                                  setCopiedRemote(true);
                                  setTimeout(() => setCopiedRemote(false), 2000);
                                }}
                              >
                                <Show when={copiedRemote()} fallback={<span class="iconify mdi--content-copy size-3.5" />}>
                                  <span class="iconify mdi--check size-3.5 text-green-500" />
                                </Show>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("projectDetail.copyGitRemote") as string}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </Show>
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
                <div class="ml-1 flex min-w-0 items-center gap-2">
                  <div class="flex min-w-0 items-center gap-1.5">
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
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("library.openInFileManager") as string}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger
                        as="button"
                        type="button"
                        class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigator.clipboard.writeText(p().path);
                          setCopiedPath(true);
                          setTimeout(() => setCopiedPath(false), 2000);
                        }}
                      >
                        <Show when={copiedPath()} fallback={<span class="iconify mdi--content-copy size-3" />}>
                          <span class="iconify mdi--check size-3 text-green-500" />
                        </Show>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("projectDetail.copyPath") as string}
                      </TooltipContent>
                    </Tooltip>

                    <Show when={p().sizeBytes > 0}>
                      <span class="shrink-0 text-[10px] text-muted-foreground/40">
                        · {formatBytes(p().sizeBytes)}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 flex-col items-end gap-1 self-start">
                <div class="flex items-center gap-2">
                <Show when={pluginHeaderWidgets().length > 0}>
                  <div class="flex items-center gap-1.5">
                    <For each={pluginHeaderWidgets()}>
                      {(w) => {
                        const executeWidget = async () => {
                          if (w.command) {
                            await invoke("execute_plugin_command", {
                              pluginId: w.pluginId,
                              commandId: w.command,
                              context: { projectId: p().id },
                            });
                          }
                        };

                        const colorClass = () => {
                          switch (w.color) {
                            case "success": return "bg-green-500/10 text-green-500 border-green-500/30 hover:bg-green-500/20";
                            case "warning": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/20";
                            case "error": return "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20";
                            case "primary": return "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20";
                            case "muted": return "bg-muted/10 text-muted-foreground border-border/40 hover:bg-muted/20";
                            default: return "bg-background text-foreground border-border/60 hover:bg-muted/10";
                          }
                        };

                        return (
                          <Tooltip>
                            <TooltipTrigger>
                              <Show
                                when={w.type === "button"}
                                fallback={
                                  <span class={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold cursor-default", colorClass())}>
                                    <Show when={w.icon}>
                                      <span class={cn("iconify size-3.5", w.icon)} />
                                    </Show>
                                    {w.text}
                                  </span>
                                }
                              >
                                <button
                                  type="button"
                                  onClick={executeWidget}
                                  class={cn("flex h-7 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold transition-all active:scale-95", colorClass())}
                                >
                                  <Show when={w.icon}>
                                    <span class={cn("iconify size-3.5", w.icon)} />
                                  </Show>
                                  {w.text}
                                </button>
                              </Show>
                            </TooltipTrigger>
                            <Show when={w.tooltip}>
                              <TooltipContent>{w.tooltip}</TooltipContent>
                            </Show>
                          </Tooltip>
                        );
                      }}
                    </For>
                  </div>
                </Show>

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
                </div>
                <div class="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-muted-foreground/70">
                  <Tooltip>
                    <TooltipTrigger
                      as="div"
                      class="flex items-center gap-1 tabular-nums"
                    >
                      <span class="iconify mdi--clock-outline size-3 shrink-0" />
                      {formatWorktime(livePlaytimeMs())}
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("projectDetail.totalWorktime") as string}
                    </TooltipContent>
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
                        <Popover gutter={8} onOpenChange={(open) => { if (open) m().fetchAndRefresh(); }}>
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
                                <Show when={s().behind > 0}>
                                  <div class="border-t border-border/40 pt-2">
                                    <button
                                      type="button"
                                      class="flex w-full items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                                      onClick={() => setIncomingOpen(!incomingOpen())}
                                    >
                                      <span>
                                        {t("projectDetail.gitIncomingTitle", { count: s().behind }) as string}
                                      </span>
                                      <span class={`iconify mdi--chevron-down size-3.5 transition-transform ${incomingOpen() ? "rotate-180" : ""}`} />
                                    </button>
                                    <Show when={incomingOpen()}>
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
                                                  <span class="truncate text-xs font-medium" title={commit.message}>
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
                          onClick={() => setCleanDialogOpen(true)}
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
                    <DropdownMenu gutter={0} onOpenChange={(open) => { if (open) m().fetchAndRefresh(); }}>
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
                                <Show when={s().behind > 0}>
                                  <DropdownMenuItem
                                    class="flex items-center justify-between"
                                    onClick={() => setIncomingOpen(!incomingOpen())}
                                  >
                                    <span class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                      {t("projectDetail.gitIncomingTitle", { count: s().behind }) as string}
                                    </span>
                                    <span class={`iconify mdi--chevron-down size-3 transition-transform ${incomingOpen() ? "rotate-180" : ""}`} />
                                  </DropdownMenuItem>
                                  <Show when={incomingOpen()}>
                                    <div class="max-h-32 space-y-1 overflow-y-auto px-2 py-1">
                                      <Show
                                        when={!m().gitIncomingQ.isFetching}
                                        fallback={
                                          <div class="flex items-center gap-2 py-1 text-[10px] text-muted-foreground">
                                            <span class="iconify mdi--loading animate-spin size-3" />
                                            {t("projectDetail.gitFetching") as string}
                                          </div>
                                        }
                                      >
                                        <For each={m().gitIncomingQ.data?.commits}>
                                          {(commit) => (
                                            <div class="flex flex-col gap-0.5 py-0.5">
                                              <span class="truncate text-[10px] font-medium">{commit.message}</span>
                                              <span class="text-[9px] text-muted-foreground">{commit.author} · {commit.relativeTime}</span>
                                            </div>
                                          )}
                                        </For>
                                      </Show>
                                    </div>
                                  </Show>
                                </Show>
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
                            onClick={() => setCleanDialogOpen(true)}
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
      </Show>

      <LanguageBar projectId={m().props.projectId} />

      <TagVersionDialog
        model={m()}
        open={tagDialogOpen()}
        onOpenChange={setTagDialogOpen}
      />

      <CleanProjectDialog
        model={m()}
        open={cleanDialogOpen()}
        onOpenChange={setCleanDialogOpen}
      />

      <DeleteProjectDialog
        model={m()}
        open={deleteConfirmOpen()}
        onOpenChange={setDeleteConfirmOpen}
      />
    </div>
  );
};
