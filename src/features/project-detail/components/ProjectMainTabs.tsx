import { For, Show, createMemo, createSignal, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useI18n } from "~/lib/i18n-context";
import { cn } from "~/lib/utils";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { formatSessionRange, formatWorktime } from "../lib/format";
import { EmbeddedTerminalPane } from "../EmbeddedTerminal";
import { FileTree } from "../FileTree";
import { GithubProjectPanel } from "../GithubProjectPanel";
import type { ProjectDto } from "~/types/dto";

type ProjectMainTabsProps = Readonly<{
  model: ProjectDetailModel;
  project: () => ProjectDto;
}>;

export const ProjectMainTabs: Component<ProjectMainTabsProps> = (props) => {
  const { t } = useI18n();
  const m = () => props.model;

  const activeCount = createMemo(() => m().activeSessionsQ.data?.length ?? 0);

  return (
    <Tabs
      value={m().activeDetailTab()}
      onChange={(v) => m().props.onDetailTabChange(v)}
      class="flex h-full min-h-0 flex-col"
    >
      <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col min-h-0">
        <TabsList class="h-9 w-full shrink-0 justify-start bg-muted/60 flex p-1">
          <TabsTrigger value="readme" class="flex-1 text-xs font-semibold">
            {t("projectDetail.tabReadme") as string}
          </TabsTrigger>
          <Show when={props.project().githubOwner != null}>
            <TabsTrigger value="issues" class="flex-1 text-xs font-semibold">
              {t("projectDetail.tabIssues") as string}
            </TabsTrigger>
          </Show>
          <TabsTrigger value="files" class="flex-1 text-xs font-semibold">
            {t("projectDetail.tabFiles") as string}
          </TabsTrigger>
          <TabsTrigger value="tasks" class="flex-1 text-xs font-semibold gap-2">
            {t("projectDetail.tabTasks") as string}
            <Show when={activeCount() > 0}>
               <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
                 {activeCount()}
               </Badge>
            </Show>
          </TabsTrigger>
          <TabsTrigger value="terminal" class="flex-1 text-xs font-semibold gap-2">
            {t("projectDetail.tabTerminal") as string}
            <Show when={activeCount() > 0}>
               <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
                 {activeCount()}
               </Badge>
            </Show>
          </TabsTrigger>
          <TabsTrigger value="history" class="flex-1 text-xs font-semibold">
            {t("projectDetail.tabHistory") as string}
          </TabsTrigger>
        </TabsList>

        <div class="flex-1 min-h-0 mt-4 overflow-hidden flex flex-col px-4">
          <TabsContent value="readme" class="min-h-0 flex-1 overflow-hidden outline-none flex flex-col">
            <GithubProjectPanel
              projectId={props.project().id}
              projectPath={props.project().path}
              github={
                props.project().githubOwner
                  ? { owner: props.project().githubOwner!, repo: props.project().githubRepo! }
                  : null
              }
              view="readme"
              subDetail={m().props.subDetail()}
              onSubDetailChange={m().props.onSubDetailChange}
            />
          </TabsContent>
          <Show when={props.project().githubOwner != null}>
            <TabsContent value="issues" class="min-h-0 flex-1 overflow-hidden outline-none flex flex-col">
              <GithubProjectPanel
                projectId={props.project().id}
                projectPath={props.project().path}
                github={{
                  owner: props.project().githubOwner!,
                  repo: props.project().githubRepo!,
                }}
                view="issues"
                subDetail={m().props.subDetail()}
                onSubDetailChange={m().props.onSubDetailChange}
              />
            </TabsContent>
          </Show>
          <TabsContent value="files" class="min-h-0 flex-1 outline-none overflow-hidden">
            <FileTree rootPath={props.project().path} />
          </TabsContent>
          <TabsContent value="tasks" class="min-h-0 flex-1 overflow-y-auto outline-none pr-1">
            <Show
              when={props.project().tasks.length > 0}
              fallback={
                <p class="text-sm text-muted-foreground">{t("projectDetail.noTasks") as string}</p>
              }
            >
              <div class="space-y-6 pb-4">
                {(() => {
                  const groups: Record<string, any[]> = {};
                  for (const task of props.project().tasks) {
                    const parts = task.label.split(": ");
                    const groupName = parts.length > 1 ? parts[0]! : "Root";
                    const label = parts.length > 1 ? parts.slice(1).join(": ") : task.label;
                    if (!groups[groupName]) groups[groupName] = [];
                    groups[groupName]!.push({ ...task, label });
                  }

                  const findActiveSession = (argv: string[]) => {
                    const cmd = argv.join(" ");
                    const sessions = m().activeSessionsQ.data || [];
                    return sessions.find((s) => s.command === cmd);
                  };

                  return (
                    <For each={Object.entries(groups)}>
                      {([name, tasks]) => (
                        <div class="space-y-2.5">
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                              {name}
                            </span>
                            <div class="h-px flex-1 bg-border/40" />
                          </div>
                          <div class="flex flex-wrap gap-2">
                            <For each={tasks}>
                              {(task) => {
                                const [busy, setBusy] = createSignal(false);
                                const active = () => findActiveSession(task.argv);
                                
                                const handleRun = async () => {
                                  if (active()) {
                                    m().attachToTask(active()!.id, task.label);
                                    return;
                                  }
                                  setBusy(true);
                                  try {
                                    await m().runArgv(props.project(), task.argv, false);
                                  } finally {
                                    setBusy(false);
                                  }
                                };

                                return (
                                  <div class="flex items-center gap-1 rounded-md border border-border/40 bg-muted/10 p-1 transition-colors hover:bg-muted/20">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={active() ? "default" : name === "Root" ? "default" : "secondary"}
                                      class={cn(
                                        "h-7 gap-1.5 px-3 transition-all", 
                                        active() && "bg-green-600 hover:bg-green-700 shadow-sm"
                                      )}
                                      disabled={busy()}
                                      onClick={handleRun}
                                    >
                                      <Show when={active() || busy()} fallback={<span class="iconify mdi--play size-3.5 opacity-50" />}>
                                         <span class="iconify mdi--loading animate-spin size-3.5" />
                                      </Show>
                                      <span class="font-bold tracking-tight">{task.label}</span>
                                    </Button>
                                    
                                    <Show when={active()}>
                                       <Button
                                         type="button"
                                         size="icon"
                                         variant="ghost"
                                         class="size-7 text-muted-foreground hover:text-foreground hover:bg-background/50"
                                         onClick={() => m().attachToTask(active()!.id, task.label)}
                                         title="View Output"
                                       >
                                         <span class="iconify mdi--terminal size-4" />
                                       </Button>
                                       <Button
                                         type="button"
                                         size="icon"
                                         variant="ghost"
                                         class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                                         onClick={() => void m().onStopTask(active()!.id)}
                                         title="Stop Task"
                                       >
                                         <span class="iconify mdi--stop size-4" />
                                       </Button>
                                    </Show>
                                  </div>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  );
                })()}
              </div>
            </Show>
          </TabsContent>
          <TabsContent
            value="terminal"
            class="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
          >
            <div class="min-h-0 flex-1">
              <EmbeddedTerminalPane
                projectId={props.project().id}
                active={m().activeDetailTab() === "terminal"}
                onExternalShell={() => void m().onShell(props.project().id)}
                attachRequest={m().terminalAttachRequest}
              />
            </div>
          </TabsContent>
          <TabsContent value="history" class="min-h-0 flex-1 overflow-y-auto outline-none pr-1">
            <Show when={m().sessionsQ.isPending}>
              <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
            </Show>
            <Show when={m().sessionsQ.isError}>
              <p class="text-sm text-destructive">{t("library.error") as string}</p>
            </Show>
            <ul class="space-y-2 text-sm">
              <For each={m().sessionsQ.data ?? []}>
                {(s) => (
                  <li class="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                    <p class="text-xs text-muted-foreground">
                      {formatSessionRange(s.startedAtMs, s.endedAtMs, t)}
                    </p>
                    <p class="mt-1 break-all font-mono text-[11px] text-foreground/90">
                      {s.command ?? "—"}
                    </p>
                  </li>
                )}
              </For>
            </ul>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
};
