import { listen } from "@tauri-apps/api/event";
import {
  createQuery,
  createMutation,
  useQueryClient,
} from "@tanstack/solid-query";
import {
  For,
  Show,
  createEffect,
  createMemo,
  onCleanup,
  type Accessor,
  type Setter,
} from "solid-js";

import { StackIcon } from "~/components/StackIcon";
import { ProjectCard } from "./ProjectCard";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "~/components/ui/popover";
import { toast } from "solid-sonner";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { listProjects, listRunningProjects, setProjectFavorite } from "~/services/tauri/projects";
import { listDiscoveredIdes } from "~/services/tauri/ide";
import { openProjectInIde, stopProjectIde } from "~/services/tauri/ide";
import { queryKeys } from "~/services/query-keys";
import { fetchGitHubViewer } from "~/services/github";
import type { ProjectDto } from "~/types/dto";
import { buildStacksList, filterProjectList } from "./filter-projects";
import { cn } from "~/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

export function LibraryView(props: {
  search: Accessor<string>;
  onSearchChange: Setter<string>;
  filter: Accessor<string>;
  onFilterChange: Setter<string>;
  selectedProjectId: Accessor<string | null>;
  onOpenProject?: (id: string) => void;
  onOpenProjectTab?: (id: string, tab: string) => void;
}) {
  const { t } = useI18n();
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
      un = await listen<{ projectId: string; running: boolean }>(
        "ide-state-changed",
        () => {
          void qc.invalidateQueries({ queryKey: ["projects", "running-ides"] });
          void qc.invalidateQueries({ queryKey: queryKeys.projects });
        },
      );
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
    filterProjectList(
      q.data ?? [],
      props.filter(),
      props.search(),
      ghViewerQ.data?.login,
    ),
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
      void qc.invalidateQueries({
        queryKey: queryKeys.project(props.selectedProjectId() ?? ""),
      });
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
    const r = await openProjectInIde({
      projectId: project.id,
      executable: ide.executable,
    });
    if (r.isErr()) toast.error(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const filterChips = createMemo(() => {
    const list = [
      { id: "all", label: t("library.filterAll"), icon: "mdi--apps" },
      {
        id: "favorites",
        label: t("library.filterFavorites"),
        icon: "mdi--star",
      },
      {
        id: "recent",
        label: t("library.filterRecent"),
        icon: "mdi--clock-outline",
      },
      { id: "git", label: t("library.filterGit"), icon: "mdi--git" },
      { id: "github", label: t("library.filterGitHub"), icon: "mdi--github" },
    ];
    if (ghViewerQ.data) {
      list.push({
        id: "own",
        label: t("library.filterMyRepos"),
        icon: "mdi--account",
      });
    }
    return list;
  });

  const activeFilterLabel = createMemo(() => {
    const chip = filterChips().find((c) => c.id === props.filter());
    if (chip) return chip.label;
    if (props.filter().startsWith("stack:")) return props.filter().slice(6);
    return t("library.filterAll");
  });

  const hasActiveFilters = createMemo(
    () => props.filter() !== "all" || props.search().length > 0,
  );

  return (
    <div class="flex flex-col h-full overflow-hidden bg-background">
      {/* Compact Dashboard Header */}
      <div class="flex shrink-0 flex-col gap-2 border-b border-border/50 bg-background/50 px-4 py-3">
        <div class="flex items-center gap-3">
          <h1 class="text-lg font-bold tracking-tight text-foreground">
            {t("library.title")}
          </h1>
          <Badge
            variant="secondary"
            class="h-5 px-1.5 font-mono text-[11px] tabular-nums opacity-70"
          >
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
                  hasActiveFilters() && "border-primary text-primary",
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
                  <p class="text-xs font-semibold text-muted-foreground">
                    {t("library.filters")}
                  </p>
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
                    <p class="text-xs font-semibold text-muted-foreground">
                      {t("library.stacks")}
                    </p>
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
                              onClick={() =>
                                props.onFilterChange(
                                  props.filter() === `stack:${st}`
                                    ? "all"
                                    : `stack:${st}`,
                                )
                              }
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
                      onClick={() => {
                        props.onSearchChange("");
                        props.onFilterChange("all");
                      }}
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
                    onClick={() =>
                      props.onFilterChange(
                        props.filter() === `stack:${st}`
                          ? "all"
                          : `stack:${st}`,
                      )
                    }
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
              onClick={() => {
                props.onSearchChange("");
                props.onFilterChange("all");
              }}
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
            <h3 class="text-lg font-semibold mb-1">
              {t("library.emptyTitle")}
            </h3>
            <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
              {t("library.empty") as string}
            </p>
          </div>
        </Show>

        <Show
          when={
            q.isSuccess && (q.data?.length ?? 0) > 0 && filtered().length === 0
          }
        >
          <div class="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
            <div class="size-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
              <span class="iconify mdi--filter-off-outline h-10 w-10 text-muted-foreground/20" />
            </div>
            <h3 class="text-lg font-semibold mb-1">
              {t("library.emptyFilteredTitle")}
            </h3>
            <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
              {t("library.emptyFiltered") as string}
            </p>
            <Button
              variant="link"
              class="mt-2 text-primary"
              onClick={() => {
                props.onSearchChange("");
                props.onFilterChange("all");
              }}
            >
              {t("library.clearFilters")}
            </Button>
          </div>
        </Show>

        <div
          class="grid gap-3 pb-10"
          style={{
            "grid-template-columns": "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          <For each={filtered()}>
            {(project) => (
              <ProjectCard
                project={project}
                selected={props.selectedProjectId() === project.id}
                isRunning={runningProjectsQ.data?.includes(project.id) ?? false}
                hasDefaultIde={!!defaultIde()}
                onOpenProject={() => props.onOpenProject?.(project.id)}
                onOpenProjectTab={(tab) =>
                  props.onOpenProjectTab?.(project.id, tab)
                }
                onToggleFavorite={(e) => toggleFavorite(project, e)}
                onPlay={(e) => void onPlay(project, e)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
