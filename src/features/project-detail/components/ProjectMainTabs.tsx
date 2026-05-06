import {
  Show,
  createSignal,
  createEffect,
  createMemo,
  type Component,
} from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useI18n } from "~/lib/i18n-context";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { EmbeddedTerminalPane } from "../EmbeddedTerminal";
import { FileTree } from "../FileTree";
import { GithubProjectPanel } from "../GithubProjectPanel";
import { TasksTabPanel } from "./TasksTabPanel";
import { HistoryTabPanel } from "./HistoryTabPanel";
import type { ProjectDto } from "~/types/dto";

type ProjectMainTabsProps = Readonly<{
  model: ProjectDetailModel;
  project: () => ProjectDto;
}>;

export const ProjectMainTabs: Component<ProjectMainTabsProps> = (props) => {
  const { t } = useI18n();
  const sidebar = useSidebar();
  const m = () => props.model;

  const activeCount = createMemo(() => m().activeSessionsQ.data?.length ?? 0);
  const [terminalFullscreen, setTerminalFullscreen] = createSignal(false);
  const [previousSidebarOpen, setPreviousSidebarOpen] = createSignal<
    boolean | null
  >(null);

  createEffect(() => {
    if (terminalFullscreen() && m().activeDetailTab() !== "terminal") {
      m().props.onDetailTabChange("terminal");
    }
  });

  createEffect(() => {
    if (terminalFullscreen()) {
      setPreviousSidebarOpen(sidebar.open());
      sidebar.setOpen(false);
    } else if (previousSidebarOpen() != null) {
      sidebar.setOpen(previousSidebarOpen()!);
      setPreviousSidebarOpen(null);
    }
  });

  const githubInfo = createMemo(() => {
    const p = props.project();
    if (p.githubOwner && p.githubRepo) {
      return { owner: p.githubOwner, repo: p.githubRepo };
    }
    return null;
  });

  return (
    <Tabs
      value={m().activeDetailTab()}
      onChange={(v) => m().props.onDetailTabChange(v)}
      class="flex h-full min-h-0 flex-col"
    >
      <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col min-h-0 px-4">
        <Show when={!terminalFullscreen()}>
          <TabsList class="h-9 w-full shrink-0 justify-start bg-muted/60 flex p-1">
            <TabsTrigger value="readme" class="flex-1 text-xs font-semibold">
              {t("projectDetail.tabReadme") as string}
            </TabsTrigger>
            <TabsTrigger value="issues" class="flex-1 text-xs font-semibold">
              {t("projectDetail.tabIssues") as string}
            </TabsTrigger>
            <TabsTrigger value="files" class="flex-1 text-xs font-semibold">
              {t("projectDetail.tabFiles") as string}
            </TabsTrigger>
            <TabsTrigger
              value="tasks"
              class="flex-1 text-xs font-semibold gap-2"
            >
              {t("projectDetail.tabTasks") as string}
              <Show when={activeCount() > 0}>
                <Badge
                  variant="default"
                  round
                  class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm"
                >
                  {activeCount()}
                </Badge>
              </Show>
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              class="flex-1 text-xs font-semibold gap-2"
            >
              {t("projectDetail.tabTerminal") as string}
              <Show when={m().terminalInstances().length > 0}>
                <Badge
                  variant="default"
                  round
                  class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm"
                >
                  {m().terminalInstances().length}
                </Badge>
              </Show>
            </TabsTrigger>
            <TabsTrigger value="history" class="flex-1 text-xs font-semibold">
              {t("projectDetail.tabHistory") as string}
            </TabsTrigger>
          </TabsList>
        </Show>

        <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
          <TabsContent
            value="readme"
            class="min-h-0 flex-1 overflow-hidden outline-none flex flex-col"
          >
            <GithubProjectPanel
              projectId={() => props.project().id}
              projectPath={() => props.project().path}
              github={githubInfo}
              view="readme"
              subDetail={m().props.subDetail()}
              onSubDetailChange={m().props.onSubDetailChange}
              model={m()}
            />
          </TabsContent>
          <TabsContent
            value="issues"
            class="min-h-0 flex-1 overflow-hidden outline-none flex flex-col"
          >
            <GithubProjectPanel
              projectId={() => props.project().id}
              projectPath={() => props.project().path}
              github={githubInfo}
              view="issues"
              subDetail={m().props.subDetail()}
              onSubDetailChange={m().props.onSubDetailChange}
              model={m()}
            />
          </TabsContent>
          <TabsContent
            value="files"
            class="min-h-0 flex-1 outline-none overflow-hidden"
          >
            <FileTree
              rootPath={props.project().path}
              projectId={props.project().id}
            />
          </TabsContent>
          <TabsContent
            value="tasks"
            class="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <TasksTabPanel project={props.project} model={m()} />
          </TabsContent>
          <TabsContent
            value="terminal"
            forceMount
            class={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden outline-none pb-3",
              m().activeDetailTab() !== "terminal" && "hidden",
            )}
          >
            <div class="min-h-0 flex-1">
              <EmbeddedTerminalPane
                projectId={props.project().id}
                active={m().activeDetailTab() === "terminal"}
                instances={m().terminalInstances}
                activeId={m().activeTerminalId}
                onOpenTerminal={(instance) => m().openTerminal(instance)}
                onCloseTerminal={(id) => m().closeTerminal(id)}
                onSelectTerminal={(id) => m().selectTerminal(id)}
                onUpdateSessionId={(id, sessionId) =>
                  m().updateTerminalSessionId(id, sessionId)
                }
                onExternalShell={() => void m().onShell(props.project().id)}
                fullscreen={terminalFullscreen()}
                onToggleFullscreen={() => setTerminalFullscreen((v) => !v)}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="history"
            class="min-h-0 flex flex-1 flex-col overflow-hidden outline-none"
          >
            <HistoryTabPanel model={m()} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
};
