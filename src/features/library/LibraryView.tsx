import { listen } from "@tauri-apps/api/event";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Setter,
} from "solid-js";

import { StackIcon } from "~/components/StackIcon";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  listDiscoveredIdes,
  listProjects,
  openProjectInIde,
  listRunningProjects,
  stopProjectIde,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { fetchGitHubViewer } from "~/services/github";
import type { ProjectDto } from "~/types/dto";
import { buildStacksList, filterProjectList } from "./filter-projects";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/lib/format-date";

export function LibraryView(props: {
  search: Accessor<string>;
  onSearchChange: Setter<string>;
  filter: Accessor<string>;
  onFilterChange: Setter<string>;
  selectedProjectId: Accessor<string | null>;
  onOpenProject?: (id: string) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [banner, setBanner] = createSignal<string | null>(null);

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

  const showBanner = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 6000);
  };

  const onPlay = async (project: ProjectDto, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (runningProjectsQ.data?.includes(project.id)) {
      const r = await stopProjectIde(project.id);
      if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
      return;
    }

    const ide = defaultIde();
    if (!ide) {
      showBanner(t("library.noIdeFound") as string);
      return;
    }
    const r = await openProjectInIde({ projectId: project.id, executable: ide.executable });
    if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
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
      { id: "all", label: "All", icon: "mdi--apps" },
      { id: "favorites", label: "Favorites", icon: "mdi--star" },
      { id: "recent", label: "Recent", icon: "mdi--clock-outline" },
      { id: "git", label: "Git", icon: "mdi--git" },
      { id: "github", label: "GitHub", icon: "mdi--github" },
    ];
    if (ghViewerQ.data) {
      list.push({ id: "own", label: "My Repos", icon: "mdi--account" });
    }
    return list;
  });

  return (
    <div class="flex flex-col h-full overflow-hidden bg-background">
      <Show when={banner()}>
        <div class="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
          {banner()}
        </div>
      </Show>

      {/* Dashboard Header */}
      <div class="flex shrink-0 flex-col gap-5 border-b border-border/50 bg-background/50 p-6 pb-4">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold tracking-tight text-foreground">Library</h1>
            <Badge variant="secondary" class="h-6 px-2 font-mono text-xs tabular-nums opacity-80">
              {filtered().length}
            </Badge>
          </div>
          
          <div class="w-full sm:w-80">
            <TextField>
              <TextFieldInput
                placeholder="Search projects by name, path or stack..."
                class="h-10 border-border/40 bg-muted/30 text-sm shadow-inner"
                value={props.search()}
                onInput={(e) => props.onSearchChange(e.currentTarget.value)}
                autocomplete="off"
              />
            </TextField>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <For each={filterChips()}>
              {(chip) => (
                <button
                  type="button"
                  class={cn(
                    "flex h-8 items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-all active:scale-95",
                    props.filter() === chip.id
                      ? "bg-primary text-primary-foreground shadow-md ring-1 ring-primary/20"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40",
                  )}
                  onClick={() => props.onFilterChange(chip.id)}
                >
                  <span class={cn("iconify size-4", chip.icon)} />
                  {chip.label}
                </button>
              )}
            </For>
          </div>

          <Show when={stacks().length > 0}>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mr-1">Stacks</span>
              <For each={stacks()}>
                {(st) => (
                  <button
                    type="button"
                    title={st}
                    class={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg border transition-all active:scale-90",
                      props.filter() === `stack:${st}`
                        ? "bg-primary/10 border-primary text-primary shadow-sm"
                        : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted hover:border-border hover:text-foreground",
                    )}
                    onClick={() => props.onFilterChange(props.filter() === `stack:${st}` ? "all" : `stack:${st}`)}
                  >
                    <StackIcon stack={st} class="size-4" />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Grid Content */}
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-none">
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
             <h3 class="text-lg font-semibold mb-1">Your library is empty</h3>
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
             <h3 class="text-lg font-semibold mb-1">No projects found</h3>
             <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
               {t("library.emptyFiltered") as string}
             </p>
             <Button variant="link" class="mt-2 text-primary" onClick={() => { props.onSearchChange(""); props.onFilterChange("all"); }}>
               Clear all filters
             </Button>
          </div>
        </Show>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pb-10">
          <For each={filtered()}>
            {(project) => (
              <div
                role="button"
                tabindex="0"
                class="group flex min-h-[6.5rem] cursor-pointer flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40 hover:shadow-md active:scale-[0.98]"
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
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <Show when={project.tags.includes("monorepo")}>
                        <StackIcon stack="monorepo" class="size-3.5 shrink-0 opacity-80" title="Monorepo" />
                      </Show>
                      <p class="truncate text-sm font-bold leading-tight text-foreground group-hover:text-primary transition-colors">
                        {project.name}
                      </p>
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <div class="flex items-center gap-1.5 opacity-70" title={project.stack}>
                        <StackIcon
                          stack={project.stack}
                          class="h-3.5 w-3.5"
                        />
                        <span class="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{project.stack}</span>
                      </div>
                      <Show when={project.runtimeHint}>
                        <div class="flex items-center gap-1.5 border-l border-border/50 pl-2.5">
                           <StackIcon stack={project.runtimeHint!} class="size-3.5 opacity-80" />
                           <span class="text-[10px] font-medium text-muted-foreground/80">{project.runtimeHint}</span>
                        </div>
                      </Show>
                    </div>
                  </div>

                  <Show when={project.favorite}>
                    <span class="iconify mdi--star text-yellow-500 size-4 shrink-0" />
                  </Show>
                </div>

                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5" title="File count (filtered)">
                      <span class="iconify mdi--file-multiple-outline text-muted-foreground/60 size-3" />
                      <span class="text-[10px] font-mono font-medium text-muted-foreground">{project.fileCount}</span>
                    </div>
                    <Show when={formatRelativeTime(project.lastEditedAtMs)}>
                      <div class="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5" title="Last edited">
                        <span class="iconify mdi--pencil-outline text-muted-foreground/60 size-3" />
                        <span class="text-[10px] font-mono font-medium text-muted-foreground">{formatRelativeTime(project.lastEditedAtMs)}</span>
                      </div>
                    </Show>
                    <Show when={formatPlaytime(project.totalPlaytimeMs)}>
                      <div class="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5" title="Total Playtime">
                        <span class="iconify mdi--clock-outline text-muted-foreground/60 size-3" />
                        <span class="text-[10px] font-mono font-medium text-muted-foreground">{formatPlaytime(project.totalPlaytimeMs)}</span>
                      </div>
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
                    <Button
                      type="button"
                      size="icon"
                      variant={runningProjectsQ.data?.includes(project.id) ? "default" : "secondary"}
                      class={cn(
                        "size-8 shrink-0 rounded-lg transition-all hover:shadow-sm",
                        runningProjectsQ.data?.includes(project.id) 
                           ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/20" 
                           : "hover:bg-primary hover:text-primary-foreground"
                      )}
                      onClick={(e) => void onPlay(project, e)}
                      title={runningProjectsQ.data?.includes(project.id) ? "Stop IDE" : (t("library.playInIde") as string)}
                    >
                      <Show when={runningProjectsQ.data?.includes(project.id)} fallback={<span class="iconify mdi--play h-4.5 w-4.5" />}>
                        <span class="iconify mdi--stop h-4.5 w-4.5 animate-in zoom-in duration-300" />
                      </Show>
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

