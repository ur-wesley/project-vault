import { createQuery } from "@tanstack/solid-query";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import type { DiscoverVersionFilesResultDto } from "~/types/dto";
import { Portal } from "solid-js/web";

import { StackIcon } from "~/components/StackIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import { Separator } from "~/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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
import { queryKeys } from "~/services/query-keys";
import { getProjectLanguages } from "~/services/tauri";
import { formatWorktime } from "../lib/format";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";

type ProjectDetailHeaderProps = Readonly<{
  model: ProjectDetailModel;
}>;

// GitHub-like language colors
const LANGUAGE_COLORS: Record<string, string> = {
  js: "#f1e05a", jsx: "#f1e05a", ts: "#3178c6", tsx: "#3178c6", rs: "#dea584",
  rust: "#dea584", go: "#00ADD8", py: "#3572A5", python: "#3572A5", cs: "#178600",
  csharp: "#178600", cpp: "#f34b7d", c: "#555555", java: "#b07219", php: "#4F5D95",
  rb: "#701516", ruby: "#701516", ex: "#6e4a7e", elixir: "#6e4a7e", swift: "#F05138",
  kt: "#A97BFF", kotlin: "#A97BFF", sql: "#e38c00", toml: "#9c4221", yaml: "#cb171e",
  yml: "#cb171e", json: "#29b544", html: "#e34c26", css: "#563d7c", md: "#083fa1",
  sh: "#89e051", bash: "#89e051", docker: "#384d54", dockerfile: "#384d54", plaintext: "#cccccc",
};

const LANG_NAME_MAP: Record<string, string> = {
  js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
  rs: "Rust", py: "Python", cs: "C#", cpp: "C++", c: "C", rb: "Ruby",
  ex: "Elixir", kt: "Kotlin", yml: "YAML", md: "Markdown",
};

