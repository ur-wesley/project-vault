export type ConcurrentTask = {
  label: string;
  argv: string[];
  cwd?: string | null;
};

export type TaskDto = {
  id: string;
  label: string;
  argv: string[];
  kind: string;
  cwd: string | null;
  description?: string;
  depends: string[];
  source?: string;
  concurrent?: ConcurrentTask[];
};

export type ProjectTaskConfig = {
  tasks: TaskDto[];
  hasMiseConfig: boolean;
  hasJustfile: boolean;
  misePath: string | null;
  justfilePath: string | null;
};

export type SessionDto = {
  id: string;
  projectId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  command: string | null;
  state: string;
  rootPid: number | null;
  treePids: number[];
  exitCode: number | null;
  stopReason: string | null;
  lastEventAtMs: number;
};

export type StartSessionPayload = {
  projectId: string;
  command?: string | null;
  sessionId?: string;
};

export type SpawnProjectTaskPayload = {
  projectId: string;
  argv: string[];
  acknowledgeRisk: boolean;
  sessionId?: string;
  cwd?: string | null;
  concurrent?: ConcurrentTask[];
};

export type SpawnProjectTaskResponse = {
  sessionId: string;
  streamOutput: boolean;
};

