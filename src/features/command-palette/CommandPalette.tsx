import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type ParentProps } from "solid-js";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { StackIcon } from "~/components/StackIcon";
import { ProjectAvatar } from "~/components/ProjectAvatar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "~/components/ui/command";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";
import { fuzzyScore } from "~/lib/fuzzy-score";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { listProjects } from "~/services/tauri/projects";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto } from "~/types/dto";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

export type CommandPaletteProps = ParentProps<{
  onOpenLocations: () => void;
  onOpenSettings?: () => void;
  onOpenNewProject?: () => void;
  onSelectProject?: (project: ProjectDto) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  activeProjectId?: string | null;
}>;

export function CommandPalette(props: CommandPaletteProps) {
  const { t, locale } = useI18n();
  const hub = useEventHub();
  const qc = useQueryClient();
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => props.open ?? internalOpen();
  const setOpen = (v: boolean) => {
    props.onOpenChange?.(v);
    setInternalOpen(v);
  };

  createEffect(() => {
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "command-palette:open") {
        setOpen(true);
      }
    });
    onCleanup(() => listener());
  });

  createEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("plugin:reload", () => {
      void qc.invalidateQueries({ queryKey: ["plugin", "commands"] });
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  const q = createQuery(() => ({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const r = await listProjects();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const pluginCmdsQ = createQuery(() => ({
    queryKey: ["plugin", "commands"] as const,
    queryFn: async () => {
      if (!isTauri()) return [];
      try {
        const list = await invoke<any[]>("list_plugin_commands");
        return list;
      } catch (e) {
        console.error("Failed to load plugin commands", e);
        return [];
      }
    },
    enabled: open(),
  }));

  const executePluginCommand = async (pluginId: string, commandId: string) => {
    setOpen(false);
    try {
      const context = {
        projectId: props.activeProjectId ?? null,
      };
      await invoke("execute_plugin_command", { pluginId, commandId, context });
    } catch (e) {
      console.error("Failed to execute plugin command", e);
    }
  };

  const getCommandTitle = (cmd: any) => {
    const activeLocale = locale();
    const localMap = cmd.locales?.[activeLocale] || cmd.locales?.["en"];
    return localMap?.[`command.${cmd.id}`] || cmd.title;
  };

  const recent = createMemo(() => {
    const list = q.data ?? [];
    return [...list]
      .filter((p) => p.lastOpenedAtMs != null)
      .sort((a, b) => (b.lastOpenedAtMs ?? 0) - (a.lastOpenedAtMs ?? 0))
      .slice(0, 5);
  });

  const recentIds = createMemo(() => new Set(recent().map((p) => p.id)));

  const otherProjects = createMemo(() => (q.data ?? []).filter((p) => !recentIds().has(p.id)));

  const selectProject = (p: ProjectDto) => {
    setOpen(false);
    props.onSelectProject?.(p);
  };

  const openLocations = () => {
    setOpen(false);
    props.onOpenLocations();
  };

  const openSettings = () => {
    setOpen(false);
    props.onOpenSettings?.();
  };

  const rescanAll = async () => {
    setOpen(false);
    const upserted = await rescanAllLibraryFolders();
    hub.emit("scan:complete", { projectCount: upserted });
    void qc.invalidateQueries({ queryKey: queryKeys.locations });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const openNewProject = () => {
    setOpen(false);
    props.onOpenNewProject?.();
  };

  const [search, setSearch] = createSignal("");

  const allProjects = createMemo(() => q.data ?? []);

  const scoredResults = createMemo(() => {
    const s = search().trim().toLowerCase();
    if (!s) return [];

    type ResultItem = {
      id: string;
      label: string;
      detail: string;
      icon: string;
      score: number;
      onSelect: () => void;
    };

    const items: ResultItem[] = [];

    // Actions
    items.push({
      id: "action-open-locations",
      label: t("commandPalette.openLocations") as string,
      detail: t("commandPalette.locationsHint") as string,
      icon: "mdi--folder-open",
      score: fuzzyScore(s, t("commandPalette.openLocations") as string),
      onSelect: openLocations,
    });
    items.push({
      id: "action-rescan-all",
      label: t("commandPalette.rescanAll") as string,
      detail: "",
      icon: "mdi--refresh",
      score: fuzzyScore(s, t("commandPalette.rescanAll") as string),
      onSelect: () => void rescanAll(),
    });
    if (props.onOpenNewProject) {
      items.push({
        id: "action-new-project",
        label: t("commandPalette.newProject") as string,
        detail: "",
        icon: "mdi--plus",
        score: fuzzyScore(s, t("commandPalette.newProject") as string),
        onSelect: openNewProject,
      });
    }
    if (props.onOpenSettings) {
      items.push({
        id: "action-settings",
        label: t("commandPalette.settings") as string,
        detail: "",
        icon: "mdi--cog",
        score: fuzzyScore(s, t("commandPalette.settings") as string),
        onSelect: openSettings,
      });
    }

    // Plugin Commands
    for (const cmd of pluginCmdsQ.data ?? []) {
      const isProjectScope = cmd.scope === "project";
      if (isProjectScope && !props.activeProjectId) {
        continue;
      }
      const title = getCommandTitle(cmd);
      const score = fuzzyScore(s, title);
      if (score > 0) {
        items.push({
          id: `plugin-cmd-${cmd.pluginId}-${cmd.id}`,
          label: title,
          detail: `Plugin: ${cmd.pluginId}`,
          icon: "mdi--toy-brick-outline",
          score,
          onSelect: () => void executePluginCommand(cmd.pluginId, cmd.id),
        });
      }
    }

    // Projects
    for (const p of allProjects()) {
      const score = Math.max(
        fuzzyScore(s, p.name),
        fuzzyScore(s, p.path),
        fuzzyScore(s, p.stack),
      );
      if (score > 0) {
        items.push({
          id: `project-${p.id}`,
          label: p.name,
          detail: p.path,
          icon: "",
          score,
          onSelect: () => selectProject(p),
        });
      }
    }

    return items.sort((a, b) => b.score - a.score).slice(0, 20);
  });

  const isSearching = createMemo(() => search().trim().length > 0);

  return (
    <>
      {props.children}
      <CommandDialog
        open={open()}
        onOpenChange={setOpen}
        filter={() => 1}
      >
        <CommandInput
          placeholder={t("commandPalette.placeholder") as string}
          onValueChange={setSearch}
        />
        <CommandList>
          <Show when={q.isPending}>
            <CommandEmpty>{t("commandPalette.loading") as string}</CommandEmpty>
          </Show>
          <Show when={q.isError}>
            <CommandEmpty>{t("commandPalette.error") as string}</CommandEmpty>
          </Show>
          <Show when={q.isSuccess}>
            <Show when={isSearching()}>
              <CommandEmpty>{t("commandPalette.noResults") as string}</CommandEmpty>
              <CommandGroup heading={t("commandPalette.results") as string}>
                <For each={scoredResults()}>
                  {(item) => (
                    <CommandItem value={item.id} onSelect={item.onSelect}>
                      <span class="flex min-w-0 flex-1 items-center gap-2">
                        <Show when={item.icon}>
                          <span class={cn("iconify shrink-0 size-4", item.icon)} />
                        </Show>
                        <Show when={!item.icon}>
                          <StackIcon stack={item.detail || "folder"} class="h-3.5 w-3.5 shrink-0" />
                        </Show>
                        <span class="min-w-0 truncate">{item.label}</span>
                      </span>
                      <Show when={item.detail && !item.id.startsWith("action-")}>
                        <CommandShortcut class="max-w-[50%] truncate">
                          {item.detail}
                        </CommandShortcut>
                      </Show>
                      <Show when={item.id.startsWith("action-") && item.detail}>
                        <CommandShortcut>{item.detail}</CommandShortcut>
                      </Show>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
            <Show when={!isSearching()}>
              <CommandGroup heading={t("commandPalette.actions") as string}>
                <CommandItem value="action-open-locations" onSelect={openLocations}>
                  {t("commandPalette.openLocations") as string}
                  <CommandShortcut>{t("commandPalette.locationsHint") as string}</CommandShortcut>
                </CommandItem>
                <CommandItem value="action-rescan-all" onSelect={() => void rescanAll()}>
                  {t("commandPalette.rescanAll") as string}
                </CommandItem>
                <CommandItem
                  value="action-new-project"
                  disabled={props.onOpenNewProject == null}
                  onSelect={() => openNewProject()}
                >
                  {t("commandPalette.newProject") as string}
                </CommandItem>
                <CommandItem
                  value="action-settings"
                  disabled={props.onOpenSettings == null}
                  onSelect={() => openSettings()}
                >
                  {t("commandPalette.settings") as string}
                </CommandItem>
              </CommandGroup>
              <Show when={(pluginCmdsQ.data ?? []).length > 0}>
                <CommandSeparator />
                <CommandGroup heading={t("commandPalette.pluginCommands") as string ?? "Plugin Commands"}>
                  <For each={pluginCmdsQ.data ?? []}>
                    {(cmd) => {
                      const isProjectScope = cmd.scope === "project";
                      if (isProjectScope && !props.activeProjectId) {
                        return null;
                      }
                      const title = getCommandTitle(cmd);
                      return (
                        <CommandItem
                          value={`plugin-cmd-${cmd.pluginId}-${cmd.id}`}
                          onSelect={() => void executePluginCommand(cmd.pluginId, cmd.id)}
                        >
                          <span class="flex min-w-0 flex-1 items-center gap-2">
                            <span class="iconify shrink-0 size-4 mdi--toy-brick-outline" />
                            <span class="min-w-0 truncate">{title}</span>
                          </span>
                          <CommandShortcut>{cmd.pluginId}</CommandShortcut>
                        </CommandItem>
                      );
                    }}
                  </For>
                </CommandGroup>
              </Show>
              <Show when={recent().length > 0}>
                <CommandSeparator />
                <CommandGroup heading={t("commandPalette.recent") as string}>
                  <For each={recent()}>
                    {(project) => (
                      <CommandItem
                        value={`project-${project.id}`}
                        onSelect={() => selectProject(project)}
                      >
                        {project.name}
                        <Tooltip>
                          <TooltipTrigger
                            as={CommandShortcut}
                            class="flex max-w-[40%] items-center justify-end font-normal"
                          >
                            <ProjectAvatar
                              project={project}
                              class="h-3.5 w-3.5"
                              noTooltip
                            />
                            <span class="sr-only">{project.stack}</span>
                          </TooltipTrigger>
                          <TooltipContent>{project.stack}</TooltipContent>
                        </Tooltip>
                      </CommandItem>
                    )}
                  </For>
                </CommandGroup>
              </Show>
              <CommandSeparator />
              <CommandGroup heading={t("commandPalette.allProjects") as string}>
                <For each={otherProjects()}>
                  {(project) => (
                    <CommandItem
                      value={`project-${project.id}`}
                      onSelect={() => selectProject(project)}
                    >
                      {project.name}
                      <Tooltip>
                        <TooltipTrigger
                          as={CommandShortcut}
                          class="flex max-w-[40%] items-center justify-end font-normal"
                        >
                          <ProjectAvatar project={project} class="h-3.5 w-3.5" noTooltip />
                          <span class="sr-only">{project.stack}</span>
                        </TooltipTrigger>
                        <TooltipContent>{project.stack}</TooltipContent>
                      </Tooltip>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
          </Show>
        </CommandList>
      </CommandDialog>
    </>
  );
}
