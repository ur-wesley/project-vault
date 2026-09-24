import { Show, type Component } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { toast } from "solid-sonner";

import iconUrl from "../../icon.png";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "~/components/ui/sidebar";
import { SidebarHeaderSearch } from "~/components/SidebarHeaderSearch";
import { ProjectSidebarList } from "~/features/library";
import { PluginSidebarList } from "~/features/plugin-page/PluginSidebarList";
import { stopAllProjectProcesses } from "~/services/tauri/processes";
import { GitHubAuthMenu } from "./GitHubAuthMenu";
import type { useAppRouting } from "./useAppRouting";
import type { ProjectFilterOption, useSidebarData, TFunction } from "./useSidebarData";

type RoutingModel = ReturnType<typeof useAppRouting>;
type DataModel = ReturnType<typeof useSidebarData>;

/**
 * App shell sidebar: brand header, search, projects/plugins tabs,
 * processes entry, footer account/screenshot/settings.
 * (Extracted verbatim from App.)
 */
export const AppSidebar: Component<{
  t: TFunction;
  routing: RoutingModel;
  data: DataModel;
  librarySearch: Accessor<string>;
  setLibrarySearch: Setter<string>;
  libraryFilter: Accessor<string>;
  setLibraryFilter: Setter<string>;
  shortcutHint: string;
  onOpenCommandPalette: () => void;
  onOpenLocations: () => void;
  onOpenNewProject: () => void;
  onOpenSettingsTab: (tab: string) => void;
  onOpenScreenshotSelector: () => void;
}> = (props) => {
  const { t, routing, data } = props;
  const filterOptions: Accessor<ProjectFilterOption[]> = data.filterOptions;

  return (
    <Sidebar collapsible="offcanvas" variant="sidebar">
      <SidebarHeader class="gap-0 border-b-0 p-0">
        <div
          class="flex items-center gap-2 px-3 py-3 cursor-pointer border-b border-sidebar-border"
          onClick={() => {
            routing.setActiveView("library");
            routing.setProjectDetailId(null);
            routing.setSubDetail(null);
            routing.setPluginPagePluginId(null);
            routing.setPluginPageId(null);
          }}
        >
          <img src={iconUrl} alt="Project Vault" class="size-9 shrink-0 rounded object-contain" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-semibold tracking-wide text-sidebar-foreground">
              {t("app.title") as string}
            </span>
            <span class="truncate text-xs text-sidebar-foreground/60">
              {t("app.librarySubtitle") as string}
            </span>
          </div>
        </div>
        <SidebarHeaderSearch
          search={props.librarySearch}
          setSearch={props.setLibrarySearch}
          filter={props.libraryFilter}
          setFilter={props.setLibraryFilter}
          filterOptions={filterOptions}
          t={(k) => t(k) as string}
          shortcutHint={props.shortcutHint}
          onOpenCommandPalette={props.onOpenCommandPalette}
        />
      </SidebarHeader>
      <SidebarContent class="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        <Tabs
          value={routing.sidebarTab()}
          onChange={(v) => routing.setSidebarTab(v as "projects" | "plugins")}
          class="flex min-h-0 flex-1 flex-col"
        >
          <div class="shrink-0 px-2 pt-1">
            <TabsList class="grid h-8 w-full shrink-0 grid-cols-2 p-0.5 bg-sidebar-accent/40">
              <TabsTrigger
                value="projects"
                class="text-xs data-[selected]:bg-sidebar data-[selected]:text-sidebar-foreground"
              >
                {t("library.sidebarProjects") as string}
              </TabsTrigger>
              <TabsTrigger
                value="plugins"
                class="text-xs data-[selected]:bg-sidebar data-[selected]:text-sidebar-foreground"
              >
                {t("plugins.sidebarPages") as string}
                <Show when={data.runningProcessCount() > 0}>
                  <span class="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {data.runningProcessCount()}
                  </span>
                </Show>
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            forceMount
            value="projects"
            class="mt-1 hidden min-h-0 flex-1 flex-col overflow-hidden data-[selected]:flex"
          >
            <ProjectSidebarList
              selectedProjectId={routing.projectDetailId}
              onSelectProject={(id) => {
                routing.openProject(id);
              }}
              onPlayError={(msg) => {
                toast.error(msg);
              }}
              onOpenLocations={props.onOpenLocations}
              onOpenNewProject={props.onOpenNewProject}
            />
          </TabsContent>
          <TabsContent
            forceMount
            value="plugins"
            class="mt-1 hidden min-h-0 flex-1 flex-col overflow-hidden data-[selected]:flex"
          >
            <div class="min-h-0 flex-1 overflow-y-auto">
              <PluginSidebarList
                activePluginId={routing.pluginPagePluginId()}
                activePageId={routing.pluginPageId()}
                isViewActive={routing.activeView() === "plugin"}
                pinRevision={routing.pluginPinRevision()}
                onOpenPage={(pluginId: string, pageId: string, command?: string) =>
                  routing.openPluginPage(pluginId, pageId, command)
                }
                onPinChange={() => routing.setPluginPinRevision((n) => n + 1)}
                onManagePlugins={() => {
                  routing.setActiveView("settings");
                  routing.setSettingsTab("plugins");
                }}
              />
            </div>
            <SidebarGroup class="shrink-0 px-2 pt-0 pb-1">
              <ContextMenu>
                <ContextMenuTrigger as="div" class="contents">
                  <Button
                    variant="ghost"
                    size="sm"
                    class={
                      "h-7 w-full justify-start gap-2 px-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground " +
                      (routing.activeView() === "processes"
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "")
                    }
                    onClick={() => routing.setActiveView("processes")}
                  >
                    <span class="iconify mdi--application-cog-outline size-6 opacity-70" />
                    <span class="text-xs">{t("processes.title") as string}</span>
                    <Show when={data.runningProcessCount() > 0}>
                      <span class="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                        {data.runningProcessCount()}
                      </span>
                    </Show>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      const running = (data.processesQ.data ?? []).filter(
                        (p) => p.state === "running" || p.state === "starting",
                      );
                      const projectIds = new Set(running.map((p) => p.projectId));
                      for (const pid of projectIds) {
                        void stopAllProjectProcesses(pid);
                      }
                    }}
                  >
                    <span class="iconify mdi--close-circle-outline size-4" />
                    <span>Close everything</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </SidebarGroup>
          </TabsContent>
        </Tabs>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-2 py-1.5">
        <div class="flex items-center gap-1">
          <GitHubAuthMenu
            t={t}
            ghViewerQ={data.ghViewerQ}
            onOpenSettingsTab={props.onOpenSettingsTab}
          />

          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={props.onOpenScreenshotSelector}
            >
              <span class="iconify mdi--camera size-4" />
            </TooltipTrigger>
            <TooltipContent>{t("screenshot.tooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={() => {
                routing.setActiveView("settings");
                routing.setSettingsTab("general");
              }}
            >
              <span class="iconify mdi--cog-outline size-4" />
            </TooltipTrigger>
            <TooltipContent>{t("settings.title") as string}</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};
