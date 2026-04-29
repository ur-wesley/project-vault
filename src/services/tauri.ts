import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type {
  AddLocationPayload,
  BumpVersionAndTagPayload,
  CreateProjectPayload,
  CreateProjectResultDto,
  DiscoverVersionFilesResultDto,
  ExportSnapshotDto,
  GitPreviewVersionsDto,
  GitHubDeviceStartDto,
  GitHubDeviceTokenDto,
  GitHubDeviceWaitPayload,
  GitHubRepoRefDto,
  GitStatusDto,
  GitTagResultDto,
  ImportProjectPayload,
  IdeCandidateDto,
  LocationDto,
  LocationOrderEntry,
  MoveProjectPayload,
  MoveProjectResultDto,
  OpenProjectIdePayload,
  PathDiskSpaceDto,
  ProjectDto,
  RunTemplateCommandPayload,
  RunTemplateCommandResultDto,
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
  MiseToolSuggestionDto,
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

export function suggestMiseTools(projectId: string): ResultAsync<MiseToolSuggestionDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<MiseToolSuggestionDto[]>("suggest_mise_tools", { projectId }),
    mapInvokeError,
  );
}

export function pinMiseTools(projectId: string, tools: MiseToolSuggestionDto[]): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("pin_mise_tools", { payload: { projectId, tools } }),
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

export function deleteProject(id: string, deleteFromDisk = false): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("delete_project", { payload: { id, deleteFromDisk } }),
    mapInvokeError,
  );
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
  offset: number,
): ResultAsync<SessionDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<SessionDto[]>("list_sessions_for_project", { projectId, limit, offset }),
    mapInvokeError,
  );
}

export function listActiveSessions(projectId: string): ResultAsync<SessionDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<SessionDto[]>("list_active_sessions", { project_id: projectId }),
    mapInvokeError,
  );
}

export type ProcessDto = {
  sessionId: string;
  projectId: string;
  projectName: string;
  command: string | null;
  state: string;
  rootPid: number | null;
  ports: number[];
  startedAtMs: number;
  lastEventAtMs: number;
  kind: string;
};

export function listAllProcesses(): ResultAsync<ProcessDto[], StableError> {
  return ResultAsync.fromPromise(invoke<ProcessDto[]>("list_all_processes"), mapInvokeError);
}

export function clearSessionsForProject(projectId: string): ResultAsync<number, StableError> {
  return ResultAsync.fromPromise(
    invoke<number>("clear_sessions_for_project", { projectId }),
    mapInvokeError,
  );
}

export function getSessionCountForProject(
  projectId: string,
  stateFilter?: string,
): ResultAsync<number, StableError> {
  return ResultAsync.fromPromise(
    invoke<number>("get_session_count_for_project", { projectId, stateFilter }),
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

export type DebugScanResultDto = {
  raw: ProjectDraft[];
  filtered: ProjectDraft[];
  monoreposExpanded: number;
  workspaceWarnings: number;
};

export function debugScanLocation(path: string): ResultAsync<DebugScanResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<DebugScanResultDto>("debug_scan_location", { path }),
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

export function saveProjectTemplates(templatesJson: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("save_project_templates", { templatesJson }),
    mapInvokeError,
  );
}

export function runTemplateCommand(
  payload: RunTemplateCommandPayload,
): ResultAsync<RunTemplateCommandResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<RunTemplateCommandResultDto>("run_template_command", { payload }),
    mapInvokeError,
  );
}

export function openShellAtPath(path: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("open_shell_at_path", { payload: { path } }),
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

export function stopProjectTask(sessionId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("stop_project_task", { sessionId }),
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

export function gitInit(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("git_init", { projectId }), mapInvokeError);
}

export function gitTagAndPush(
  projectId: string,
  bump: "patch" | "minor" | "major",
): ResultAsync<GitTagResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitTagResultDto>("git_tag_and_push", { projectId, bump }),
    mapInvokeError,
  );
}

export function gitPreviewVersions(
  projectId: string,
): ResultAsync<GitPreviewVersionsDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitPreviewVersionsDto>("git_preview_versions", { projectId }),
    mapInvokeError,
  );
}

export function gitDiscoverVersionFiles(
  projectId: string,
  bump: "patch" | "minor" | "major",
): ResultAsync<DiscoverVersionFilesResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<DiscoverVersionFilesResultDto>("git_discover_version_files", { projectId, bump }),
    mapInvokeError,
  );
}

export function gitBumpVersionAndTag(
  projectId: string,
  payload: BumpVersionAndTagPayload,
): ResultAsync<GitTagResultDto, StableError> {
  return ResultAsync.fromPromise(
    invoke<GitTagResultDto>("git_bump_version_and_tag", { projectId, payload }),
    mapInvokeError,
  );
}

export function importProject(payload: ImportProjectPayload): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("import_project", { payload }), mapInvokeError);
}

export function openProjectInIde(payload: OpenProjectIdePayload): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(invoke<void>("open_project_in_ide", { payload }), mapInvokeError);
}

export function stopProjectIde(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("stop_project_ide", { projectId }),
    mapInvokeError,
  );
}

export function stopAllProjectProcesses(projectId: string): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("stop_all_project_processes", { projectId }),
    mapInvokeError,
  );
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

export function listDiscoveredTools(): ResultAsync<ToolCandidateDto[], StableError> {
  return ResultAsync.fromPromise(
    invoke<ToolCandidateDto[]>("list_discovered_tools"),
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

export function getAppDataDir(): ResultAsync<string, StableError> {
  return ResultAsync.fromPromise(invoke<string>("get_app_data_dir"), mapInvokeError);
}

export function readProjectTaskConfig(
  projectId: string,
): ResultAsync<ProjectTaskConfig, StableError> {
  return ResultAsync.fromPromise(
    invoke<ProjectTaskConfig>("read_project_task_config", { projectId }),
    mapInvokeError,
  );
}

export function writeProjectTask(
  projectId: string,
  task: TaskDto,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("write_project_task", { payload: { projectId, task } }),
    mapInvokeError,
  );
}

export function deleteProjectTask(
  projectId: string,
  task: TaskDto,
): ResultAsync<void, StableError> {
  return ResultAsync.fromPromise(
    invoke<void>("delete_project_task", { payload: { projectId, task } }),
    mapInvokeError,
  );
}
