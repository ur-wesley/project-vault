import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { formatBytes } from "~/lib/format-bytes";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { argvNeedsUserConfirmation } from "~/lib/task-risk";
import {
  getGitHubRepoForProject,
  getProject,
  getProjectMiseTools,
  getGitStatus,
  gitPull,
  gitPush,
  deleteProject as deleteProjectTauri,
  getSetting,
  listDiscoveredIdes,
  listLocations,
  listSessionsForProject,
  listActiveSessions,
  moveProject,
  openProjectInIde,
  stopProjectIde,
  isProjectIdeRunning,
  openProjectShell,
  embeddedTerminalKill,
  setProjectFavorite,
  spawnProjectTask,
} from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto, LocationDto, MoveProjectProgress, GitStatusDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { projectIdeStorageKey } from "../lib/ide-storage";
import { isSameProjectDestination, joinParentName, pathBasename } from "../lib/paths";
import type { IdeSelectOption, MoveLocationOption, ProjectDetailViewProps } from "../types";

export function createProjectDetailModel(props: ProjectDetailViewProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [banner, setBanner] = createSignal<string | null>(null);
  const [infoBanner, setInfoBanner] = createSignal<string | null>(null);
  const [risk, setRisk] = createSignal<{
    project: ProjectDto;
    argv: string[];
  } | null>(null);
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [moveTargetLocationId, setMoveTargetLocationId] = createSignal<string | null>(null);
  const [moveBusy, setMoveBusy] = createSignal(false);
  const [moveProgress, setMoveProgress] = createSignal<MoveProjectProgress | null>(null);
  const [selectedIdeExecutable, setSelectedIdeExecutable] = createSignal<string | null>(null);
  const [terminalAttachRequest, setTerminalAttachRequest] = createSignal<{
    sessionId: string;
    label: string;
  } | null>(null);
  const lastIdeInitProjectId = { current: "" as string };

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

  const gitStatusQ = createQuery(() => ({
    queryKey: queryKeys.gitStatus(props.projectId),
    queryFn: async () => {
        const r = await getGitStatus(props.projectId);
        if (r.isErr()) throw new Error(r.error.message);
        return r.value;
    },
    refetchInterval: 1000 * 60,
  }));

  const pullMu = createMutation(() => ({
    mutationFn: async () => {
        const r = await gitPull(props.projectId);
        if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId) });
        showInfoBanner("Git pull successful.");
    },
    onError: (err: unknown) => {
        showBanner(stableErrorMessage(t, err as any));
    }
  }));

  const pushMu = createMutation(() => ({
    mutationFn: async () => {
        const r = await gitPush(props.projectId);
        if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
        void qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.projectId) });
        showInfoBanner("Git push successful.");
    },
    onError: (err: unknown) => {
        showBanner(stableErrorMessage(t, err as any));
    }
  }));

  const sessionsQ = createQuery(() => ({
    queryKey: queryKeys.sessions(props.projectId),
    queryFn: async () => {
      const r = await listSessionsForProject(props.projectId, 80);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const activeSessionsQ = createQuery(() => ({
    queryKey: ["projects", props.projectId, "active-sessions"] as const,
    queryFn: async () => {
      const r = await listActiveSessions(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 3000,
  }));

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
    let unSession: (() => void) | undefined;

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
      unSession = await listen<{ projectId: string; sessionId: string }>(
        "session:ended",
        (ev) => {
          if (ev.payload.projectId === props.projectId) {
            void qc.invalidateQueries({
              queryKey: ["projects", props.projectId, "active-sessions"],
            });
            void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
            void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
          }
        },
      );
    })();

    onCleanup(() => {
      unIde?.();
      unSession?.();
    });
  });

  const ghQ = createQuery(() => ({
    queryKey: queryKeys.githubRepo(props.projectId),
    queryFn: async () => {
      const r = await getGitHubRepoForProject(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const miseToolsQ = createQuery(() => ({
    queryKey: queryKeys.projectMiseTools(props.projectId),
    queryFn: async () => {
      const r = await getProjectMiseTools(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const locsQ = createQuery(() => ({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      const r = await listLocations();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const moveLocationRows = createMemo(
    (): readonly (LocationDto & { destWouldBe: string; sameAsProject: boolean })[] | null => {
      const p = projectQ.data;
      const locs = locsQ.data;
      if (p == null || locs == null) return null;
      const name = pathBasename(p.path);
      return [...locs]
        .filter((l) => l.enabled)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((l) => {
          const destWouldBe = joinParentName(l.path, name);
          return {
            ...l,
            destWouldBe,
            sameAsProject: isSameProjectDestination(l.path, p.path, name),
          };
        });
    },
  );

  const hasMovableTarget = createMemo((): boolean => {
    const rows = moveLocationRows();
    return rows != null && rows.some((r) => !r.sameAsProject);
  });

  const moveSelectOptions = createMemo((): readonly MoveLocationOption[] => {
    const rows = moveLocationRows();
    if (rows == null) return [];
    return rows.map((row) => ({
      value: row.id,
      label: `${row.name}${
        row.sameAsProject
          ? ` — ${t("projectDetail.moveProjectCurrentLocation") as string}`
          : ` (${row.path})`
      }`,
      textValue: `${row.name} ${row.path}`,
      disabled: row.sameAsProject,
    }));
  });

  const selectedMoveLocation = createMemo((): MoveLocationOption | null => {
    const id = moveTargetLocationId();
    if (id == null) return null;
    return moveSelectOptions().find((o) => o.value === id) ?? null;
  });

  const moveDestinationPreview = createMemo((): string | null => {
    const p = projectQ.data;
    const id = moveTargetLocationId();
    if (p == null || id == null) return null;
    const row = moveLocationRows()?.find((l) => l.id === id);
    if (row == null) return null;
    return joinParentName(row.path, pathBasename(p.path));
  });

  const moveDialogDescription = createMemo(
    (): string =>
      (moveBusy()
        ? t("projectDetail.moveProjectProgressDescription")
        : t("projectDetail.moveProjectDescription")) as string,
  );

  const moveProgressPhaseLabel = createMemo((): string => {
    const p = moveProgress();
    if (p == null) return t("projectDetail.moveProjectStarting") as string;
    switch (p.phase) {
      case "preparing":
        return t("projectDetail.movePhasePreparing") as string;
      case "copying":
        return t("projectDetail.movePhaseCopying") as string;
      case "verifying":
        return t("projectDetail.movePhaseVerifying") as string;
      case "finalizing":
        return t("projectDetail.movePhaseFinalizing") as string;
      default:
        return p.phase;
    }
  });

  const moveProgressBarPercent = createMemo((): number => {
    const p = moveProgress();
    if (p == null) return 0;
    if (p.phase === "verifying" || p.phase === "finalizing") return 100;
    if (p.filesTotal > 0) return Math.min(100, Math.round((100 * p.filesDone) / p.filesTotal));
    if (p.bytesTotal > 0) return Math.min(100, Math.round((100 * p.bytesDone) / p.bytesTotal));
    return 0;
  });

  const moveProgressFilesBytesLine = createMemo((): string | null => {
    const p = moveProgress();
    if (p == null) return null;
    return `${p.filesDone} / ${p.filesTotal} ${t("projectDetail.moveProjectProgressFiles") as string} · ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
  });

  createEffect(() => {
    if (ghQ.isPending) return;
    if (props.detailTab() === "issues" && ghQ.data == null) {
      props.onDetailTabChange("readme");
    }
  });

  const activeDetailTab = createMemo((): string => {
    const choice = props.detailTab();
    const gh = ghQ.data;
    if (choice === "issues" && gh == null) {
      return "readme";
    }
    return choice;
  });

  const showBanner = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 6000);
  };

  const showInfoBanner = (msg: string) => {
    setInfoBanner(msg);
    window.setTimeout(() => setInfoBanner(null), 12000);
  };

  const favMu = createMutation(() => ({
    mutationFn: async (p: { id: string; favorite: boolean }) => {
      const r = await setProjectFavorite({ id: p.id, favorite: p.favorite });
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        showBanner(stableErrorMessage(t, err as StableError));
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
    },
  }));

  const deleteMu = createMutation(() => ({
    mutationFn: async (id: string) => {
      const r = await deleteProjectTauri(id);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      props.onBack();
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        showBanner(stableErrorMessage(t, err as StableError));
      }
    },
  }));

  const runArgv = async (project: ProjectDto, argv: string[], confirmed: boolean) => {
    if (argvNeedsUserConfirmation(argv) && !confirmed) {
      setRisk({ project, argv });
      return;
    }
    const sessionId = crypto.randomUUID();
    const cmd = argv.join(" ");
    
    // Auto-attach to the terminal *immediately* so we start listening
    attachToTask(sessionId, cmd);

    const r = await spawnProjectTask({
      projectId: project.id,
      argv,
      acknowledgeRisk: confirmed,
      sessionId,
    });
    if (r.isErr()) {
      const err = r.error;
      if (err.code === "CONFIRM_REQUIRED") {
        setRisk({ project, argv });
        // Note: we already attached, but the dialog will show up and we can retry
        return;
      }
      showBanner(stableErrorMessage(t, err));
      return;
    }

    void qc.invalidateQueries({ queryKey: ["projects", props.projectId, "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

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

  const onStopTask = async (sessionId: string) => {
    const r = await embeddedTerminalKill(sessionId);
    if (r.isErr()) showBanner(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: ["projects", props.projectId, "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

  const onOpenProjectInFileManager = async (path: string) => {
    try {
      await openPath(path);
    } catch (e) {
      showBanner(`${t("library.openInFileManagerFailed") as string} ${String(e)}`);
    }
  };

  const onConfirmMove = async (project: ProjectDto) => {
    const id = moveTargetLocationId();
    if (id == null) {
      showBanner(t("projectDetail.moveProjectSelectLocation") as string);
      return;
    }
    const rows = moveLocationRows();
    const target = rows?.find((l) => l.id === id);
    if (target == null) {
      showBanner(t("projectDetail.moveProjectSelectLocation") as string);
      return;
    }
    if (target.sameAsProject) {
      showBanner(t("projectDetail.moveProjectSameLocation") as string);
      return;
    }
    if (import.meta.env.DEV) {
      console.debug("[project-vault][move] start", {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        destinationLocationId: target.id,
        destinationLocationName: target.name,
        destinationParent: target.path,
        destPreview: moveDestinationPreview(),
      });
    }
    setMoveBusy(true);
    setMoveProgress(null);
    setBanner(null);
    const unlisten = await listen<MoveProjectProgress>("move-project-progress", (e) => {
      if (e.payload.projectId !== project.id) return;
      if (import.meta.env.DEV) {
        console.debug("[project-vault][move] progress", e.payload);
      }
      setMoveProgress(e.payload);
    });
    try {
      const r = await moveProject({ projectId: project.id, destinationParent: target.path });
      if (import.meta.env.DEV) {
        console.debug("[project-vault][move] done", {
          newPath: r.isOk() ? r.value.project.path : undefined,
          error: r.isErr() ? r.error : undefined,
        });
      }
      if (r.isErr()) {
        showBanner(stableErrorMessage(t, r.error));
        return;
      }
      setMoveOpen(false);
      setMoveTargetLocationId(null);
      void qc.setQueryData(queryKeys.project(props.projectId), r.value.project);
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.githubRepo(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.projectReadme(props.projectId) });
      if (r.value.cleanupWarning != null && r.value.cleanupWarning.length > 0) {
        showInfoBanner(r.value.cleanupWarning);
      }
    } finally {
      unlisten();
      setMoveProgress(null);
      setMoveBusy(false);
    }
  };

  const onIdeSelected = (projectId: string, executable: string) => {
    setSelectedIdeExecutable(executable);
    localStorage.setItem(projectIdeStorageKey(projectId), executable);
  };

  const resetMoveDialog = () => {
    setMoveOpen(false);
    setMoveTargetLocationId(null);
    setMoveBusy(false);
    setMoveProgress(null);
  };

  const attachToTask = (sessionId: string, label: string) => {
    setTerminalAttachRequest({ sessionId, label });
    props.onDetailTabChange("terminal");
  };

  return {
    props,
    projectQ,
    gitStatusQ,
    pullMutate: () => pullMu.mutate(),
    pushMutate: () => pushMu.mutate(),
    isPulling: () => pullMu.isPending,
    isPushing: () => pushMu.isPending,
    sessionsQ,
    activeSessionsQ,
    idesQ,
    ghQ,
    miseToolsQ,
    locsQ,
    ideRunningQ,
    ideSelectOptions,
    selectedIdeOption,
    selectedIdeExecutable,
    setSelectedIdeExecutable,
    onIdeSelected,
    showBanner,
    showInfoBanner,
    banner,
    infoBanner,
    risk,
    setRisk,
    favMutate: (p: { id: string; favorite: boolean }) => favMu.mutate(p),
    deleteProject: (id: string) => deleteMu.mutate(id),
    runArgv,
    onStopTask,
    onShell,
    attachToTask,
    terminalAttachRequest,
    onOpenIde,
    onStopIde,
    onOpenProjectInFileManager,
    activeDetailTab,
    moveOpen,
    setMoveOpen,
    setMoveTargetLocationId,
    moveTargetLocationId,
    moveBusy,
    moveProgress,
    moveLocationRows,
    hasMovableTarget,
    moveSelectOptions,
    selectedMoveLocation,
    moveDestinationPreview,
    moveDialogDescription,
    moveProgressPhaseLabel,
    moveProgressBarPercent,
    moveProgressFilesBytesLine,
    onConfirmMove,
    resetMoveDialog,
    qc,
  };
}

export type ProjectDetailModel = ReturnType<typeof createProjectDetailModel>;
