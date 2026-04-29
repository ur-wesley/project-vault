import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { useI18n } from "~/lib/i18n-context";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

import type { ProjectDetailModel } from "../model/createProjectDetailModel";
import { formatSessionRange, formatWorktime } from "../lib/format";
import { EmbeddedTerminalPane } from "../EmbeddedTerminal";
import { FileTree } from "../FileTree";
import { GithubProjectPanel } from "../GithubProjectPanel";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { MiseToolsSuggestion } from "./MiseToolsSuggestion";
import type { ProjectDto, TaskDto } from "~/types/dto";
import { deleteProjectTask } from "~/services/tauri";
import { toast } from "solid-sonner";

type SessionState = "running" | "starting" | "success" | "error" | "cancelled" | "unknown";
type StatusOption = { value: SessionState | "all"; label: string };

const PAGE_SIZE = 20;
const statusOptions: StatusOption[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "starting", label: "Starting" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "cancelled", label: "Cancelled" },
];

function statusVariant(state: string): "default" | "secondary" | "outline" | "destructive" | "success" {
  switch (state) {
    case "running":
    case "starting":
      return "default";
    case "success":
      return "success";
    case "error":
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

type ProjectMainTabsProps = Readonly<{
  model: ProjectDetailModel;
  project: () => ProjectDto;
}>;

export const ProjectMainTabs: Component<ProjectMainTabsProps> = (props) => {
  const { t } = useI18n();
  const sidebar = useSidebar();
  const m = () => props.model;

  const activeCount = createMemo(() => m().activeSessionsQ.data?.length ?? 0);
  const activeSessions = createMemo(() => m().activeSessionsQ.data ?? []);
  const [runningTaskKey, setRunningTaskKey] = createSignal<string | null>(null);
  const [terminalFullscreen, setTerminalFullscreen] = createSignal(false);
  const [previousSidebarOpen, setPreviousSidebarOpen] = createSignal<boolean | null>(null);
  const [taskEditorOpen, setTaskEditorOpen] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<TaskDto | null>(null);
  const [deletingTask, setDeletingTask] = createSignal<TaskDto | null>(null);
  const [deleteBusy, setDeleteBusy] = createSignal(false);

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

  const normalizeCommand = (value: string) => value.replace(/\s+/g, " ").trim();

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
            <Show when={m().terminalInstances().length > 0}>
               <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
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
          <TabsContent value="tasks" class="min-h-0 flex-1 overflow-y-auto outline-none">
            <div class="space-y-6 pb-4">
              <div class="flex items-center justify-between">
                <Show when={activeCount() > 0}>
                  <div class="flex items-center gap-2">
                    <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
                      {activeCount()}
                    </Badge>
                    <span class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {activeCount() === 1 ? (t("projectDetail.taskRunningSingular") as string) : (t("projectDetail.taskRunningPlural") as string)}
                    </span>
                  </div>
                </Show>
                <div class="flex items-center gap-2">
                  <Show when={m().miseSuggestionsDismissed() && (m().miseSuggestionsQ.data?.length ?? 0) > 0}>
                    <Popover gutter={8}>
                      <PopoverTrigger
                        as={Button}
                        type="button"
                        variant="outline"
                        size="sm"
                        class="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
                      >
                        <span class="iconify mdi--tools size-3.5" />
                        {t("projectDetail.misePinSelected") as string}
                      </PopoverTrigger>
                      <PopoverContent class="w-80 p-3">
                        <MiseToolsSuggestion
                          suggestions={m().miseSuggestionsQ.data ?? []}
                          isLoading={m().miseSuggestionsQ.isLoading}
                          isPending={m().pinMiseToolsMu.isPending}
                          onPin={(tools) => m().pinMiseToolsMu.mutate(tools)}
                          onDismiss={m().dismissMiseSuggestions}
                        />
                      </PopoverContent>
                    </Popover>
                  </Show>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      setEditingTask(null);
                      setTaskEditorOpen(true);
                    }}
                  >
                    <span class="iconify mdi--plus size-3.5" />
                    {t("projectDetail.newTask") as string}
                  </Button>
                </div>
              </div>

              <Show when={props.project().tasks.length === 0}>
                <p class="text-sm text-muted-foreground">{t("projectDetail.noTasks") as string}</p>
              </Show>

              <Show when={activeSessions().length > 0}>
                  <div class="rounded-lg border border-border/60 bg-card/80 p-3 shadow-sm">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("projectDetail.taskOutputTitle") as string}
                        </p>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {t("projectDetail.taskOutputHint") as string}
                        </p>
                      </div>
                      <Badge variant="default" round class="h-5 min-w-5 px-1.5 text-[10px] font-black shadow-sm">
                        {activeSessions().length}
                      </Badge>
                    </div>
                    <div class="mt-3 space-y-2">
                      <For each={activeSessions()}>
                        {(session) => (
                          <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex min-w-0 flex-wrap items-center gap-2">
                                <Badge
                                  variant={session.state === "running" || session.state === "starting" ? "default" : "secondary"}
                                  round
                                  class="h-5 px-2 text-[10px] font-black uppercase tracking-wider"
                                >
                                  {session.state}
                                </Badge>
                                <span class="min-w-0 truncate font-mono text-xs text-foreground/90">
                                  {session.command ?? "—"}
                                </span>
                              </div>
                              <p class="mt-1 text-[11px] text-muted-foreground">
                                {session.rootPid != null
                                  ? `PID ${session.rootPid}`
                                  : (t("projectDetail.taskOutputHint") as string)}
                              </p>
                              <div class="mt-1 text-[10px] text-muted-foreground">
                                ports debug: sid={session.id} lookup={JSON.stringify(m().sessionPorts()[session.id])}
                              </div>
                              <Show when={m().sessionPorts()[session.id]?.length > 0}>
                                <div class="mt-1 flex flex-wrap items-center gap-1">
                                  <span class="text-[10px] text-muted-foreground/70">{t("projectDetail.ports") as string}:</span>
                                  <For each={m().sessionPorts()[session.id]}>
                                    {(port) => (
                                      <Badge variant="outline" round class="h-4 px-1.5 text-[9px] font-mono font-bold border-primary/30 text-primary/80">
                                        :{port}
                                      </Badge>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                            <div class="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="size-7 text-muted-foreground hover:text-foreground hover:bg-background/50"
                                onClick={() => m().attachToTask(session.id, session.command ?? (t("projectDetail.tabTerminal") as string))}
                                title={t("projectDetail.taskViewOutput") as string}
                              >
                                <span class="iconify mdi--terminal size-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                                onClick={() => void m().onStopTask(session.id)}
                                title={t("projectDetail.taskStop") as string}
                              >
                                <span class="iconify mdi--stop size-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                {(() => {
                  const groups: Record<string, any[]> = {};
                  for (const task of props.project().tasks) {
                    const parts = task.label.split(": ");
                    const groupName = parts.length > 1 ? parts[0]! : (t('projectDetail.taskGroupRoot') as string);
                    const label = parts.length > 1 ? parts.slice(1).join(": ") : task.label;
                    if (!groups[groupName]) groups[groupName] = [];
                    groups[groupName]!.push({ ...task, label });
                  }

                  const findActiveSession = (argv: string[]) => {
                    const cmd = normalizeCommand(argv.join(" "));
                    return activeSessions().find((s) => normalizeCommand(s.command ?? "") === cmd);
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
                                const taskKey = `${name}::${task.label}::${task.argv.join("\u0000")}`;
                                const busy = () => runningTaskKey() === taskKey;
                                const active = () => findActiveSession(task.argv);
                                
                                const handleRun = async () => {
                                  if (active()) {
                                    m().attachToTask(active()!.id, task.label);
                                    return;
                                  }
                                  setRunningTaskKey(taskKey);
                                  try {
                                    await m().runArgv(props.project(), task.argv, false, task.cwd);
                                  } finally {
                                    setRunningTaskKey((current) => (current === taskKey ? null : current));
                                  }
                                };

                                return (
                                  <div class="flex items-center gap-1 rounded-md border border-border/40 bg-muted/10 p-1 transition-colors hover:bg-muted/20">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={active() ? "default" : name === (t('projectDetail.taskGroupRoot') as string) ? "default" : "secondary"}
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
                                      <Badge variant="secondary" round class="h-7 px-2 text-[10px] font-black uppercase tracking-wider">
                                        {active()!.state}
                                      </Badge>
                                    </Show>
                                    
                                     <Show when={active()}>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          class="size-7 text-muted-foreground hover:text-foreground hover:bg-background/50"
                                          onClick={() => m().attachToTask(active()!.id, task.label)}
                                          title={t('projectDetail.taskViewOutput') as string}
                                        >
                                          <span class="iconify mdi--terminal size-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          class="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                                          onClick={() => void m().onStopTask(active()!.id)}
                                          title={t('projectDetail.taskStop') as string}
                                        >
                                          <span class="iconify mdi--stop size-4" />
                                        </Button>
                                     </Show>

                                     <Show when={task.kind === "mise" || task.kind === "justfile"}>
                                        <Badge variant="outline" round class="h-5 px-1.5 text-[9px] font-black uppercase tracking-wider border-primary/30 text-primary/70">
                                          {task.kind === "mise" ? "mise" : "just"}
                                        </Badge>
                                     </Show>

                                     <Show when={!active() && (task.kind === "mise" || task.kind === "justfile")}>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              type="button"
                                              size="icon"
                                              variant="ghost"
                                              class="size-6 text-muted-foreground hover:text-foreground hover:bg-background/50"
                                            >
                                              <span class="iconify mdi--dots-vertical size-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent class="w-40">
                                            <DropdownMenuItem
                                              onSelect={() => {
                                                setEditingTask(task as TaskDto);
                                                setTaskEditorOpen(true);
                                              }}
                                              class="gap-2 text-xs"
                                            >
                                              <span class="iconify mdi--pencil size-3.5" />
                                              {t('projectDetail.editTask') as string}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => setDeletingTask(task as TaskDto)}
                                              class="gap-2 text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
                                            >
                                              <span class="iconify mdi--delete-outline size-3.5" />
                                              {t('projectDetail.deleteTask') as string}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
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
                onUpdateSessionId={(id, sessionId) => m().updateTerminalSessionId(id, sessionId)}
                onExternalShell={() => void m().onShell(props.project().id)}
                fullscreen={terminalFullscreen()}
                onToggleFullscreen={() => setTerminalFullscreen((v) => !v)}
              />
            </div>
          </TabsContent>
          <TabsContent value="history" class="min-h-0 flex flex-1 flex-col overflow-hidden outline-none">
            <div class="mb-3 flex flex-wrap items-center gap-2 relative z-10">
              <Select
                options={statusOptions}
                optionValue="value"
                optionTextValue="label"
                value={statusOptions.find((o) => o.value === m().statusFilter())}
                onChange={(o) => o && m().setStatusFilter(o.value as SessionState | "all")}
                itemComponent={(p) => (
                  <Select.Item item={p.item}>
                    <Select.ItemLabel class="text-xs">
                      {p.item.rawValue.label}
                    </Select.ItemLabel>
                  </Select.Item>
                )}
              >
                <SelectTrigger class="h-8 w-36 bg-muted/30 text-xs">
                  <Select.Value<StatusOption>>
                    {(s) => s.selectedOption()?.label ?? t("history.filterPlaceholder")}
                  </Select.Value>
                  <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
                </SelectTrigger>
                <Select.Content>
                  <Select.Listbox />
                </Select.Content>
              </Select>
              <span class="text-xs text-muted-foreground">
                {m().sessionsQ.data?.length ?? 0}
                {m().statusFilter() === "all"
                  ? m().totalCount() > 0 && ` / ${m().totalCount()}`
                  : m().filteredCount() > 0 && ` / ${m().filteredCount()}`}
                {t("history.entries") as string}
              </span>

              <Show when={(m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) > PAGE_SIZE}>
                <div class="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    disabled={m().page() === 0}
                    onClick={() => m().setPage((p) => Math.max(0, p - 1))}
                  >
                    <span class="iconify mdi--chevron-left size-4" />
                  </Button>
                  <span class="text-[11px] text-muted-foreground tabular-nums px-1">
                    {m().page() + 1}
                    /
                    {Math.ceil(((m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) ?? 0) / PAGE_SIZE)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    disabled={(m().page() + 1) * PAGE_SIZE >= ((m().statusFilter() === "all" ? m().totalCount() : m().filteredCount()) ?? 0)}
                    onClick={() => m().setPage((p) => p + 1)}
                  >
                    <span class="iconify mdi--chevron-right size-4" />
                  </Button>
                </div>
              </Show>

              <div class="ml-auto">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-8 text-xs text-muted-foreground hover:text-destructive"
                      disabled={m().clearSessionsMu.isPending}
                    >
                      <span class="iconify mdi--delete-outline mr-1.5 size-4" />
                      {t("history.clear") as string}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("history.clearConfirmTitle") as string}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("history.clearConfirmDesc") as string}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel") as string}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => m().clearSessionsMu.mutate()}
                        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t("history.clear") as string}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto pr-1 pb-3">
              <Show when={m().sessionsQ.isPending}>
                <p class="text-sm text-muted-foreground">{t("library.loading") as string}</p>
              </Show>
              <Show when={m().sessionsQ.isError}>
                <p class="text-sm text-destructive">{t("library.error") as string}</p>
              </Show>
              <Show when={!m().sessionsQ.isPending && !m().sessionsQ.isError && (m().sessionsQ.data?.length ?? 0) === 0}>
                <p class="text-sm text-muted-foreground">{t("history.empty") as string}</p>
              </Show>
              <ul class="space-y-2 text-sm">
                <For each={m().filteredSessions()}>
                  {(s) => (
                    <li class="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                      <div class="flex items-start justify-between gap-3">
                        <p class="text-xs text-muted-foreground whitespace-nowrap">
                          {formatSessionRange(s.startedAtMs, s.endedAtMs, t)}
                        </p>
                        <Badge
                          variant={statusVariant(s.state)}
                          round
                          class="h-5 px-2 text-[10px] font-black uppercase tracking-wider"
                        >
                          {s.state}
                        </Badge>
                      </div>
                      <p class="mt-1.5 break-all font-mono text-[11px] text-foreground/90">
                        {s.command ?? "—"}
                      </p>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </TabsContent>
        </div>
      </div>

      <TaskEditorDialog
        open={taskEditorOpen()}
        onOpenChange={setTaskEditorOpen}
        projectId={props.project().id}
        projectPath={props.project().path}
        existingTask={editingTask()}
        availableKinds={["mise", "justfile"]}
        onSaved={() => {
          // Refresh project data
          void m().projectQ.refetch();
        }}
      />

      <AlertDialog open={deletingTask() != null} onOpenChange={(open) => !open && setDeletingTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projectDetail.deleteTask") as string}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectDetail.deleteTaskConfirm") as string}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingTask(null)}>
              {t("common.cancel") as string}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const task = deletingTask();
                if (!task) return;
                setDeleteBusy(true);
                try {
                  const r = await deleteProjectTask(props.project().id, task);
                  if (r.isErr()) {
                    toast.error(r.error.message);
                    return;
                  }
                  toast.success(t("projectDetail.taskEditor.deleted") as string);
                  void m().projectQ.refetch();
                } finally {
                  setDeleteBusy(false);
                  setDeletingTask(null);
                }
              }}
              disabled={deleteBusy()}
              class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy() && <span class="iconify mdi--loading animate-spin mr-1.5 size-4" />}
              {t("projectDetail.deleteTask") as string}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
};
