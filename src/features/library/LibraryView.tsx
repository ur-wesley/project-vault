import { listen } from "@tauri-apps/api/event";
import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query";
import {
  For,
  Show,
  createEffect,
  createMemo,
  onCleanup,
  type Accessor,
  type Setter,
} from "solid-js";

import { useLivePlaytime } from "~/lib/live-playtime-context";
import { StackIcon } from "~/components/StackIcon";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { toast } from "solid-sonner";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  listDiscoveredIdes,
  listProjects,
  openProjectInIde,
  listRunningProjects,
  stopProjectIde,
  setProjectFavorite,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { fetchGitHubViewer } from "~/services/github";
import type { ProjectDto } from "~/types/dto";
import { buildStacksList, filterProjectList } from "./filter-projects";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/lib/format-date";
import { formatBytes } from "~/lib/format-bytes";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

export function LibraryView(props: {
  search: Accessor<string>;
  onSearchChange: Setter<string>;
  filter: Accessor<string>;
  onFilterChange: Setter<string>;
  selectedProjectId: Accessor<string | null>;
  onOpenProject?: (id: string) => void;
  onOpenProjectTab?: (id: string, tab: string) => void;
}) {
  const { t, localeCode } = useI18n();
  const { getLivePlaytimeMs } = useLivePlaytime();
  const qc = useQueryClient();

  const q = createQuery(() => ({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const r = await listProjects();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const idesQ = createQuery(() => ({
    queryKey: queryKeys.discoveredIdes,
    queryFn: async () => {
      const r = await listDiscoveredIdes();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const runningProjectsQ = createQuery(() => ({
    queryKey: ["projects", "running-ides"] as const,
    queryFn: async () => {
      const r = await listRunningProjects();
      return r.isErr() ? [] : r.value;
    },
    refetchInterval: 10000,
  }));

  // Listen for IDE state changes
  createEffect(() => {
    let un: (() => void) | undefined;
    void (async () => {
      un = await listen<{ projectId: string; running: boolean }>("ide-state-changed", () => {
        void qc.invalidateQueries({ queryKey: ["projects", "running-ides"] });
        void qc.invalidateQueries({ queryKey: queryKeys.projects });
      });
    })();
    onCleanup(() => un?.());
  });

  const ghViewerQ = createQuery(() => ({
    queryKey: queryKeys.githubViewer(),
    queryFn: async () => {
      const r = await fetchGitHubViewer();
      if (r.isErr()) return null;
      return r.value;
    },
    staleTime: 1000 * 60 * 15,
  }));

  const filtered = createMemo(() =>
    filterProjectList(q.data ?? [], props.filter(), props.search(), ghViewerQ.data?.login),
  );

  const stacks = createMemo(() => buildStacksList(q.data ?? []));

  const defaultIde = () => idesQ.data?.[0];

  const favMutate = createMutation(() => ({
    mutationFn: async (p: { id: string; favorite: boolean }) => {
      const r = await setProjectFavorite({ id: p.id, favorite: p.favorite });
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      void qc.invalidateQueries({ queryKey: queryKeys.project(props.selectedProjectId() ?? "") });
    },
  }));

  const toggleFavorite = (project: ProjectDto, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    favMutate.mutate({ id: project.id, favorite: !project.favorite });
  };

  const onPlay = async (project: ProjectDto, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (runningProjectsQ.data?.includes(project.id)) {
      const r = await stopProjectIde(project.id);
      if (r.isErr()) toast.error(stableErrorMessage(t, r.error));
      return;
    }

    const ide = defaultIde();
    if (!ide) {
      toast.error(t("library.noIdeFound") as string);
      return;
    }
    const r = await openProjectInIde({ projectId: project.id, executable: ide.executable });
    if (r.isErr()) toast.error(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const formatPlaytime = (ms: number) => {
    if (ms <= 0) return null;
    const hours = ms / (1000 * 60 * 60);
    if (hours < 0.1) return "< 0.1h";
    return `${hours.toFixed(1)}h`;
  };

  const filterChips = createMemo(() => {
    const list = [
      { id: "all", label: t("library.filterAll"), icon: "mdi--apps" },
      { id: "favorites", label: t("library.filterFavorites"), icon: "mdi--star" },
      { id: "recent", label: t("library.filterRecent"), icon: "mdi--clock-outline" },
      { id: "git", label: t("library.filterGit"), icon: "mdi--git" },
      { id: "github", label: t("library.filterGitHub"), icon: "mdi--github" },
    ];
    if (ghViewerQ.data) {
      list.push({ id: "own", label: t("library.filterMyRepos"), icon: "mdi--account" });
    }
    return list;
  });

  const activeFilterLabel = createMemo(() => {
    const chip = filterChips().find((c) => c.id === props.filter());
    if (chip) return chip.label;
    if (props.filter().startsWith("stack:")) return props.filter().slice(6);
    return t("library.filterAll");
  });

  const hasActiveFilters = createMemo(() => props.filter() !== "all" || props.search().length > 0);

  return (
    <div class="flex flex-col h-full overflow-hidden bg-background">
      {/* Compact Dashboard Header */}
      <div class="flex shrink-0 flex-col gap-2 border-b border-border/50 bg-background/50 px-4 py-3">
        <div class="flex items-center gap-3">
          <h1 class="text-lg font-bold tracking-tight text-foreground">{t("library.title")}</h1>
          <Badge variant="secondary" class="h-5 px-1.5 font-mono text-[11px] tabular-nums opacity-70">
            {filtered().length}
          </Badge>

          <div class="ml-auto flex items-center gap-2">
            {/* Search - always visible */}
            <div class="w-40 sm:w-56">
              <TextField>
                <TextFieldInput
                  placeholder={t("library.searchPlaceholder") as string}
                  class="h-8 border-border/40 bg-muted/30 text-sm shadow-inner"
                  value={props.search()}
                  onInput={(e) => props.onSearchChange(e.currentTarget.value)}
                  autocomplete="off"
                />
              </TextField>
            </div>

            {/* Filter button - visible on small screens, shows popover */}
            <Popover>
              <PopoverTrigger
                as={Button}
                variant="outline"
                size="sm"
                class={cn(
                  "h-8 gap-1.5 text-xs lg:hidden",
                  hasActiveFilters() && "border-primary text-primary"
                )}
              >
                <span class="iconify mdi--filter-outline size-3.5" />
                <span>{activeFilterLabel()}</span>
                <Show when={hasActiveFilters()}>
                  <span class="ml-0.5 size-1.5 rounded-full bg-primary" />
                </Show>
              </PopoverTrigger>
              <PopoverContent class="w-64">
                <div class="flex flex-col gap-3">
                  <p class="text-xs font-semibold text-muted-foreground">{t("library.filters")}</p>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={filterChips()}>
                      {(chip) => (
                        <button
                          type="button"
                          class={cn(
                            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all",
                            props.filter() === chip.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                          )}
                          onClick={() => props.onFilterChange(chip.id)}
                        >
                          <span class={cn("iconify size-3.5", chip.icon)} />
                          {chip.label}
                        </button>
                      )}
                    </For>
                  </div>

                  <Show when={stacks().length > 0}>
                    <p class="text-xs font-semibold text-muted-foreground">{t("library.stacks")}</p>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={stacks()}>
                        {(st) => (
                        <Tooltip>
                          <TooltipTrigger
                            as="button"
                            type="button"
                            class={cn(
                              "flex h-7 w-7 items-center justify-center rounded-md border transition-all",
                              props.filter() === `stack:${st}`
                                ? "bg-primary/10 border-primary text-primary"
                                : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted hover:border-border",
                            )}
                            onClick={() => props.onFilterChange(props.filter() === `stack:${st}` ? "all" : `stack:${st}`)}
                          >
                            <StackIcon stack={st} class="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent>{st}</TooltipContent>
                        </Tooltip>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={hasActiveFilters()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => { props.onSearchChange(""); props.onFilterChange("all"); }}
                    >
                      {t("library.clearFilters")}
                    </Button>
                  </Show>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Filter chips - visible on large screens only */}
        <div class="hidden lg:flex items-center gap-2">
          <For each={filterChips()}>
            {(chip) => (
              <button
                type="button"
                class={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-all active:scale-95",
                  props.filter() === chip.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40",
                )}
                onClick={() => props.onFilterChange(chip.id)}
              >
                <span class={cn("iconify size-3.5", chip.icon)} />
                {chip.label}
              </button>
            )}
          </For>

          <Show when={stacks().length > 0}>
            <div class="mx-1 h-4 w-px bg-border/60" />
            <For each={stacks()}>
              {(st) => (
                <Tooltip>
                  <TooltipTrigger
                    as="button"
                    type="button"
                    class={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md border transition-all active:scale-90",
                      props.filter() === `stack:${st}`
                        ? "bg-primary/10 border-primary text-primary shadow-sm"
                        : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted hover:border-border hover:text-foreground",
                    )}
                    onClick={() => props.onFilterChange(props.filter() === `stack:${st}` ? "all" : `stack:${st}`)}
                  >
                    <StackIcon stack={st} class="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{st}</TooltipContent>
                </Tooltip>
              )}
            </For>
          </Show>

          <Show when={hasActiveFilters()}>
            <button
              type="button"
              class="ml-1 flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { props.onSearchChange(""); props.onFilterChange("all"); }}
            >
              <span class="iconify mdi--close-circle-outline size-3.5" />
              {t("library.clearFilters")}
            </button>
          </Show>
        </div>
      </div>

      {/* Grid Content */}
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-none">
        <Show when={q.isPending}>
          <div class="flex items-center justify-center py-20">
             <span class="iconify mdi--loading animate-spin h-8 w-8 text-muted-foreground/20" />
          </div>
        </Show>
        <Show when={q.isError}>
          <p class="p-6 text-sm text-destructive font-medium bg-destructive/5 rounded-md border border-destructive/10 text-center">
            {t("library.error") as string}
          </p>
        </Show>
        
        <Show when={q.isSuccess && (q.data?.length ?? 0) === 0}>
          <div class="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
             <div class="size-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                <span class="iconify mdi--folder-plus-outline h-10 w-10 text-muted-foreground/20" />
             </div>
             <h3 class="text-lg font-semibold mb-1">{t("library.emptyTitle")}</h3>
             <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
               {t("library.empty") as string}
             </p>
          </div>
        </Show>

        <Show when={q.isSuccess && (q.data?.length ?? 0) > 0 && filtered().length === 0}>
           <div class="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
              <div class="size-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                <span class="iconify mdi--filter-off-outline h-10 w-10 text-muted-foreground/20" />
             </div>
             <h3 class="text-lg font-semibold mb-1">{t("library.emptyFilteredTitle")}</h3>
             <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
               {t("library.emptyFiltered") as string}
             </p>
             <Button variant="link" class="mt-2 text-primary" onClick={() => { props.onSearchChange(""); props.onFilterChange("all"); }}>
               {t("library.clearFilters")}
             </Button>
          </div>
        </Show>

        <div class="grid gap-3 pb-10" style={{ "grid-template-columns": "repeat(auto-fill, minmax(320px, 1fr))" }}>
          <For each={filtered()}>
            {(project) => {
              const livePlaytimeMs = createMemo(() =>
                getLivePlaytimeMs(project.id, project.totalPlaytimeMs)(),
              );
              return (
              <div
                role="button"
                tabindex="0"
                class="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border/80 bg-card p-3 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40 hover:shadow-md active:scale-[0.98]"
                classList={{
                  "border-primary/50 ring-2 ring-primary/10 bg-primary/5":
                    props.selectedProjectId() === project.id,
                }}
                onClick={() => props.onOpenProject?.(project.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onOpenProject?.(project.id);
                  }
                }}
              >
                {/* Card Header: Name + Stack */}
                <div class="flex flex-1 items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <Show when={project.tags.includes("monorepo")}>
                        <StackIcon stack="monorepo" class="size-3.5 shrink-0 opacity-80" />
                      </Show>
                      <p class="truncate text-sm font-bold leading-tight text-foreground group-hover:text-primary transition-colors">
                        {project.name}
                      </p>
                    </div>
                    <div class="mt-0.5 flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger
                          as="div"
                          class="flex items-center gap-1 opacity-70"
                        >
                          <StackIcon stack={project.stack} class="h-3 w-3" />
                          <span class="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{project.stack}</span>
                        </TooltipTrigger>
                        <TooltipContent>{project.stack}</TooltipContent>
                      </Tooltip>
                      <Show when={project.runtimeHint}>
                        <div class="flex items-center gap-1 border-l border-border/50 pl-1.5">
                           <StackIcon stack={project.runtimeHint!} class="size-3 opacity-80" />
                           <span class="text-[10px] font-medium text-muted-foreground/80">{project.runtimeHint}</span>
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
                        project.favorite
                          ? "text-yellow-500 hover:bg-yellow-500/10"
                          : "text-muted-foreground/40 hover:text-yellow-500 hover:bg-muted"
                      )}
                      onClick={(e) => toggleFavorite(project, e)}
                    >
                      <span class={cn("iconify size-4", project.favorite ? "mdi--star" : "mdi--star-outline")} />
                    </TooltipTrigger>
                    <TooltipContent>{project.favorite ? t("library.unfavorite") as string : t("library.favorite") as string}</TooltipContent>
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
                          <span class="text-[10px] font-mono font-medium text-muted-foreground">{project.fileCount}</span>
                          <Show when={project.sizeBytes > 0}>
                            <span class="mx-0.5 h-2.5 w-px bg-border/60" />
                            <span class="iconify mdi--harddisk text-muted-foreground/60 size-3" />
                            <span class="text-[10px] font-mono font-medium text-muted-foreground">{formatBytes(project.sizeBytes)}</span>
                          </Show>
                        </TooltipTrigger>
                        <TooltipContent>{`${t("library.fileCount") as string} · ${t("library.projectSize") as string}`}</TooltipContent>
                      </Tooltip>
                      <Show when={formatRelativeTime(project.lastEditedAtMs, localeCode()) || formatPlaytime(livePlaytimeMs())}>
                        <Tooltip>
                          <TooltipTrigger
                            as="div"
                            class="hidden sm:flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5"
                          >
                            <Show when={formatPlaytime(livePlaytimeMs())}>
                              <span class="iconify mdi--clock-outline text-muted-foreground/60 size-3" />
                              <span class="text-[10px] font-mono font-medium text-muted-foreground">{formatPlaytime(livePlaytimeMs())}</span>
                            </Show>
                            <Show when={formatRelativeTime(project.lastEditedAtMs, localeCode()) && formatPlaytime(livePlaytimeMs())}>
                              <span class="mx-0.5 h-2.5 w-px bg-border/60" />
                            </Show>
                            <Show when={formatRelativeTime(project.lastEditedAtMs, localeCode())}>
                              <span class="iconify mdi--pencil-outline text-muted-foreground/60 size-3" />
                              <span class="text-[10px] font-mono font-medium text-muted-foreground">{formatRelativeTime(project.lastEditedAtMs, localeCode())}</span>
                            </Show>
                          </TooltipTrigger>
                          <TooltipContent>{`${t("library.totalPlaytime") as string} · ${t("library.lastEdited") as string}`}</TooltipContent>
                        </Tooltip>
                      </Show>
                  </div>
                  
                  <Show
                    when={defaultIde()}
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
                        variant={runningProjectsQ.data?.includes(project.id) ? "default" : "secondary"}
                        class={cn(
                          "size-7 shrink-0 rounded-md transition-all hover:shadow-sm",
                          runningProjectsQ.data?.includes(project.id)
                             ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20"
                             : "hover:bg-primary hover:text-primary-foreground"
                        )}
                        onClick={(e) => void onPlay(project, e)}
                      >
                        <Show when={runningProjectsQ.data?.includes(project.id)} fallback={<span class="iconify mdi--play size-4" />}>
                          <span class="iconify mdi--stop size-4 animate-in zoom-in duration-300" />
                        </Show>
                      </TooltipTrigger>
                      <TooltipContent>{runningProjectsQ.data?.includes(project.id) ? t("library.stopIde") as string : (t("library.playInIde") as string)}</TooltipContent>
                    </Tooltip>
                  </Show>
                </div>

                {/* Quick Nav Actions - full-width tab bar at bottom */}
                <div class="-mx-3 -mb-3 mt-1 flex divide-x divide-border/40 border-t border-border/40">
                  <button
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); props.onOpenProjectTab?.(project.id, "files"); }}
                  >
                    <span class="iconify mdi--folder-open-outline size-3" />
                    <span class="truncate">{t("projectDetail.tabFiles")}</span>
                  </button>
                  <button
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); props.onOpenProjectTab?.(project.id, "issues"); }}
                  >
                    <span class="iconify mdi--alert-circle-outline size-3" />
                    <span class="truncate">{t("projectDetail.tabIssues")}</span>
                  </button>
                  <button
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); props.onOpenProjectTab?.(project.id, "tasks"); }}
                  >
                    <span class="iconify mdi--play-circle-outline size-3" />
                    <span class="truncate">{t("projectDetail.tabTasks")}</span>
                  </button>
                  <button
                    type="button"
                    class="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); props.onOpenProjectTab?.(project.id, "terminal"); }}
                  >
                    <span class="iconify mdi--console-line size-3" />
                    <span class="truncate">{t("projectDetail.tabTerminal")}</span>
                  </button>
                </div>
              </div>
            );}
          </For>
        </div>
      </div>
    </div>
  );
}
