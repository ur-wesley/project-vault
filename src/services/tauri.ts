import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type {
  AddLocationPayload,
  CreateProjectPayload,
  CreateProjectResultDto,
  ExportSnapshotDto,
  GitHubDeviceStartDto,
  GitHubDeviceTokenDto,
  GitHubDeviceWaitPayload,
  GitHubRepoRefDto,
  GitStatusDto,
  ImportProjectPayload,
  IdeCandidateDto,
  LocationDto,
  LocationOrderEntry,
  MoveProjectPayload,
  MoveProjectResultDto,
  OpenProjectIdePayload,
  PathDiskSpaceDto,
  ProjectDto,
  ScanResultDto,
  SessionDto,
  SetFavoritePayload,
  SettingEntryDto,
  ShellCandidateDto,
  SpawnProjectTaskPayload,
  SpawnProjectTaskResponse,
  StartSessionPayload,
  TemplateSummaryDto,
  UpdateLocationPayload,
  MiseToolDto,
} from "~/types/dto";
import type { StableError } from "~/types/error";

function mapInvokeError(e: unknown): StableError {
  if (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    "message" in e &&
    typeof (e as StableError).code === "string" &&
    typeof (e as StableError).message === "string"
  ) {
    return e as StableError;
  }
  return { code: "INVOKE_FAILED", message: String(e) };
}

export function listLocations(): ResultAsync<LocationDto[], StableError> {
  return ResultAsync.fromPromise(invoke<LocationDto[]>("list_locations"), mapInvokeError);
}

export function diskSpaceForPaths(paths: string[]): ResultAsync<PathDiskSpaceDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<PathDiskSpaceDto[]>("disk_space_for_paths", { paths }),
    mapInvokeError,
  );
}

export function addLocation(payload: AddLocationPayload): ResultAsync<LocationDto, StableError> {
  return ResultAsync.fromPromise(invoke<LocationDto>("add_location", { payload }), mapInvokeError);
}

export function removeLocation(id: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("remove_location", { id }), mapInvokeError);
}

export function updateLocation(
  payload: UpdateLocationPayload,
): ResultAsync<LocationDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<LocationDto>("update_location", { payload }),
    mapInvokeError,
  );
}

export function reorderLocations(order: LocationOrderEntry[]): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("reorder_locations", { order }), mapInvokeError);
}

export function listProjects(): ResultAsync<ProjectDto[], StableError> {
  return ResultAsync.fromPromise(invoke<ProjectDto[]>("list_projects"), mapInvokeError);
}

export function getProject(id: string): ResultAsync<ProjectDto, StableError> {
  return ResultAsync.fromPromise(invoke<ProjectDto>("get_project", { id }), mapInvokeError);
}

export function getProjectLanguages(
  projectId: string,
): ResultAsync<Record<string, number>, StableError> {
  return ResultAsync.fromPromise(
    invoke<Record<string, number>>("get_project_languages", { projectId }),
    mapInvokeError,
  );
}

export function getGitHubRepoForProject(
  projectId: string,
): ResultAsync<GitHubRepoRefDto | null, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitHubRepoRefDto | null>("get_github_repo_for_project", { projectId }),
    mapInvokeError,
  );
}

export function getProjectMiseTools(projectId: string): ResultAsync<MiseToolDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<MiseToolDto[]>("get_project_mise_tools", { projectId }),
    mapInvokeError,
  );
}
export function isGithubDeviceConfigured(clientId?: string): ResultAsync<boolean, StableError> {
  return ResultAsync.fromPromise(
    invoke<boolean>("is_github_device_configured", { clientId: clientId ?? null }),
    mapInvokeError,
  );
}

export function startGithubDeviceFlow(
  clientId?: string,
): ResultAsync<GitHubDeviceStartDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitHubDeviceStartDto>("start_github_device_flow", { clientId: clientId ?? null }),
    mapInvokeError,
  );
}

export function waitGithubDeviceFlow(
  payload: GitHubDeviceWaitPayload,
  clientId?: string,
): ResultAsync<GitHubDeviceTokenDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitHubDeviceTokenDto>("wait_github_device_flow", {
      payload,
      clientId: clientId ?? null,
    }),
    mapInvokeError,
  );
}

export function upsertProject(project: ProjectDto): ResultAsync<ProjectDto, StableError> {
  return ResultAsync.fromPromise(invoke<ProjectDto>("upsert_project", { project }), mapInvokeError);
}

export function deleteProject(id: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("delete_project", { id }), mapInvokeError);
}

export function setProjectFavorite(
  payload: SetFavoritePayload,
): ResultAsync<ProjectDto, StableError> {

  return ResultAsync.fromPromise(
    invoke<ProjectDto>("set_project_favorite", { payload }),
    mapInvokeError,
  );
}

export function touchProjectOpened(id: string): ResultAsync<ProjectDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<ProjectDto>("touch_project_opened", { id }),
    mapInvokeError,
  );
}

export function startSession(payload: StartSessionPayload): ResultAsync<SessionDto, StableError> {
  return ResultAsync.fromPromise(invoke<SessionDto>("start_session", { payload }), mapInvokeError);
}

