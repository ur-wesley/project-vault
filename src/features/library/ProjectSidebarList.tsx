import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { openPath } from "@tauri-apps/plugin-opener";
import { For, Show, createMemo, type Accessor } from "solid-js";

import { StackIcon } from "~/components/StackIcon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { deleteProject, listProjects, setProjectFavorite } from "~/services/tauri/projects";
import { getSetting } from "~/services/tauri/settings";
import { listAllProcesses } from "~/services/tauri/sessions";
import { listDiscoveredIdes, openProjectInIde } from "~/services/tauri/ide";
import { openProjectShell } from "~/services/tauri/terminal";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { projectIdeStorageKey } from "../project-detail/lib/ide-storage";
import { toast } from "solid-sonner";


export function ProjectSidebarList(props: {
  selectedProjectId: Accessor<string | null>;
  onSelectProject: (id: string) => void;
  onOpenLocations: () => void;
  onOpenNewProject?: () => void;
  onPlayError: (message: string) => void;
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

  const defaultIdeQ = createQuery(() => ({
    queryKey: ["settings", "default_ide_path"] as const,
    queryFn: async () => {
      const r = await getSetting("default_ide_path");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const processesQ = createQuery(() => ({
    queryKey: ["processes", "all"] as const,
    queryFn: async () => {
      const r = await listAllProcesses();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 3000,
  }));

  const runningProjectIds = createMemo(() => {
    const procs = processesQ.data ?? [];
    const ids = new Set<string>();
    for (const p of procs) {
      if (p.state === "running" || p.state === "starting") {
        ids.add(p.projectId);
      }
    }
    return ids;
  });

  const openInIde = async (project: ProjectDto) => {
    const ides = idesQ.data;
    if (!ides || ides.length === 0) {
      props.onPlayError(t("library.noIdeFound") as string);
      return;
    }
    const stored = localStorage.getItem(projectIdeStorageKey(project.id));
    const globalDefault = defaultIdeQ.data;
    const executable =
      (stored && ides.some((i) => i.executable === stored) ? stored : null) ||
      (globalDefault && ides.some((i) => i.executable === globalDefault) ? globalDefault : null) ||
      ides[0]!.executable;
    const r = await openProjectInIde({ projectId: project.id, executable });
    if (r.isErr()) {
      props.onPlayError(stableErrorMessage(t, r.error as StableError));
      return;
    }
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const onPlay = async (project: ProjectDto, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await openInIde(project);
  };

  const toggleFavorite = async (project: ProjectDto) => {
    const r = await setProjectFavorite({ id: project.id, favorite: !project.favorite });
    if (r.isErr()) {
      props.onPlayError(stableErrorMessage(t, r.error as StableError));
      return;
    }
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const sortedProjects = createMemo(() => {
    const projects = q.data ?? [];
    return [...projects].sort((a, b) => {
      if (a.favorite === b.favorite) return 0;
      return a.favorite ? -1 : 1;
    });
  });

  const handleDelete = async (project: ProjectDto) => {
    if (!window.confirm(t("projectDetail.deleteProjectTitle") as string)) return;
    const deleteFromDisk = window.confirm(t("projectDetail.deleteFromDiskConfirm") as string);
    const r = await deleteProject(project.id, deleteFromDisk);
    if (r.isErr()) {
      props.onPlayError(stableErrorMessage(t, r.error as StableError));
      return;
    }
    // Optimistically remove from sidebar cache
    qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => {
      if (!old) return old;
      return old.filter((p) => p.id !== project.id);
    });
    toast.success(t("projectDetail.projectDeleted") as string);
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const openInExplorer = async (path: string) => {
    try {
      await openPath(path);
    } catch (e) {
      props.onPlayError(`${t("library.openInFileManagerFailed") as string} ${String(e)}`);
    }
  };

  return (
    <SidebarGroup class="flex min-h-0 min-w-0 flex-1 flex-col pl-2 pr-0 pt-0 pb-0">
      <div class="flex items-center justify-between px-2 py-1.5 shrink-0">
        <SidebarGroupLabel class="text-[10px] uppercase font-bold tracking-wider opacity-50">
          {t("library.sidebarProjects") as string}
          <Show when={q.isSuccess}>
            <span class="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-accent px-1 text-[9px] font-bold text-sidebar-accent-foreground">
              {q.data?.length ?? 0}
            </span>
          </Show>
        </SidebarGroupLabel>
          <Show when={props.onOpenNewProject}>
            <Tooltip>
              <TooltipTrigger
                as="button"
                type="button"
                onClick={() => props.onOpenNewProject?.()}
                class="flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <span class="iconify mdi--plus text-sm" />
              </TooltipTrigger>
              <TooltipContent>{t("commandPalette.newProject") as string}</TooltipContent>
            </Tooltip>
          </Show>
      </div>
      <SidebarGroupContent class="min-h-0 min-w-0 flex-1 overflow-hidden">
        <SidebarMenu class="h-full overflow-y-auto group-data-[collapsible=icon]:pr-0 pb-2">
          <Show when={q.isPending}>
            <p class="px-2 text-xs text-sidebar-foreground/60">
              {t("library.loading") as string}
            </p>
          </Show>
          <Show when={q.isError}>
            <p class="px-2 text-xs text-destructive">{t("library.error") as string}</p>
          </Show>
          <Show when={q.isSuccess && (q.data?.length ?? 0) === 0}>
            <p class="px-2 text-xs text-sidebar-foreground/60">{t("library.empty") as string}</p>
          </Show>
          <For each={sortedProjects()}>
            {(project) => (
              <SidebarMenuItem class="group/menu-item relative">
                <ContextMenu>
                  <ContextMenuTrigger as="div" class="contents">
                    <SidebarMenuButton
                      size="sm"
                      isActive={props.selectedProjectId() === project.id}
                      onClick={() => props.onSelectProject(project.id)}
                      class="h-auto pr-8"
                    >
                      <div class="flex w-full min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
                        <span class="relative flex shrink-0 items-center justify-center self-center text-sidebar-foreground/70">
                          <StackIcon
                            stack={project.stack}
                            class="size-6 shrink-0"
                            noTooltip
                          />
                          <Show when={project.favorite}>
                            <span class="iconify mdi--star absolute -top-1 -right-1 text-[9px] text-yellow-500" />
                          </Show>
                          <Show when={runningProjectIds().has(project.id)}>
                            <span class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-sidebar" />
                          </Show>
                        </span>
                        <div class="min-w-0 flex-1 flex flex-col items-start gap-0 text-left group-data-[collapsible=icon]:hidden">
                          <div class="flex w-full items-center gap-1 min-w-0">
                            <span class="truncate text-[13px] font-semibold leading-tight">
                              {project.name}
                            </span>
                          </div>
                          <span class="w-full truncate text-[9px] leading-tight text-sidebar-foreground/45">
                            {project.path}
                          </span>
                        </div>
                      </div>
                    </SidebarMenuButton>
                    <Show when={idesQ.data && idesQ.data.length > 0}>
                      <SidebarMenuAction
                        type="button"
                        class="!top-1/2 h-5 w-5 -translate-y-1/2"
                        showOnHover
                        onClick={(e) => void onPlay(project, e)}
                        aria-label={t("library.playInIde") as string}
                      >
                        <span class="iconify mdi--play text-sm" aria-hidden="true" />
                      </SidebarMenuAction>
                    </Show>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => void openInIde(project)}>
                      <span class="iconify mdi--play size-4" />
                      <span>{t("library.openInIde") as string}</span>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void openProjectShell(project.id)}>
                      <span class="iconify mdi--console size-4" />
                      <span>{t("library.shell") as string}</span>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void openInExplorer(project.path)}>
                      <span class="iconify mdi--folder-open size-4" />
                      <span>{t("projectDetail.openInSystemExplorer") as string}</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => void toggleFavorite(project)}>
                      <span class={project.favorite ? "iconify mdi--star size-4 text-yellow-500" : "iconify mdi--star-outline size-4"} />
                      <span>{project.favorite ? t("projectDetail.favRemove") : t("projectDetail.favMark") as string}</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => void handleDelete(project)}
                      class="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <span class="iconify mdi--trash-can-outline size-4" />
                      <span>{t("projectDetail.deleteProject") as string}</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            )}
          </For>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
