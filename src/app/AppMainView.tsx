import { Show, type Component } from "solid-js";
import type { Accessor, Setter } from "solid-js";

import { LibraryView } from "~/features/library";
import { ProjectDetailView } from "~/features/project-detail";
import { ProcessesView } from "~/features/processes";
import { SettingsView } from "~/features/settings";
import { PluginPageView } from "~/features/plugin-page/PluginPageView";
import { StatusBar } from "~/components/StatusBar";
import type { ProjectDetailTab } from "~/lib/app-url";
import type { useAppRouting } from "./useAppRouting";
import type { SetLocaleFn } from "./useSidebarData";

type RoutingModel = ReturnType<typeof useAppRouting>;

/**
 * App main column: routed views (settings/library/project/processes/plugin)
 * + status bar. (Extracted verbatim from App.)
 */
export const AppMainView: Component<{
  routing: RoutingModel;
  librarySearch: Accessor<string>;
  setLibrarySearch: Setter<string>;
  libraryFilter: Accessor<string>;
  setLibraryFilter: Setter<string>;
  projectName: string | undefined;
  projectId: string | null;
  updateVersion: string | undefined;
  setLocale: SetLocaleFn;
  onShowProcesses: () => void;
  onToggleTerminal: () => void;
  onOpenUpdatePopup: () => void;
}> = (props) => {
  const { routing } = props;

  return (
    <>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Show when={routing.activeView() === "settings"}>
          <SettingsView
            activeTab={routing.settingsTab()}
            onTabChange={routing.setSettingsTab}
            onLocaleChange={props.setLocale}
            onBack={() => {
              routing.setActiveView(routing.projectDetailId() ? "project" : "library");
              routing.setSubDetail(null);
            }}
          />
        </Show>
        <Show when={routing.activeView() === "library"}>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <LibraryView
              search={props.librarySearch}
              onSearchChange={props.setLibrarySearch}
              filter={props.libraryFilter}
              onFilterChange={props.setLibraryFilter}
              selectedProjectId={routing.projectDetailId}
              onOpenProject={(id) => {
                routing.openProject(id);
              }}
              onOpenProjectTab={(id, tab) => {
                routing.openProject(id, tab as ProjectDetailTab);
              }}
            />
          </div>
        </Show>

        <Show when={routing.activeView() === "project" && routing.projectDetailId()}>
          <ProjectDetailView
            projectId={routing.projectDetailId()!}
            detailTab={routing.detailTab}
            onDetailTabChange={routing.setDetailTab}
            subDetail={routing.subDetail}
            onSubDetailChange={routing.setSubDetail}
            onBack={() => {
              routing.setActiveView("library");
              routing.setProjectDetailId(null);
            }}
          />
        </Show>

        <Show when={routing.activeView() === "processes"}>
          <ProcessesView
            onOpenProject={(id) => {
              routing.openProject(id);
            }}
          />
        </Show>

        <Show
          when={
            routing.activeView() === "plugin" &&
            routing.pluginPagePluginId() &&
            routing.pluginPageId()
          }
        >
          <PluginPageView
            pluginId={routing.pluginPagePluginId()!}
            pageId={routing.pluginPageId()!}
            meta={routing.activePluginPageMeta()}
            pinRevision={routing.pluginPinRevision()}
            onPinChange={() => routing.setPluginPinRevision((n) => n + 1)}
          />
        </Show>
      </div>

      <StatusBar
        activeView={routing.activeView()}
        projectName={props.projectName}
        projectId={props.projectId}
        onShowProcesses={props.onShowProcesses}
        onToggleTerminal={props.onToggleTerminal}
        updateVersion={props.updateVersion}
        onOpenUpdatePopup={props.onOpenUpdatePopup}
      />
    </>
  );
};
