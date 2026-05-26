import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, type Accessor } from "solid-js";
import { listSessionsForProject, listActiveSessions, clearSessionsForProject, getSessionCountForProject } from "~/services/tauri/sessions";
import { spawnProjectTask, stopProjectTask } from "~/services/tauri/tasks";
import { queryKeys } from "~/services/query-keys";
import { stableErrorMessage } from "~/lib/invoke-error";
import { argvNeedsUserConfirmation } from "~/lib/task-risk";
import type { ProjectDto, ConcurrentTask } from "~/types/dto";

export type UseProjectTasksProps = Readonly<{
  projectId: Accessor<string>;
  t: (key: string, args?: any) => string;
  showBanner: (msg: string) => void;
  attachToTask: (sessionId: string, label: string, focus?: boolean) => void;
}>;

type SessionState = "running" | "starting" | "success" | "error" | "cancelled" | "unknown";
const PAGE_SIZE = 20;

export function useProjectTasks(props: UseProjectTasksProps) {
  const qc = useQueryClient();
  const [risk, setRisk] = createSignal<{
    project: ProjectDto;
    argv: string[];
    cwd?: string | null;
  } | null>(null);
  const [page, setPage] = createSignal(0);
  const [statusFilter, setStatusFilter] = createSignal<SessionState | "all">("all");

  const sessionsQ = createQuery(() => ({
    queryKey: queryKeys.sessions(props.projectId(), page()),
    queryFn: async () => {
      const r = await listSessionsForProject(props.projectId(), PAGE_SIZE, page() * PAGE_SIZE);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const filteredSessions = createMemo(() => {
    const data = sessionsQ.data ?? [];
    const filter = statusFilter();
    if (filter === "all") return data;
    return data.filter((s) => s.state === filter);
  });

  const totalCountQ = createQuery(() => ({
    queryKey: ["projects", props.projectId(), "sessions-count"] as const,
    queryFn: async () => {
      const r = await getSessionCountForProject(props.projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const filteredCountQ = createQuery(() => ({
    queryKey: ["projects", props.projectId(), "sessions-filtered-count", statusFilter()] as const,
    queryFn: async () => {
      const filter = statusFilter();
      if (filter === "all") return totalCountQ.data ?? 0;
      const r = await getSessionCountForProject(props.projectId(), filter);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: statusFilter() !== "all",
  }));

  const totalCount = createMemo(() => totalCountQ.data ?? 0);
  const filteredCount = createMemo(() => filteredCountQ.data ?? 0);

  const clearSessionsMu = createMutation(() => ({
    mutationFn: async () => {
      const r = await clearSessionsForProject(props.projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId()) });
      void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "sessions-count"] });
      props.showBanner(`${props.t("history.cleared") as string}`);
    },
    onError: (err: unknown) => {
      props.showBanner(stableErrorMessage(props.t, err as StableError));
    },
  }));

  const activeSessionsQ = createQuery(() => ({
    queryKey: ["projects", props.projectId(), "active-sessions"] as const,
    queryFn: async () => {
      const r = await listActiveSessions(props.projectId());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const runArgv = async (
    project: ProjectDto,
    argv: string[],
    confirmed: boolean,
    cwd?: string | null,
    concurrent?: ConcurrentTask[] | null,
    focus = false,
  ) => {
    const isConcurrent = concurrent && concurrent.length > 0;

    if (!isConcurrent && argvNeedsUserConfirmation(argv) && !confirmed) {
      setRisk({ project, argv, cwd });
      return;
    }
    const sessionId = crypto.randomUUID();
    const cmd = isConcurrent
      ? concurrent.map((s) => s.label).join(" + ")
      : argv.join(" ");

    const r = await spawnProjectTask({
      projectId: project.id,
      argv: isConcurrent ? [] : argv,
      acknowledgeRisk: confirmed,
      sessionId,
      cwd: cwd ?? null,
      concurrent: isConcurrent ? concurrent : undefined,
    });
    if (r.isErr()) {
      const err = r.error;
      if (err.code === "CONFIRM_REQUIRED") {
        setRisk({ project, argv });
        return;
      }
      props.showBanner(stableErrorMessage(props.t, err));
      return;
    }

    props.attachToTask(sessionId, cmd, focus);

    void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
  };

  const onStopTask = async (sessionId: string) => {
    const r = await stopProjectTask(sessionId);
    if (r.isErr()) props.showBanner(stableErrorMessage(props.t, r.error));
    void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "active-sessions"] });
    void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "sessions-count"] });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
  };

  const restartArgv = async (
    project: ProjectDto,
    argv: string[],
    cwd?: string | null,
    concurrent?: ConcurrentTask[] | null,
    currentSessionId?: string,
  ) => {
    if (currentSessionId) {
      const r = await stopProjectTask(currentSessionId);
      if (r.isErr()) {
        props.showBanner(stableErrorMessage(props.t, r.error));
        return;
      }
      void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "active-sessions"] });
    }
    await runArgv(project, argv, true, cwd, concurrent, false);
  };

  return {
    sessionsQ,
    activeSessionsQ,
    filteredSessions,
    totalCountQ,
    filteredCountQ,
    totalCount,
    filteredCount,
    page,
    setPage,
    statusFilter,
    setStatusFilter,
    runArgv,
    onStopTask,
    restartArgv,
    risk,
    setRisk,
    clearSessionsMu,
  };
}
