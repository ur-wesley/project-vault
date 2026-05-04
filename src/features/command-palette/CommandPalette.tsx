import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type ParentProps } from "solid-js";

import { StackIcon } from "~/components/StackIcon";
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
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { listProjects } from "~/services/tauri";
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
}>;

export function CommandPalette(props: CommandPaletteProps) {
  const { t } = useI18n();
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

  const q = createQuery(() => ({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const r = await listProjects();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

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

  return (
    <>
      {props.children}
      <CommandDialog open={open()} onOpenChange={setOpen}>
        <CommandInput placeholder={t("commandPalette.placeholder") as string} />
        <CommandList>
          <Show when={q.isPending}>
            <CommandEmpty>{t("commandPalette.loading") as string}</CommandEmpty>
          </Show>
          <Show when={q.isError}>
            <CommandEmpty>{t("commandPalette.error") as string}</CommandEmpty>
          </Show>
          <Show when={q.isSuccess}>
            <CommandEmpty>{t("commandPalette.noResults") as string}</CommandEmpty>
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
            <Show when={recent().length > 0}>
              <CommandSeparator />
              <CommandGroup heading={t("commandPalette.recent") as string}>
                <For each={recent()}>
                  {(project) => (
                    <CommandItem
                      value={`project-${project.id}`}
                      keywords={[project.name, project.path, project.stack]}
                      onSelect={() => selectProject(project)}
                    >
                      {project.name}
                      <Tooltip>
                        <TooltipTrigger
                          as={CommandShortcut}
                          class="flex max-w-[40%] items-center justify-end font-normal"
                        >
                          <StackIcon
                            stack={project.stack}
                            class="h-3.5 w-3.5"
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
                    keywords={[project.name, project.path, project.stack]}
                    onSelect={() => selectProject(project)}
                  >
                    {project.name}
                    <Tooltip>
                      <TooltipTrigger
                        as={CommandShortcut}
                        class="flex max-w-[40%] items-center justify-end font-normal"
                      >
                        <StackIcon stack={project.stack} class="h-3.5 w-3.5" />
                        <span class="sr-only">{project.stack}</span>
                      </TooltipTrigger>
                      <TooltipContent>{project.stack}</TooltipContent>
                    </Tooltip>
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
          </Show>
        </CommandList>
      </CommandDialog>
    </>
  );
}
