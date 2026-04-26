import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, type Accessor, createMemo } from "solid-js";

import { StackIcon } from "~/components/StackIcon";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxControl,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  getSetting,
  listDiscoveredIdes,
  listLocations,
  listProjects,
  openProjectInIde,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { fetchGitHubViewer } from "~/services/github";
import type { ProjectDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { projectIdeStorageKey } from "../project-detail/lib/ide-storage";
import { buildStacksList, filterProjectList } from "./filter-projects";

type ProjectFilterOption = { value: string; label: string; textValue: string };

export function ProjectSidebarList(props: {
  search: Accessor<string>;
  filter: Accessor<string>;
  onFilterChange: (v: string) => void;
  selectedProjectId: Accessor<string | null>;
  onSelectProject: (id: string) => void;
  onOpenLocations: () => void;
  onPlayError: (message: string) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const locQ = createQuery(() => ({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      const r = await listLocations();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

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

  const ghViewerQ = createQuery(() => ({
    queryKey: queryKeys.githubViewer(),
    queryFn: async () => {
      const r = await fetchGitHubViewer();
      if (r.isErr()) return null;
      return r.value;
    },
    staleTime: 1000 * 60 * 15,
  }));

  const stacks = createMemo(() => buildStacksList(q.data ?? []));

  const filterOptions = createMemo((): ProjectFilterOption[] => {
    const out: ProjectFilterOption[] = [
      {
        value: "all",
        label: t("library.filterAll") as string,
        textValue: `all ${t("library.filterAll")}`,
      },
      {
        value: "favorites",
        label: t("library.filterFavorites") as string,
        textValue: `favorites ${t("library.filterFavorites")}`,
      },
      {
        value: "recent",
        label: t("library.filterRecent") as string,
        textValue: `recent ${t("library.filterRecent")}`,
      },
      {
        value: "git",
        label: "Git projects",
        textValue: "git projects",
      },
      {
        value: "github",
        label: "GitHub remotes",
        textValue: "github remotes",
      },
    ];

    if (ghViewerQ.data) {
      out.push({
        value: "own",
        label: "My repositories",
        textValue: "own my repositories github",
      });
    }
    const locs = t("library.filterLocations") as string;
    for (const loc of locQ.data ?? []) {
      out.push({
        value: `loc:${loc.id}`,
        label: loc.name,
        textValue: `${loc.name} ${locs}`,
      });
    }
    const rts = t("library.filterRuntime") as string;
    for (const st of stacks()) {
      out.push({
        value: `stack:${st}`,
        label: st,
        textValue: `${st} ${rts}`,
      });
    }
    return out;
  });

  const selectedFilterOption = createMemo(() => {
    const v = props.filter();
    return filterOptions().find((o) => o.value === v) ?? filterOptions()[0];
  });

  const filtered = createMemo(() =>
    filterProjectList(q.data ?? [], props.filter(), props.search(), ghViewerQ.data?.login),
  );

  const onPlay = async (project: ProjectDto, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
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

  return (
    <>
      <SidebarGroup class="shrink-0 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel class="text-xs">{t("library.filterLabel") as string}</SidebarGroupLabel>
        <SidebarGroupContent>
          <div class="px-2">
            <Combobox<ProjectFilterOption>
              options={filterOptions()}
              optionValue="value"
              optionTextValue="textValue"
              optionLabel="label"
              value={selectedFilterOption()}
              onChange={(opt) => {
                if (opt) props.onFilterChange(opt.value);
              }}
              disallowEmptySelection
              defaultFilter="contains"
              itemComponent={(p) => {
                const opt = p.item.rawValue;
                const st = opt.value.startsWith("stack:") ? opt.value.slice(6) : null;
                return (
                  <ComboboxItem item={p.item}>
                    <span class="flex min-w-0 items-center gap-2">
                      <Show when={st != null}>
                        <StackIcon stack={st!} class="h-3.5 w-3.5" title={opt.label} />
                      </Show>
                      <span class="truncate">{opt.label}</span>
                    </span>
                  </ComboboxItem>
                );
              }}
            >
              <ComboboxControl class="h-8 border-sidebar-border bg-sidebar-accent/20 text-sidebar-foreground">
                <ComboboxInput
                  class="text-xs"
                  placeholder={t("library.filterLabel") as string}
                  autocomplete="off"
                />
                <ComboboxTrigger aria-label={t("library.filterLabel") as string} />
              </ComboboxControl>
              <ComboboxContent />
            </Combobox>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup class="flex min-h-0 min-w-0 flex-1 flex-col">
        <SidebarGroupLabel class="shrink-0 text-xs">
          {t("library.sidebarProjects") as string}
        </SidebarGroupLabel>
        <SidebarGroupContent class="min-h-0 min-w-0 flex-1 overflow-hidden">
          <SidebarMenu class="h-full overflow-y-auto group-data-[collapsible=icon]:pr-0 pr-1">
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
            <For each={filtered()}>
              {(project) => (
                <SidebarMenuItem class="group/menu-item relative">
                  <SidebarMenuButton
                    size="sm"
                    isActive={props.selectedProjectId() === project.id}
                    onClick={() => props.onSelectProject(project.id)}
                    class="h-auto min-h-8 pr-8"
                    tooltip={project.name}
                  >
                    <div class="flex w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:justify-center">
                      <span
                        class="flex shrink-0 items-center justify-center self-center text-sidebar-foreground/70"
                        title={project.stack}
                      >
                        <StackIcon
                          stack={project.stack}
                          class="h-3.5 w-3.5 shrink-0"
                          title={project.stack}
                        />
                        <span class="sr-only">{project.stack}</span>
                      </span>
                      <div class="min-w-0 flex-1 flex flex-col items-start gap-0.5 text-left group-data-[collapsible=icon]:hidden">
                        <div class="flex w-full items-center gap-1.5 min-w-0">
                          <span class="truncate text-xs font-medium leading-tight">
                            {project.name}
                          </span>
                          <Show when={project.favorite}>
                            <span class="iconify mdi--star shrink-0 text-[10px] text-yellow-500/80" />
                          </Show>
                        </div>
                        <span
                          class="w-full truncate text-[10px] leading-tight text-sidebar-foreground/55"
                          title={project.path}
                        >
                          {project.path}
                        </span>
                      </div>
                    </div>
                  </SidebarMenuButton>
                  <Show when={idesQ.data && idesQ.data.length > 0}>
                    <SidebarMenuAction
                      type="button"
                      class="!top-1/2 h-6 w-6 -translate-y-1/2"
                      showOnHover
                      onClick={(e) => void onPlay(project, e)}
                      aria-label={t("library.playInIde") as string}
                    >
                      <span class="iconify mdi--play text-base" aria-hidden="true" />
                    </SidebarMenuAction>
                  </Show>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
