import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { toast } from "solid-sonner";

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { getGitHubRepoForProject, getProject, setProjectFavorite, deleteProject as deleteProjectTauri } from "~/services/tauri/projects";
import { getProjectMiseTools, suggestMiseTools, pinMiseTools } from "~/services/tauri/mise";
import { getSetting } from "~/services/tauri/settings";
import { listDiscoveredIdes, openProjectInIde, stopProjectIde, isProjectIdeRunning } from "~/services/tauri/ide";
import { openProjectShell } from "~/services/tauri/terminal";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto, MiseToolSuggestionDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { projectIdeStorageKey } from "../lib/ide-storage";
import { dismissedMiseSuggestionsKey } from "../lib/mise-suggestions-storage";
import type { IdeSelectOption, ProjectDetailViewProps } from "../types";

import { useProjectGit } from "./useProjectGit";
import { useProjectTasks } from "./useProjectTasks";
import { useProjectTerminal } from "./useProjectTerminal";
import { useProjectMove } from "./useProjectMove";

export function createProjectDetailModel(props: ProjectDetailViewProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selectedIdeExecutable, setSelectedIdeExecutable] = createSignal<string | null>(null);
  const [sessionPorts, setSessionPorts] = createSignal<Record<string, number[]>>({});
  const lastIdeInitProjectId = { current: "" as string };

  const showBanner = (msg: string) => {
    toast.error(msg);
  };

  const showInfoBanner = (msg: string) => {
    toast.success(msg);
  };

  const projectQ = createQuery(() => ({
    queryKey: queryKeys.project(props.projectId),
    queryFn: async () => {
      const r = await getProject(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const ideRunningQ = createQuery(() => ({
    queryKey: ["projects", props.projectId, "ide-running"] as const,
    queryFn: async () => {
        const r = await isProjectIdeRunning(props.projectId);
        return r.isErr() ? false : r.value;
    },
    refetchInterval: 5000,
  }));

  const git = useProjectGit({
    projectId: () => props.projectId,
    t: (k, a) => t(k, a) as string,
    showBanner,
    showInfoBanner,
  });

  const terminal = useProjectTerminal({
    projectId: () => props.projectId,
    t: (k, a) => t(k, a) as string,
    showBanner,
    onDetailTabChange: props.onDetailTabChange,
  });

  const tasks = useProjectTasks({
    projectId: () => props.projectId,
    t: (k, a) => t(k, a) as string,
    showBanner,
    attachToTask: terminal.attachToTask,
  });

  const move = useProjectMove({
    projectId: () => props.projectId,
    t: (k, a) => t(k, a) as string,
    showBanner,
    showInfoBanner,
    project: () => projectQ.data,
  });

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

  const ideSelectOptions = createMemo((): readonly IdeSelectOption[] => {
    const ides = idesQ.data;
    if (ides == null) return [];
    return ides.map((i) => ({
      value: i.executable,
      label: i.label,
      textValue: `${i.label} ${i.executable}`,
      executable: i.executable,
      icon: i.icon,
    }));
  });

  const selectedIdeOption = createMemo((): IdeSelectOption | null => {
    const ex = selectedIdeExecutable();
    if (ex == null) return null;
    return ideSelectOptions().find((o) => o.executable === ex) ?? null;
  });

  createEffect(() => {
    const pid = props.projectId;
    const ides = idesQ.data;
    const globalDefault = defaultIdeQ.data;
    if (ides == null || ides.length === 0) {
      if (lastIdeInitProjectId.current !== pid) {
        lastIdeInitProjectId.current = pid;
        setSelectedIdeExecutable(null);
      }
      return;
    }
    if (lastIdeInitProjectId.current !== pid) {
      lastIdeInitProjectId.current = pid;
      const stored = localStorage.getItem(projectIdeStorageKey(pid));
      const m = stored
        ? ides.find((i) => i.executable === stored)
        : globalDefault
          ? ides.find((i) => i.executable === globalDefault)
          : null;
      setSelectedIdeExecutable((m ?? ides[0]!).executable);
      return;
    }
    setSelectedIdeExecutable((cur) => {
      const fallback =
        globalDefault && ides.find((i) => i.executable === globalDefault)
          ? globalDefault
          : ides[0]!.executable;
      if (cur == null) return fallback;
      return ides.some((i) => i.executable === cur) ? cur : fallback;
    });
  });

  // Listen for IDE state changes
  createEffect(() => {
    let unIde: (() => void) | undefined;
    let unTaskStarted: (() => void) | undefined;
    let unTaskState: (() => void) | undefined;
    let unTaskTree: (() => void) | undefined;
    let unSession: (() => void) | undefined;
    let unTaskPorts: (() => void) | undefined;

    const refreshTaskQueries = () => {
      void qc.invalidateQueries({ queryKey: ["projects", props.projectId, "active-sessions"] });
      void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
    };

    void (async () => {
      unIde = await listen<{ projectId: string; running: boolean }>(
        "ide-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            void qc.setQueryData(
              ["projects", props.projectId, "ide-running"],
              ev.payload.running,
            );
            void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
            void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
          }
        },
      );
      unTaskStarted = await listen<{ projectId: string; sessionId: string }>(
        "session:started",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskState = await listen<{ projectId: string; sessionId: string; state: string }>(
        "task-state-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskTree = await listen<{ projectId: string; sessionId: string }>(
        "task-tree-changed",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unSession = await listen<{ projectId: string; sessionId: string }>(
        "session:ended",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            refreshTaskQueries();
          }
        },
      );
      unTaskPorts = await listen<{ sessionId: string; projectId: string; ports: number[] }>(
        "task-ports-changed",
        (ev) => {
          console.log("[frontend] task-ports-changed raw", ev.payload);
          console.log("[frontend] projectId check", ev.payload.projectId, "===", props.projectId, "=", ev.payload.projectId === props.projectId);
          if (ev.payload.projectId === props.projectId) {
            setSessionPorts((prev) => {
              const next = { ...prev, [ev.payload.sessionId]: ev.payload.ports };
              console.log("[frontend] setSessionPorts", next);
              return next;
            });
          }
        },
      );
    })();

    onCleanup(() => {
      unIde?.();
      unTaskStarted?.();
      unTaskState?.();
      unTaskTree?.();
      unSession?.();
      unTaskPorts?.();
    });
  });

  // Auto-attach active sessions to terminal tabs whenever the query updates
  createEffect(() => {
    const sessions = tasks.activeSessionsQ.data;
    if (!sessions) return;
    const instances = untrack(terminal.terminalInstances);
    for (const session of sessions) {
      const alreadyAttached = instances.some(
        (inst) => inst.attachSessionId === session.id || inst.sessionId === session.id,
      );
      if (!alreadyAttached) {
        terminal.attachToTask(session.id, session.command ?? "Task", false);
      }
    }
  });

  const ghQ = createQuery(() => ({
    queryKey: queryKeys.githubRepo(props.projectId),
    queryFn: async () => {
      const r = await getGitHubRepoForProject(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 30_000,
  }));

  const miseToolsQ = createQuery(() => ({
    queryKey: queryKeys.projectMiseTools(props.projectId),
    queryFn: async () => {
      const r = await getProjectMiseTools(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const miseSuggestionsQ = createQuery(() => ({
    queryKey: queryKeys.projectMiseSuggestions(props.projectId),
    queryFn: async () => {
      const r = await suggestMiseTools(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 30_000,
  }));

  const pinMiseToolsMu = createMutation(() => ({
    mutationFn: async (tools: MiseToolSuggestionDto[]) => {
      const r = await pinMiseTools(props.projectId, tools);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projectMiseSuggestions(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.projectMiseTools(props.projectId) });
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        showBanner(stableErrorMessage(t, err as StableError));
      }
    },
  }));

  const [miseSuggestionsDismissed, setMiseSuggestionsDismissed] = createSignal(
    localStorage.getItem(dismissedMiseSuggestionsKey(props.projectId)) === "1",
  );

  const dismissMiseSuggestions = () => {
    localStorage.setItem(dismissedMiseSuggestionsKey(props.projectId), "1");
    setMiseSuggestionsDismissed(true);
  };

  const activeDetailTab = createMemo((): string => {
    return props.detailTab();
  });

  const favMu = createMutation(() => ({
    mutationFn: async (p: { id: string; favorite: boolean }) => {
      const r = await setProjectFavorite({ id: p.id, favorite: p.favorite });
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onMutate: async (variables) => {
      const projectKey = queryKeys.project(variables.id);
      await qc.cancelQueries({ queryKey: projectKey });
      await qc.cancelQueries({ queryKey: queryKeys.projects });
      
      const previousProject = qc.getQueryData<ProjectDto>(projectKey);
      const previousProjects = qc.getQueryData<ProjectDto[]>(queryKeys.projects);

      if (previousProject) {
        qc.setQueryData(projectKey, { ...previousProject, favorite: variables.favorite });
      }
      if (previousProjects) {
        qc.setQueryData(
          queryKeys.projects,
          previousProjects.map((p) => (p.id === variables.id ? { ...p, favorite: variables.favorite } : p)),
        );
      }

      return { previousProject, previousProjects };
    },
    onError: (err: unknown, variables, context) => {
      if (context?.previousProject) {
        qc.setQueryData(queryKeys.project(variables.id), context.previousProject);
      }
      if (context?.previousProjects) {
        qc.setQueryData(queryKeys.projects, context.previousProjects);
      }
      if (err && typeof err === "object" && "code" in err) {
        showBanner(stableErrorMessage(t, err as StableError));
      }
    },
    onSettled: (_data, _error, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.project(variables.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
    },
  }));

  const deleteMu = createMutation(() => ({
    mutationFn: async (p: { id: string; deleteFromDisk: boolean }) => {
      const r = await deleteProjectTauri(p.id, p.deleteFromDisk);
      if (r.isErr()) throw r.error;
    },
    onSuccess: (_data, variables) => {
      // Optimistically remove deleted project from sidebar cache
      qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => {
        if (!old) return old;
        return old.filter((p) => p.id !== variables.id);
      });
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      void qc.removeQueries({ queryKey: queryKeys.project(variables.id) });
      toast.success(t("projectDetail.projectDeleted") as string);
      props.onBack();
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        showBanner(stableErrorMessage(t, err as StableError));
      }
    },
  }));

  const onShell = async (projectId: string) => {
    const r = await openProjectShell(projectId);
    if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(projectId) });
  };

  const onOpenIde = async (projectId: string, executable: string) => {
    const r = await openProjectInIde({ projectId, executable });
    if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

  const onStopIde = async (projectId: string) => {
    const r = await stopProjectIde(projectId);
    if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
  };

  const onOpenProjectInFileManager = async (path: string) => {
    try {
      await openPath(path);
    } catch (e) {
      showBanner(`${t("library.openInFileManagerFailed") as string} ${String(e)}`);
    }
  };

  const onIdeSelected = (projectId: string, executable: string) => {
    setSelectedIdeExecutable(executable);
    localStorage.setItem(projectIdeStorageKey(projectId), executable);
  };

  return {
    props,
    projectQ,
    gitStatusQ: git.gitStatusQ,
    pullMutate: git.pullMutate,
    pushMutate: git.pushMutate,
    initMutate: git.initMutate,
    tagAndPushMutate: git.tagAndPushMutate,
    previewVersionsQ: git.previewVersionsQ,
    fetchPreviewVersions: git.fetchPreviewVersions,
    discoverVersionFiles: git.discoverVersionFiles,
    bumpVersionAndTag: git.bumpVersionAndTag,
    isPulling: git.isPulling,
    isPushing: git.isPushing,
    isIniting: git.isIniting,
    isTagging: git.isTagging,
    isPreviewingVersions: git.isPreviewingVersions,
    isDiscoveringFiles: git.isDiscoveringFiles,
    isBumpingVersion: git.isBumpingVersion,
    cleanPreview: git.cleanPreview,
    cleanExecute: git.cleanExecute,
    isCleaningPreview: git.isCleaningPreview,
    isCleaning: git.isCleaning,
    sessionsQ: tasks.sessionsQ,
    activeSessionsQ: tasks.activeSessionsQ,
    filteredSessions: tasks.filteredSessions,
    totalCountQ: tasks.totalCountQ,
    filteredCountQ: tasks.filteredCountQ,
    totalCount: tasks.totalCount,
    filteredCount: tasks.filteredCount,
    page: tasks.page,
    setPage: tasks.setPage,
    statusFilter: tasks.statusFilter,
    setStatusFilter: tasks.setStatusFilter,
    clearSessionsMu: tasks.clearSessionsMu,
    sessionPorts,
    idesQ,
    ghQ,
    miseToolsQ,
    miseSuggestionsQ,
    pinMiseToolsMu,
    miseSuggestionsDismissed,
    dismissMiseSuggestions,
    locsQ: move.locsQ,
    ideRunningQ,
    ideSelectOptions,
    selectedIdeOption,
    selectedIdeExecutable,
    setSelectedIdeExecutable,
    onIdeSelected,
    risk: tasks.risk,
    setRisk: tasks.setRisk,
    favMutate: (p: { id: string; favorite: boolean }) => favMu.mutate(p),
    deleteProject: (id: string, deleteFromDisk: boolean) => deleteMu.mutate({ id, deleteFromDisk }),
    runArgv: tasks.runArgv,
    onStopTask: tasks.onStopTask,
    onShell,
    attachToTask: terminal.attachToTask,
    terminalInstances: terminal.terminalInstances,
    activeTerminalId: terminal.activeTerminalId,
    openTerminal: terminal.openTerminal,
    closeTerminal: terminal.closeTerminal,
    selectTerminal: terminal.selectTerminal,
    updateTerminalSessionId: terminal.updateTerminalSessionId,
    onOpenIde,
    onStopIde,
    onOpenProjectInFileManager,
    activeDetailTab,
    moveOpen: move.moveOpen,
    setMoveOpen: move.setMoveOpen,
    setMoveTargetLocationId: move.setMoveTargetLocationId,
    moveTargetLocationId: move.moveTargetLocationId,
    moveBusy: move.moveBusy,
    moveProgress: move.moveProgress,
    moveLocationRows: move.moveLocationRows,
    hasMovableTarget: move.hasMovableTarget,
    moveSelectOptions: move.moveSelectOptions,
    selectedMoveLocation: move.selectedMoveLocation,
    moveDestinationPreview: move.moveDestinationPreview,
    moveDialogDescription: move.moveDialogDescription,
    moveProgressPhaseLabel: move.moveProgressPhaseLabel,
    moveProgressBarPercent: move.moveProgressBarPercent,
    moveProgressFilesBytesLine: move.moveProgressFilesBytesLine,
    onConfirmMove: move.onConfirmMove,
    resetMoveDialog: move.resetMoveDialog,
    qc,
  };
}

export type ProjectDetailModel = ReturnType<typeof createProjectDetailModel>;
