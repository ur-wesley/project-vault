import { Show, createSignal, createEffect, createMemo, onCleanup, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { useShortcuts } from "~/lib/shortcut-context";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { EmbeddedTerminalPane } from "../EmbeddedTerminal";
import { FileTree } from "../FileTree";
import { GithubProjectPanel } from "../GithubProjectPanel";
import { TasksTabPanel } from "./TasksTabPanel";
import { HistoryTabPanel } from "./HistoryTabPanel";
import { KanbanTabPanel } from "~/features/kanban/KanbanTabPanel";
import { WorkspacePanel } from "~/features/kanban/WorkspacePanel";
import { CanvasView, openCanvasWindow } from "~/features/canvas";
import type { ProjectDto } from "~/types/dto";

type ProjectMainTabsProps = Readonly<{
  model: ProjectDetailModel;
  project: () => ProjectDto;
}>;

const FULL_WIDTH_TABS = new Set(["canvas", "files", "terminal", "board", "workspaces"]);
const WIDE_TABS_KEY = "pv:project-tabs-wide";

function readInitialWideTabs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(WIDE_TABS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, boolean> = {};
    for (const tab of FULL_WIDTH_TABS) {
      if ((parsed as Record<string, unknown>)[tab] === true) out[tab] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export const ProjectMainTabs: Component<ProjectMainTabsProps> = (props) => {
  const { t } = useI18n();
  const hub = useEventHub();
  const shortcuts = useShortcuts();
  const sidebar = useSidebar();
  const m = () => props.model;

  // eslint-disable-next-line no-unassigned-vars -- Solid ref pattern
  let tabsListRef: HTMLDivElement | undefined;

  const tabShortcutTitle = (index: number, label: string) => {
    const binding = shortcuts.format(`project-tab:${index}`);
    return binding ? `${label} (${binding})` : label;
  };

  createEffect(() => {
    const unsub = hub.on("terminal:blurred", () => {
      const list = tabsListRef;
      if (!list) return;
      const selected = list.querySelector<HTMLElement>("[data-selected]");
      selected?.focus();
    });
    onCleanup(unsub);
  });

  const activeCount = createMemo(
    () => (m().activeSessionsQ.data ?? []).filter((s) => !s.command?.startsWith("IDE: ")).length,
  );
  const [terminalFullscreen, setTerminalFullscreen] = createSignal(false);
  const [previousSidebarOpen, setPreviousSidebarOpen] = createSignal<boolean | null>(null);
  const [wideTabs, setWideTabs] = createSignal<Record<string, boolean>>(readInitialWideTabs());

  const activeTab = () => m().activeDetailTab();
  const canGoWide = () => FULL_WIDTH_TABS.has(activeTab());
  const isWide = () => wideTabs()[activeTab()] === true;
  // Locked width: once wide is enabled for any tab, keep the container
  // full-bleed across tab switches so hotkey cycling doesn't snap between
  // max-w-none and max-w-7xl (and px-1 vs px-4).
  const lockedWide = () => Object.values(wideTabs()).some(Boolean);
  const toggleWide = () => {
    const tab = activeTab();
    if (!FULL_WIDTH_TABS.has(tab)) return;
    const next = { ...wideTabs() };
    if (next[tab]) {
      delete next[tab];
    } else {
      next[tab] = true;
    }
    setWideTabs(next);
    try {
      localStorage.setItem(WIDE_TABS_KEY, JSON.stringify(next));
    } catch {
      // ignore persistence failures (e.g. private mode)
    }
  };
  const wideTitle = () =>
    isWide()
      ? (t("projectDetail.contentConstrained") as string)
      : (t("projectDetail.contentFullWidth") as string);

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
      <div
        class={cn(
          "mx-auto flex w-full flex-1 flex-col min-h-0",
          lockedWide() ? "max-w-none px-1" : "max-w-7xl px-4",
        )}
      >
        <Show when={!terminalFullscreen()}>
          <div class="flex w-full shrink-0 items-center gap-2">
            <TabsList
              ref={tabsListRef}
              class="h-9 min-w-0 flex-1 shrink-0 justify-start bg-muted/60 flex p-1"
            >
              <TabsTrigger
                value="readme"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(1, t("projectDetail.tabReadme") as string)}
              >
                {t("projectDetail.tabReadme") as string}
              </TabsTrigger>
              <TabsTrigger
                value="canvas"
                class="flex-1 text-xs font-semibold gap-1.5"
                title={tabShortcutTitle(2, t("projectDetail.tabCanvas") as string)}
              >
                <span class="iconify mdi--view-dashboard-outline size-3.5 text-primary" />
                {t("projectDetail.tabCanvas") as string}
              </TabsTrigger>
              <TabsTrigger
                value="issues"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(3, t("projectDetail.tabIssues") as string)}
              >
                {t("projectDetail.tabIssues") as string}
              </TabsTrigger>
              <TabsTrigger
                value="board"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(4, t("projectDetail.tabBoard") as string)}
              >
                {t("projectDetail.tabBoard") as string}
              </TabsTrigger>
              <TabsTrigger
                value="files"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(5, t("projectDetail.tabFiles") as string)}
              >
                {t("projectDetail.tabFiles") as string}
              </TabsTrigger>
              <TabsTrigger
                value="tasks"
                class="flex-1 text-xs font-semibold gap-2"
                title={tabShortcutTitle(6, t("projectDetail.tabTasks") as string)}
              >
                {t("projectDetail.tabTasks") as string}
                <span class={cn(activeCount() === 0 && "invisible")}>
                  <Badge
                    variant="default"
                    round
                    class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm"
                  >
                    {activeCount() > 0 ? activeCount() : 0}
                  </Badge>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="terminal"
                class="flex-1 text-xs font-semibold gap-2"
                title={tabShortcutTitle(7, t("projectDetail.tabTerminal") as string)}
              >
                {t("projectDetail.tabTerminal") as string}
                <span class={cn(m().terminalInstances().length === 0 && "invisible")}>
                  <Badge
                    variant="default"
                    round
                    class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm"
                  >
                    {m().terminalInstances().length > 0 ? m().terminalInstances().length : 0}
                  </Badge>
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="workspaces"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(8, t("projectDetail.tabWorkspaces") as string)}
              >
                {t("projectDetail.tabWorkspaces") as string}
              </TabsTrigger>
              <TabsTrigger
                value="history"
                class="flex-1 text-xs font-semibold"
                title={tabShortcutTitle(9, t("projectDetail.tabHistory") as string)}
              >
                {t("projectDetail.tabHistory") as string}
              </TabsTrigger>
            </TabsList>
            <div
              class={cn("shrink-0", !canGoWide() && "invisible pointer-events-none")}
              aria-hidden={!canGoWide()}
            >
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="size-9 shrink-0"
                  aria-pressed={isWide()}
                  title={wideTitle()}
                  onClick={toggleWide}
                  tabIndex={canGoWide() ? 0 : -1}
                >
                  <span
                    class={cn(
                      "iconify size-4",
                      isWide() ? "mdi--fullscreen-exit" : "mdi--fullscreen",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>{wideTitle()}</TooltipContent>
              </Tooltip>
            </div>
          </div>
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
            value="canvas"
            class="min-h-0 flex-1 outline-none overflow-hidden flex flex-col border-0 bg-transparent p-0 shadow-none"
          >
            <CanvasView
              project={props.project}
              onPopOut={() => openCanvasWindow(props.project().id, true)}
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
          <TabsContent value="board" class="min-h-0 flex-1 overflow-hidden outline-none">
            <KanbanTabPanel projectId={props.project().id} github={githubInfo()} />
          </TabsContent>
          <TabsContent value="files" class="min-h-0 flex-1 outline-none overflow-hidden">
            <FileTree
              rootPath={props.project().path}
              projectId={props.project().id}
              subDetail={m().props.subDetail()}
              onSubDetailChange={m().props.onSubDetailChange}
            />
          </TabsContent>
          <TabsContent
            value="tasks"
            class="min-h-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable]"
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
            <div class="min-h-0 flex-1 flex flex-col">
              <EmbeddedTerminalPane
                projectId={props.project().id}
                active={m().activeDetailTab() === "terminal"}
                instances={m().terminalInstances}
                activeId={m().activeTerminalId}
                finishedCount={() => {
                  const activeIds = new Set((m().activeSessionsQ.data ?? []).map((s) => s.id));
                  return m()
                    .terminalInstances()
                    .filter((inst) => inst.attachSessionId && !activeIds.has(inst.attachSessionId))
                    .length;
                }}
                onOpenTerminal={(instance) => m().openTerminal(instance)}
                onCloseTerminal={(id) => m().closeTerminal(id)}
                onCloseFinishedTerminals={() => {
                  const activeIds = new Set((m().activeSessionsQ.data ?? []).map((s) => s.id));
                  m().closeFinishedTerminals(activeIds);
                }}
                onSelectTerminal={(id) => m().selectTerminal(id)}
                onUpdateSessionId={(id, sessionId) => m().updateTerminalSessionId(id, sessionId)}
                onUpdateName={(id, command) => m().updateTerminalName(id, command)}
                onExternalShell={() => void m().onShell(props.project().id)}
                fullscreen={terminalFullscreen()}
                onToggleFullscreen={() => setTerminalFullscreen((v) => !v)}
              />
            </div>
          </TabsContent>
          <TabsContent value="workspaces" class="min-h-0 flex-1 overflow-hidden outline-none">
            <WorkspacePanel projectId={props.project().id} attachToTask={m().attachToTask} />
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
