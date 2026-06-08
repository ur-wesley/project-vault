import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, onCleanup } from "solid-js";
import { toast } from "solid-sonner";

import { useI18n } from "~/lib/i18n-context";
import { useWindowFocus } from "~/lib/use-window-focus";
import { stableErrorMessage } from "~/lib/invoke-error";
import { notify } from "~/lib/notification-center";
import { getGitHubRepoForProject, getGitRemoteUrl, getProject, setProjectFavorite, deleteProject as deleteProjectTauri, refreshProject } from "~/services/tauri/projects";
import { openProjectShell } from "~/services/tauri/terminal";
import { startGitWatcher, stopGitWatcher } from "~/services/tauri/git";
import { syncProjectTasksInCache } from "~/lib/sync-project-tasks-cache";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto, TaskDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import type { ProjectDetailViewProps } from "../types";

import { useProjectGit } from "./useProjectGit";
import { useProjectTasks } from "./useProjectTasks";
import { useProjectTerminal } from "./useProjectTerminal";
import { useProjectMove } from "./useProjectMove";
import { useProjectIde } from "./useProjectIde";
import { useProjectMise } from "./useProjectMise";
import { useProjectEventListeners } from "./useProjectEventListeners";

export function createProjectDetailModel(props: ProjectDetailViewProps) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const showBanner = (msg: string) => {
    toast.error(msg);
  };

  const showInfoBanner = (msg: string) => {
    toast.success(msg);
  };

  const isFocused = useWindowFocus();

  const projectQ = createQuery(() => ({
    queryKey: queryKeys.project(props.projectId),
    queryFn: async () => {
      const r = await getProject(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const ide = useProjectIde({ projectId: () => props.projectId });

  const git = useProjectGit({
    projectId: () => props.projectId,
    isFocused,
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

  const events = useProjectEventListeners({
    projectId: () => props.projectId,
    activeSessionsQ: tasks.activeSessionsQ,
    terminalInstances: terminal.terminalInstances,
    attachToTask: terminal.attachToTask,
  });

  const mise = useProjectMise({ projectId: () => props.projectId });

  const ghQ = createQuery(() => ({
    queryKey: queryKeys.githubRepo(props.projectId),
    queryFn: async () => {
      const r = await getGitHubRepoForProject(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 30_000,
  }));

  const gitRemoteQ = createQuery(() => ({
    queryKey: ["git", "remote", props.projectId],
    queryFn: async () => {
      const r = await getGitRemoteUrl(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: !!projectQ.data && git.gitStatusQ.isSuccess && git.gitStatusQ.data !== null,
    refetchInterval: 30_000,
  }));

  if (isTauri()) {
    createEffect(() => {
      const project = projectQ.data;
      if (!project) return;

      const path = project.path;
      void startGitWatcher(props.projectId, path);

      onCleanup(() => {
        void stopGitWatcher(props.projectId);
      });
    });

    createEffect(() => {
      let unlisten: (() => void) | undefined;
      void listen<{ projectId: string }>("git:status-changed", (ev) => {
        if (ev.payload.projectId === props.projectId) {
          void refreshProject(props.projectId);
        }
      }).then((fn) => { unlisten = fn; });

      onCleanup(() => { unlisten?.(); });
    });
  }

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
      notify({
        severity: "success",
        title: t("projectDetail.projectDeleted") as string,
        source: "Projects",
        system: "auto",
      });
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

  const onOpenProjectInFileManager = async (path: string) => {
    try {
      await openPath(path);
    } catch (e) {
      showBanner(`${t("library.openInFileManagerFailed") as string} ${String(e)}`);
    }
  };

  const syncProjectTasks = (tasks: TaskDto[]) => {
    syncProjectTasksInCache(qc, props.projectId, tasks);
  };

  return {
    props,
    projectQ,
    gitStatusQ: git.gitStatusQ,
    gitIncomingQ: git.gitIncomingQ,
    pullMutate: git.pullMutate,
    pushMutate: git.pushMutate,
    initMutate: git.initMutate,
    tagAndPushMutate: git.tagAndPushMutate,
    fetchAndRefresh: git.fetchAndRefresh,
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
    sessionPorts: events.sessionPorts,
    sessionTunnels: events.sessionTunnels,
    idesQ: ide.idesQ,
    ghQ,
    gitRemoteQ,
    miseToolsQ: mise.miseToolsQ,
    miseSuggestionsQ: mise.miseSuggestionsQ,
    pinMiseToolsMu: mise.pinMiseToolsMu,
    miseSuggestionsDismissed: mise.miseSuggestionsDismissed,
    dismissMiseSuggestions: mise.dismissMiseSuggestions,
    locsQ: move.locsQ,
    ideRunningQ: ide.ideRunningQ,
    ideSelectOptions: ide.ideSelectOptions,
    selectedIdeOption: ide.selectedIdeOption,
    selectedIdeExecutable: ide.selectedIdeExecutable,
    setSelectedIdeExecutable: ide.setSelectedIdeExecutable,
    onIdeSelected: ide.onIdeSelected,
    risk: tasks.risk,
    setRisk: tasks.setRisk,
    favMutate: (p: { id: string; favorite: boolean }) => favMu.mutate(p),
    deleteProject: (id: string, deleteFromDisk: boolean) => deleteMu.mutate({ id, deleteFromDisk }),
    runArgv: tasks.runArgv,
    onStopTask: tasks.onStopTask,
    restartArgv: tasks.restartArgv,
    onShell,
    attachToTask: terminal.attachToTask,
    terminalInstances: terminal.terminalInstances,
    activeTerminalId: terminal.activeTerminalId,
    openTerminal: terminal.openTerminal,
    closeTerminal: terminal.closeTerminal,
    closeFinishedTerminals: terminal.closeFinishedTerminals,
    selectTerminal: terminal.selectTerminal,
    updateTerminalSessionId: terminal.updateTerminalSessionId,
    onOpenIde: ide.onOpenIde,
    onStopIde: ide.onStopIde,
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
    syncProjectTasks,
  };
}

export type ProjectDetailModel = ReturnType<typeof createProjectDetailModel>;