function LanguageBar(props: { projectId: string }) {
  const { t } = useI18n();
  const q = createQuery(() => ({
    queryKey: queryKeys.projectLanguages(props.projectId),
    queryFn: async () => {
      const r = await getProjectLanguages(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const segments = createMemo(() => {
    const data = q.data;
    if (!data || Object.keys(data).length === 0) return [];

    const total = Object.values(data).reduce((a, b) => a + b, 0);
    const grouped = new Map<string, { count: number; color: string; ext: string }>();
    for (const [ext, count] of Object.entries(data)) {
        const name = LANG_NAME_MAP[ext] || ext.toUpperCase();
        const color = LANGUAGE_COLORS[ext] || "#888888";
        const existing = grouped.get(name);
        if (existing) existing.count += count; else grouped.set(name, { count, color, ext });
    }
    const list = Array.from(grouped.entries()).map(([name, info]) => ({
      ext: info.ext, name, percent: (info.count / total) * 100, color: info.color,
    })).sort((a, b) => b.percent - a.percent);
    const threshold = 1.5;
    const major = list.filter((s) => s.percent >= threshold);
    const minor = list.filter((s) => s.percent < threshold);
    if (minor.length > 0) {
      major.push({ ext: "other", name: t('projectDetail.languageOther') as string, percent: minor.reduce((sum, s) => sum + s.percent, 0), color: "#666666" });
    }
    return major;
  });

  return (
    <div class="flex h-1.5 w-full overflow-hidden bg-muted/20">
      <For each={segments()}>
        {(s) => (
          <Tooltip openDelay={100}>
            <TooltipTrigger as="div" class="h-full transition-all hover:scale-y-125 cursor-help"
              style={{ width: `${s.percent}%`, "background-color": s.color }} />
            <TooltipContent>
              <div class="flex items-center gap-2 font-mono text-[10px]">
                <div class="size-2 rounded-full" style={{ "background-color": s.color }} />
                <span class="font-bold text-foreground">{s.name}</span>
                <span class="text-muted-foreground">{s.percent.toFixed(1)}%</span>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}

export const ProjectDetailHeader: Component<ProjectDetailHeaderProps> = (props) => {
  const { t } = useI18n();
  const m = () => props.model;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
  const [deleteFromDisk, setDeleteFromDisk] = createSignal(false);
  const [tagDialogOpen, setTagDialogOpen] = createSignal(false);
  const [tagStep, setTagStep] = createSignal<"bump" | "files">("bump");
  const [selectedBump, setSelectedBump] = createSignal<"patch" | "minor" | "major">("patch");
  const [discoveredFiles, setDiscoveredFiles] = createSignal<DiscoverVersionFilesResultDto | null>(null);
  const [selectedVersionFiles, setSelectedVersionFiles] = createSignal<Set<string>>(new Set<string>());
  const [tagError, setTagError] = createSignal<string | null>(null);

  const openExternal = (href: string) => isTauri() ? void openUrl(href) : window.open(href, "_blank", "noopener,noreferrer");

  return (
    <div class="shrink-0 border-b border-border/40 bg-background/50">
      <Show when={m().projectQ.data}>
        {(p) => (
          <div class="flex items-center justify-between gap-6 px-4 py-3">
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <div class="flex items-center gap-3 min-w-0">
                <div class="flex items-center gap-2 shrink-0">
                  <Button type="button" variant="ghost" size="sm" class="h-7 px-1.5" onClick={() => m().props.onBack()} title={t('projectDetail.backToLibrary') as string}>
                    <span class="iconify mdi--arrow-left size-4" />
                  </Button>
                  <Separator orientation="vertical" class="h-4" />
                </div>
                <div class="flex min-w-0 items-center gap-3">
                  <Badge variant="secondary" class="inline-flex size-6 shrink-0 items-center justify-center p-0.5" title={p().stack}>
                    <StackIcon stack={p().stack} class="size-4" />
                  </Badge>
                  <div class="flex min-w-0 flex-col">
                    <div class="flex items-center gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <Show when={m().ghQ.data} fallback={<h1 class="truncate text-sm font-bold tracking-tight text-foreground">{p().name}</h1>}>
                          {(g) => {
                            const u = createMemo(() => g().owner && g().repo ? `https://github.com/${g().owner}/${g().repo}` : null);
                            return (
                              <Show when={u()} fallback={<h1 class="truncate text-sm font-bold tracking-tight text-foreground">{p().name}</h1>}>
                                {(href) => (
                                  <button type="button" class="group/gh flex min-w-0 items-center gap-1.5 text-sm font-bold tracking-tight hover:text-primary transition-colors" onClick={() => openExternal(href())} title={t('projectDetail.openOnGithub', { owner: g().owner, repo: g().repo }) as string}>
                                    <span class="iconify mdi--github size-4 shrink-0 text-muted-foreground group-hover/gh:text-primary" />
                                    <h1 class="truncate">{p().name}</h1>
                                  </button>
                                )}
                              </Show>
                            );
                          }}
                        </Show>
                      </div>
                    </div>
                    <Show when={m().ghQ.data?.owner && m().ghQ.data?.repo && (m().ghQ.data?.repo.toLowerCase() !== p().name.toLowerCase() || m().ghQ.data?.owner)}>
                       <p class="mt-0.5 truncate text-[10px] font-medium leading-tight text-muted-foreground/70">
                         {m().ghQ.data?.owner}/{m().ghQ.data?.repo}
                       </p>
                    </Show>
                  </div>
                </div>
              </div>
              <div class="ml-1 flex min-w-0 items-center gap-4">
                <div class="flex min-w-0">
                  <div class="group/path flex min-w-0 cursor-pointer items-center gap-2" onClick={() => void m().onOpenProjectInFileManager(p().path)} title={t("library.openInFileManager") as string}>
                    <span class="iconify mdi--folder size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/path:text-primary" />
                    <p class="truncate font-mono text-[10px] text-muted-foreground/80 transition-colors group-hover/path:text-foreground" title={p().path}>{p().path}</p>
                    <Show when={p().sizeBytes > 0}>
                      <span class="shrink-0 text-[10px] text-muted-foreground/40 transition-colors group-hover/path:text-muted-foreground/60">
                        · {formatBytes(p().sizeBytes)}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col items-center gap-1 shrink-0 self-center">
              <Show when={(m().idesQ.data?.length ?? 0) > 0}>
                <div class="flex items-center rounded-full bg-primary/10 p-0.5 shadow-sm ring-1 ring-primary/20 transition-all hover:ring-primary/40">
                  <Show when={m().ideRunningQ.data === true} fallback={
                    <button type="button" class={cn("flex h-8 items-center gap-2 rounded-l-full pl-5 pr-4 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 active:scale-95", m().selectedIdeExecutable() == null && "pointer-events-none opacity-30 grayscale")} onClick={() => { const ex = m().selectedIdeExecutable(); if (ex) void m().onOpenIde(p().id, ex); }}>
                      <Show when={m().selectedIdeOption()?.icon}><span class={cn("iconify size-4.5", m().selectedIdeOption()?.icon)} /></Show>
                      <span class="max-w-[120px] truncate">{m().selectedIdeOption()?.label ?? (t("library.openInIde") as string)}</span>
                      <span class="iconify mdi--play ml-0.5 size-5" />
                    </button>
                  }>
                    <button type="button" class="flex h-8 animate-in fade-in slide-in-from-right-0.5 items-center gap-2 rounded-l-full pl-5 pr-4 text-[11px] font-black uppercase tracking-widest text-destructive transition-colors duration-300 hover:bg-destructive/10 active:scale-95" onClick={() => void m().onStopIde(p().id)}>
                      <span class="iconify mdi--stop size-4.5" />
                      <span>{t('library.stopIde') as string}</span>
                    </button>
                  </Show>
                  <div class="mx-0.5 h-5 w-px bg-primary/20" />
                  <DropdownMenu gutter={8}>
                    <DropdownMenuTrigger as={Button} variant="ghost" size="icon" class="size-8 rounded-r-full text-primary transition-colors hover:bg-primary/10 focus:ring-0">
                      <span class="iconify mdi--chevron-down size-4.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent class="w-56 p-1.5 shadow-xl border-border/40">
                      <For each={m().ideSelectOptions()}>
                        {(opt) => (
                          <DropdownMenuItem class="flex cursor-pointer items-center gap-2 px-2.5 py-2" onClick={() => m().onIdeSelected(p().id, opt.executable)}>
                            <Show when={opt.icon}><span class={cn("iconify size-4 shrink-0 text-muted-foreground", opt.icon)} /></Show>
                            <span class="flex-1 text-xs font-bold tracking-tight text-foreground">{opt.label}</span>
                            <Show when={m().selectedIdeExecutable() === opt.executable}><span class="iconify mdi--check size-3.5 text-primary" /></Show>
                          </DropdownMenuItem>
                        )}
                      </For>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Show>
              <div class="flex items-center gap-2 px-3">
                <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground/80" title={t('projectDetail.totalWorktime') as string}>
                  <span class="iconify mdi--clock-outline size-3" />
                  {formatWorktime(p().totalPlaytimeMs)}
                </div>
                <Show when={p().lastOpenedAtMs}>
                  <Separator orientation="vertical" class="h-2.5 opacity-40" />
                  <div class="text-[10px] font-bold uppercase tracking-tight text-muted-foreground/60">
                    {t('projectDetail.lastStartedRelative', { time: formatRelativeTime(p().lastOpenedAtMs) }) as string}
                  </div>
                </Show>
              </div>
            </div>

            <Portal mount={document.getElementById("window-title-bar-actions")!}>
              <div class="flex h-full items-stretch animate-in fade-in slide-in-from-right-2 duration-300">
                <Separator orientation="vertical" class="h-full w-px bg-border/60" />

                {/* Desktop View: Action Row */}
                <div class="hidden items-stretch sm:flex">
                  <Tooltip openDelay={400}>
                    <TooltipTrigger as={Button} type="button" variant="ghost" size="icon" class={cn("h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground", p().favorite && "text-yellow-500 hover:text-yellow-600")} onClick={() => m().favMutate({ id: p().id, favorite: !p().favorite })}>
                      <span class={cn("iconify size-4", p().favorite ? "mdi--star" : "mdi--star-outline")} />
                    </TooltipTrigger>
                    <TooltipContent>{p().favorite ? (t('projectDetail.favRemove') as string) : (t('projectDetail.favMark') as string)}</TooltipContent>
                  </Tooltip>
                  <Show when={m().gitStatusQ.data}>
                    {(s) => (
                      <Popover gutter={8}>
                        <Tooltip openDelay={400}>
                          <TooltipTrigger as={PopoverTrigger} variant="ghost" size="icon" class="inline-flex h-full w-8 items-center justify-center rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground">
                            <span class="iconify mdi--git size-4" />
                          </TooltipTrigger>
                          <TooltipContent>{t('projectDetail.gitStatusTooltip', { branch: s().branch }) as string}</TooltipContent>
                        </Tooltip>
                        <PopoverContent class="w-64 p-3 text-foreground shadow-xl border-border/40">
                          <div class="space-y-3">
                             <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                   <span class="iconify mdi--git size-4 text-primary/80" />
                                   <span class="max-w-[140px] truncate font-mono text-xs font-bold">{s().branch}</span>
                                </div>
                                <Show when={s().isDirty}><Badge variant="outline" class="h-5 bg-yellow-500/5 px-1.5 text-[9px] border-yellow-500/50 text-yellow-600">{t('projectDetail.gitModified') as string}</Badge></Show>
                             </div>
                             <div class="grid grid-cols-2 gap-2 border-t border-border/40 pt-1">
                                <div class="space-y-1">
                                   <p class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t('projectDetail.gitAhead') as string}</p>
                                   <div class="flex items-center gap-1.5"><span class="iconify mdi--arrow-up size-3.5 text-green-500" /><span class="font-mono text-sm font-bold tabular-nums">{s().ahead}</span></div>
                                </div>
                                <div class="space-y-1">
                                   <p class="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t('projectDetail.gitBehind') as string}</p>
                                   <div class="flex items-center gap-1.5"><span class="iconify mdi--arrow-down size-3.5 text-blue-500" /><span class="font-mono text-sm font-bold tabular-nums">{s().behind}</span></div>
                                </div>
                             </div>
                               <Show when={s().hasUpstream}>
                                   <div class="flex gap-2 pt-2">
                                      <Button size="sm" class="h-8 flex-1 gap-1.5 text-xs font-bold" variant={s().ahead > 0 ? "default" : "secondary"} disabled={m().isPushing() || m().isPulling()} onClick={() => m().pushMutate()}>
                                         <Show when={m().isPushing()} fallback={<span class="iconify mdi--upload size-3.5" />}><span class="iconify mdi--loading animate-spin size-3.5" /></Show>
                                         {t('projectDetail.gitPush') as string}
                                      </Button>
                                      <Button size="sm" class="h-8 flex-1 gap-1.5 text-xs font-bold" variant={s().behind > 0 ? "default" : "secondary"} disabled={m().isPulling() || m().isPushing()} onClick={() => m().pullMutate()}>
                                         <Show when={m().isPulling()} fallback={<span class="iconify mdi--download size-3.5" />}><span class="iconify mdi--loading animate-spin size-3.5" /></Show>
                                         {t('projectDetail.gitPull') as string}
                                      </Button>
                                   </div>
                                  <div class="border-t border-border/40 pt-2">
                                    <Button size="sm" class="h-8 w-full gap-1.5 text-xs font-bold" variant="outline" disabled={m().isTagging()} onClick={() => setTagDialogOpen(true)}>
                                      <Show when={m().isTagging()} fallback={<span class="iconify mdi--tag-plus size-3.5" />}><span class="iconify mdi--loading animate-spin size-3.5" /></Show>
                                      {t('projectDetail.gitPushTag') as string}
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
                      <TooltipTrigger as={Button} type="button" variant="ghost" size="icon" class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground" disabled={m().isIniting()} onClick={() => m().initMutate()}>
                        <Show when={m().isIniting()} fallback={<span class="iconify mdi--git size-4" />}>
                          <span class="iconify mdi--loading animate-spin size-4" />
                        </Show>
                      </TooltipTrigger>
                      <TooltipContent>{t('projectDetail.gitInit') as string}</TooltipContent>
                    </Tooltip>
                  </Show>
                  <Tooltip openDelay={400}>
                    <TooltipTrigger as={Button} type="button" variant="ghost" size="icon" class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground" onClick={() => void m().onOpenProjectInFileManager(p().path)}>
                      <span class="iconify mdi--folder-open size-4" />
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDetail.openInSystemExplorer") as string}</TooltipContent>
                  </Tooltip>
                  <Tooltip openDelay={400}>
                    <TooltipTrigger as={Button} type="button" variant="ghost" size="icon" class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground" onClick={() => { m().setMoveTargetLocationId(null); m().setMoveOpen(true); }}>
                      <span class="iconify mdi--file-move size-4" />
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDetail.moveProject") as string}</TooltipContent>
                  </Tooltip>
                  <Tooltip openDelay={400}>
                    <TooltipTrigger as={Button} type="button" variant="ghost" size="icon" class="h-full w-8 rounded-none px-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteConfirmOpen(true)}>
                      <span class="iconify mdi--trash-can-outline size-4" />
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDetail.deleteProject") as string}</TooltipContent>
                  </Tooltip>
                </div>

                {/* Mobile View: Dropdown Chevron */}
                <div class="flex items-stretch sm:hidden">
                  <DropdownMenu gutter={0}>
                    <DropdownMenuTrigger as={Button} variant="ghost" size="icon" class="h-full w-10 rounded-none px-0 text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground focus-visible:ring-0">
                      <span class="iconify mdi--chevron-down size-5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent class="w-56">
                      <Show when={m().gitStatusQ.data}>
                        {(s) => (
                          <>
                            <div class="mb-1 flex items-center justify-between border-b border-border/40 bg-muted/30 px-2 py-1.5">
                              <div class="flex min-w-0 items-center gap-2">
                                <span class="iconify mdi--git size-4 text-primary/80" />
                                <span class="max-w-[100px] truncate font-mono text-[10px] font-bold">{s().branch}</span>
                              </div>
                              <div class="flex items-center gap-1.5 shrink-0">
                                <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums"><span class="iconify mdi--arrow-up size-3 text-green-500" />{s().ahead}</span>
                                <span class="flex items-center gap-0.5 text-[10px] font-bold tabular-nums"><span class="iconify mdi--arrow-down size-3 text-blue-500" />{s().behind}</span>
                              </div>
                            </div>
                              <Show when={s().hasUpstream}>
                                <DropdownMenuItem disabled={m().isPushing() || m().isPulling()} onClick={() => m().pushMutate()}>
                                  <Show when={m().isPushing()} fallback={<span class="iconify mdi--upload size-4" />}><span class="iconify mdi--loading animate-spin size-4" /></Show>
                                  <span>{t('projectDetail.gitPushTooltip') as string}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={m().isPulling() || m().isPushing()} onClick={() => m().pullMutate()}>
                                  <Show when={m().isPulling()} fallback={<span class="iconify mdi--download size-4" />}><span class="iconify mdi--loading animate-spin size-4" /></Show>
                                  <span>{t('projectDetail.gitPullTooltip') as string}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={m().isTagging()} onClick={() => setTagDialogOpen(true)}>
                                  <Show when={m().isTagging()} fallback={<span class="iconify mdi--tag-plus size-4" />}><span class="iconify mdi--loading animate-spin size-4" /></Show>
                                  <span>{t('projectDetail.gitPushTag') as string}</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </Show>
                          </>
                        )}
                      </Show>
                      <Show when={m().gitStatusQ.data == null && !m().gitStatusQ.isPending}>
                        <DropdownMenuItem disabled={m().isIniting()} onClick={() => m().initMutate()}>
                          <Show when={m().isIniting()} fallback={<span class="iconify mdi--git size-4" />}>
                            <span class="iconify mdi--loading animate-spin size-4" />
                          </Show>
                          <span>{t('projectDetail.gitInit') as string}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </Show>
                      <DropdownMenuItem onClick={() => m().favMutate({ id: p().id, favorite: !p().favorite })}>
                        <span class={cn("iconify size-4", p().favorite ? "mdi--star text-yellow-500" : "mdi--star-outline")} />
                        <span>{p().favorite ? (t('projectDetail.gitUnstar') as string) : (t('projectDetail.gitStar') as string)}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void m().onOpenProjectInFileManager(p().path)}>
                        <span class="iconify mdi--folder-open size-4" />
                        <span>{t('projectDetail.openInSystemExplorer') as string}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { m().setMoveTargetLocationId(null); m().setMoveOpen(true); }}>
                        <span class="iconify mdi--file-move size-4" />
                        <span>{t('projectDetail.moveProject') as string}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem class="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => setDeleteConfirmOpen(true)}>
                        <span class="iconify mdi--trash-can-outline size-4" />
                        <span>{t('projectDetail.deleteProject') as string}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Portal>
          </div>
        )}
      </Show>

      <LanguageBar projectId={m().props.projectId} />

      <Dialog open={tagDialogOpen()} onOpenChange={(open) => {
        setTagDialogOpen(open);
        setTagError(null);
        if (!open) {
          setTagStep("bump");
          setDiscoveredFiles(null);
          setSelectedVersionFiles(new Set<string>());
        }
      }}>
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <Show when={tagStep() === "bump"} fallback={
              <>
                <DialogTitle>{t("projectDetail.gitBumpTitle") as string}</DialogTitle>
                <DialogDescription>
                  {discoveredFiles() ? (t("projectDetail.gitBumpDescription", { current: discoveredFiles()!.currentVersion, new: discoveredFiles()!.newVersion }) as string) : ""}
                </DialogDescription>
              </>
            }>
              <DialogTitle>{t("projectDetail.gitPushTagTitle") as string}</DialogTitle>
              <DialogDescription>{t("projectDetail.gitPushTagDescription") as string}</DialogDescription>
            </Show>
          </DialogHeader>

          <Show when={tagStep() === "bump"}>
            <Show when={tagError()}>
              <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {tagError()}
              </div>
            </Show>
            <div class="grid grid-cols-3 gap-3 py-2">
              <Button variant="outline" class="flex flex-col gap-1 h-auto py-3" disabled={m().isDiscoveringFiles()} onClick={async () => {
                setSelectedBump("patch");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("patch");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(new Set<string>(result.files.map(f => f.path)));
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}>
                <Show when={m().isDiscoveringFiles() && selectedBump() === "patch"} fallback={
                  <>
                    <span class="text-lg font-bold">patch</span>
                    <span class="text-[10px] text-muted-foreground">x.x.1 → x.x.2</span>
                  </>
                }>
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
              <Button variant="outline" class="flex flex-col gap-1 h-auto py-3" disabled={m().isDiscoveringFiles()} onClick={async () => {
                setSelectedBump("minor");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("minor");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(new Set<string>(result.files.map(f => f.path)));
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}>
                <Show when={m().isDiscoveringFiles() && selectedBump() === "minor"} fallback={
                  <>
                    <span class="text-lg font-bold">minor</span>
                    <span class="text-[10px] text-muted-foreground">x.1.x → x.2.0</span>
                  </>
                }>
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
              <Button variant="outline" class="flex flex-col gap-1 h-auto py-3" disabled={m().isDiscoveringFiles()} onClick={async () => {
                setSelectedBump("major");
                setTagError(null);
                try {
                  const result = await m().discoverVersionFiles("major");
                  setDiscoveredFiles(result);
                  setSelectedVersionFiles(new Set<string>(result.files.map(f => f.path)));
                  setTagStep("files");
                } catch (e: any) {
                  setTagError(e?.message || String(e));
                }
              }}>
                <Show when={m().isDiscoveringFiles() && selectedBump() === "major"} fallback={
                  <>
                    <span class="text-lg font-bold">major</span>
                    <span class="text-[10px] text-muted-foreground">1.x.x → 2.0.0</span>
                  </>
                }>
                  <span class="iconify mdi--loading animate-spin size-5" />
                </Show>
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagDialogOpen(false)}>{t("common.cancel") as string}</Button>
            </DialogFooter>
          </Show>

          <Show when={tagStep() === "files" && discoveredFiles()}>
            {(data) => (
              <div class="space-y-3">
                <Show when={data().files.length > 0} fallback={
                  <div class="text-center py-4 space-y-3">
                    <p class="text-sm text-muted-foreground">{t("projectDetail.gitBumpNoFiles") as string}</p>
                    <div class="flex justify-center gap-2">
                      <Button variant="outline" size="sm" disabled={m().isBumpingVersion()} onClick={() => setTagStep("bump")}>
                        <span class="iconify mdi--arrow-left size-3.5" />
                        {t("common.back") as string}
                      </Button>
                      <Button size="sm" disabled={m().isBumpingVersion()} onClick={() => {
                        m().tagAndPushMutate(selectedBump());
                        setTagDialogOpen(false);
                      }}>
                        <Show when={m().isBumpingVersion()} fallback={<span class="iconify mdi--tag-plus size-3.5" />}><span class="iconify mdi--loading animate-spin size-3.5" /></Show>
                        {t("projectDetail.gitPushTagOnly") as string}
                      </Button>
                    </div>
                  </div>
                }>
                  <div class="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                    <For each={data().files}>
                      {(file) => (
                        <div class="flex items-start gap-2">
                          <Checkbox
                            id={`version-file-${file.path}`}
                            checked={selectedVersionFiles().has(file.path)}
                            onChange={(checked) => {
                              setSelectedVersionFiles(prev => {
                                const next = new Set(prev);
                                if (checked) next.add(file.path);
                                else next.delete(file.path);
                                return next;
                              });
                            }}
                          />
                          <div class="flex-1 min-w-0">
                            <label for={`version-file-${file.path}`} class="text-xs font-mono font-medium cursor-pointer">{file.path}</label>
                            <p class="text-[10px] text-muted-foreground font-mono truncate">{file.preview}</p>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" disabled={m().isBumpingVersion()} onClick={() => setTagStep("bump")}>
                      <span class="iconify mdi--arrow-left size-3.5" />
                      {t("common.back") as string}
                    </Button>
                    <Button variant="outline" onClick={() => setTagDialogOpen(false)} disabled={m().isBumpingVersion()}>{t("common.cancel") as string}</Button>
                    <Button disabled={m().isBumpingVersion() || selectedVersionFiles().size === 0} onClick={() => {
                      m().bumpVersionAndTag({ bump: selectedBump(), files: Array.from(selectedVersionFiles()) });
                      setTagDialogOpen(false);
                    }}>
                      <Show when={m().isBumpingVersion()} fallback={<span class="iconify mdi--tag-plus size-3.5" />}><span class="iconify mdi--loading animate-spin size-3.5" /></Show>
                      {t("projectDetail.gitBumpCommitTagPush") as string}
                    </Button>
                  </DialogFooter>
                </Show>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen()} onOpenChange={(v) => { setDeleteConfirmOpen(v); if (!v) setDeleteFromDisk(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projectDetail.deleteProjectTitle") as string}</AlertDialogTitle>
            <AlertDialogDescription>{t("projectDetail.deleteProjectDescription") as string}</AlertDialogDescription>
          </AlertDialogHeader>
          <div class="flex items-center gap-2 py-2">
            <Checkbox
              id="delete-from-disk"
              checked={deleteFromDisk()}
              onChange={setDeleteFromDisk}
            />
            <label for="delete-from-disk" class="cursor-pointer text-xs text-muted-foreground">
              {t("projectDetail.deleteFromDisk") as string}
            </label>
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{t("wizard.cancel") as string}</Button>
            <Button variant="destructive" onClick={() => { setDeleteConfirmOpen(false); m().deleteProject(m().props.projectId, deleteFromDisk()); }}>{t("projectDetail.deleteConfirm") as string}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