export function endSession(sessionId: string): ResultAsync<SessionDto, StableError> {
  return ResultAsync.fromPromise(invoke<SessionDto>("end_session", { sessionId }), mapInvokeError);
}

export function listSessionsForProject(
  projectId: string,
  limit: number,
): ResultAsync<SessionDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<SessionDto[]>("list_sessions_for_project", { projectId, limit }),
    mapInvokeError,
  );
}

export function listActiveSessions(projectId: string): ResultAsync<SessionDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<SessionDto[]>("list_active_sessions", { project_id: projectId }),
    mapInvokeError,
  );
}

export function recoverOrphanSessions(): ResultAsync<number, StableError> {
  return ResultAsync.fromPromise(invoke<number>("recover_orphan_sessions"), mapInvokeError);
}

export function scanLibraryLocation(locationId: string): ResultAsync<ScanResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<ScanResultDto>("scan_library_location", { locationId }),
    mapInvokeError,
  );
}

export function pickLibraryFolder(): ResultAsync<string | null, StableError> {
  return ResultAsync.fromPromise(invoke<string | null>("pick_library_folder"), mapInvokeError);
}

export function pickProjectParentFolder(): ResultAsync<string | null, StableError> {
  return ResultAsync.fromPromise(
    invoke<string | null>("pick_project_parent_folder"),
    mapInvokeError,
  );
}

export function moveProject(
  payload: MoveProjectPayload,
): ResultAsync<MoveProjectResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<MoveProjectResultDto>("move_project", { payload }),
    mapInvokeError,
  );
}

export function listProjectTemplates(): ResultAsync<TemplateSummaryDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<TemplateSummaryDto[]>("list_project_templates"),
    mapInvokeError,
  );
}

export function createProjectFromTemplate(
  payload: CreateProjectPayload,
): ResultAsync<CreateProjectResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<CreateProjectResultDto>("create_project_from_template", { payload }),
    mapInvokeError,
  );
}

export function spawnProjectTask(
  payload: SpawnProjectTaskPayload,
): ResultAsync<SpawnProjectTaskResponse, StableError> {
  return ResultAsync.fromPromise(
    invoke<SpawnProjectTaskResponse>("spawn_project_task", { payload }),
    mapInvokeError,
  );
}

export function openProjectShell(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("open_project_shell", { payload: { projectId } }),
    mapInvokeError,
  );
}

export function listDiscoveredIdes(): ResultAsync<IdeCandidateDto[], StableError> {
  return ResultAsync.fromPromise(invoke<IdeCandidateDto[]>("list_discovered_ides"), mapInvokeError);
}

export function listRunningProjects(): ResultAsync<string[], StableError> {
  return ResultAsync.fromPromise(invoke<string[]>("list_running_projects"), mapInvokeError);
}

export function getGitStatus(projectId: string): ResultAsync<GitStatusDto | null, StableError> {
  return ResultAsync.fromPromise(invoke<GitStatusDto | null>("get_git_status", { projectId }), mapInvokeError);
}

export function gitPull(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("git_pull", { projectId }), mapInvokeError);
}

export function gitPush(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("git_push", { projectId }), mapInvokeError);
}

export function importProject(payload: ImportProjectPayload): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("import_project", { payload }), mapInvokeError);
}

export function openProjectInIde(payload: OpenProjectIdePayload): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("open_project_in_ide", { payload }), mapInvokeError);
}

export function stopProjectIde(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("stop_project_ide", { projectId }), mapInvokeError);
}

export function isProjectIdeRunning(projectId: string): ResultAsync<boolean, StableError> {
  return ResultAsync.fromPromise(invoke<boolean>("is_project_ide_running", { projectId }), mapInvokeError);
}

export function embeddedTerminalSpawn(
  projectId: string,
  shell?: string,
): ResultAsync<string, StableError> {
  return ResultAsync.fromPromise(
    invoke<string>("embedded_terminal_spawn", { projectId, shell: shell ?? null }),
    mapInvokeError,
  );
}

export function listAvailableShells(): ResultAsync<ShellCandidateDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<ShellCandidateDto[]>("list_available_shells"),
    mapInvokeError,
  );
}

export function embeddedTerminalWrite(
  sessionId: string,
  data: string,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("embedded_terminal_write", { sessionId, data }),
    mapInvokeError,
  );
}

export function embeddedTerminalResize(
  sessionId: string,
  rows: number,
  cols: number,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("embedded_terminal_resize", { sessionId, rows, cols }),
    mapInvokeError,
  );
}

export function embeddedTerminalKill(sessionId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("embedded_terminal_kill", { sessionId }),
    mapInvokeError,
  );
}

export function getSetting(key: string): ResultAsync<string | null, StableError> {
  return ResultAsync.fromPromise(invoke<string | null>("get_setting", { key }), mapInvokeError);
}

export function setSetting(key: string, value: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("set_setting", { key, value }), mapInvokeError);
}

export function listSettings(): ResultAsync<SettingEntryDto[], StableError> {
  return ResultAsync.fromPromise(invoke<SettingEntryDto[]>("list_settings"), mapInvokeError);
}

export function exportLibrarySnapshot(): ResultAsync<ExportSnapshotDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<ExportSnapshotDto>("export_library_snapshot"),
    mapInvokeError,
  );
}
