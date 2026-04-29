import { listen } from "@tauri-apps/api/event";
import { createMemo, createSignal, type Accessor } from "solid-js";
import { useQueryClient, createQuery } from "@tanstack/solid-query";
import { listLocations, moveProject } from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { stableErrorMessage } from "~/lib/invoke-error";
import { formatBytes } from "~/lib/format-bytes";
import { isSameProjectDestination, joinParentName, pathBasename } from "../lib/paths";
import type { LocationDto, MoveProjectProgress, ProjectDto } from "~/types/dto";
import type { MoveLocationOption } from "../types";

export type UseProjectMoveProps = Readonly<{
  projectId: Accessor<string>;
  t: (key: string, args?: any) => string;
  showBanner: (msg: string) => void;
  showInfoBanner: (msg: string) => void;
  project: () => ProjectDto | undefined;
}>;

export function useProjectMove(props: UseProjectMoveProps) {
  const qc = useQueryClient();
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [moveTargetLocationId, setMoveTargetLocationId] = createSignal<string | null>(null);
  const [moveBusy, setMoveBusy] = createSignal(false);
  const [moveProgress, setMoveProgress] = createSignal<MoveProjectProgress | null>(null);

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
      const p = props.project();
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
          ? ` — ${props.t("projectDetail.moveProjectCurrentLocation")}`
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
    const p = props.project();
    const id = moveTargetLocationId();
    if (p == null || id == null) return null;
    const row = moveLocationRows()?.find((l) => l.id === id);
    if (row == null) return null;
    return joinParentName(row.path, pathBasename(p.path));
  });

  const moveDialogDescription = createMemo(
    (): string =>
      (moveBusy()
        ? props.t("projectDetail.moveProjectProgressDescription")
        : props.t("projectDetail.moveProjectDescription")),
  );

  const moveProgressPhaseLabel = createMemo((): string => {
    const p = moveProgress();
    if (p == null) return props.t("projectDetail.moveProjectStarting");
    switch (p.phase) {
      case "preparing":
        return props.t("projectDetail.movePhasePreparing");
      case "copying":
        return props.t("projectDetail.movePhaseCopying");
      case "verifying":
        return props.t("projectDetail.movePhaseVerifying");
      case "finalizing":
        return props.t("projectDetail.movePhaseFinalizing");
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
    return `${p.filesDone} / ${p.filesTotal} ${props.t("projectDetail.moveProjectProgressFiles")} · ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
  });

  const onConfirmMove = async (project: ProjectDto) => {
    const id = moveTargetLocationId();
    if (id == null) {
      props.showBanner(props.t("projectDetail.moveProjectSelectLocation"));
      return;
    }
    const rows = moveLocationRows();
    const target = rows?.find((l) => l.id === id);
    if (target == null) {
      props.showBanner(props.t("projectDetail.moveProjectSelectLocation"));
      return;
    }
    if (target.sameAsProject) {
      props.showBanner(props.t("projectDetail.moveProjectSameLocation"));
      return;
    }
    
    setMoveBusy(true);
    setMoveProgress(null);
    const unlisten = await listen<MoveProjectProgress>("move-project-progress", (e) => {
      if (e.payload.projectId !== project.id) return;
      setMoveProgress(e.payload);
    });
    try {
      const r = await moveProject({ projectId: project.id, destinationParent: target.path });
      if (r.isErr()) {
        props.showBanner(stableErrorMessage(props.t, r.error));
        return;
      }
      setMoveOpen(false);
      setMoveTargetLocationId(null);
      void qc.setQueryData(queryKeys.project(props.projectId()), r.value.project);
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId()) });
      void qc.invalidateQueries({ queryKey: queryKeys.githubRepo(props.projectId()) });
      void qc.invalidateQueries({ queryKey: queryKeys.projectReadme(props.projectId()) });
      if (r.value.cleanupWarning != null && r.value.cleanupWarning.length > 0) {
        props.showInfoBanner(r.value.cleanupWarning);
      }
    } finally {
      unlisten();
      setMoveProgress(null);
      setMoveBusy(false);
    }
  };

  const resetMoveDialog = () => {
    setMoveOpen(false);
    setMoveTargetLocationId(null);
    setMoveBusy(false);
    setMoveProgress(null);
  };

  return {
    locsQ,
    moveOpen,
    setMoveOpen,
    moveTargetLocationId,
    setMoveTargetLocationId,
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
  };
}
