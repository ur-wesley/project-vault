import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type { FileStatDto, TextFileDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

/**
 * Project file IO. Reads/writes go through Rust so saves are atomic, binary
 * detection and size caps are enforced in one place, and the search index can
 * be invalidated alongside the change.
 *
 * Paths must live inside the project root; the backend rejects traversal.
 */

export function readTextFile(projectId: string, path: string) {
  return tauriInvoke<TextFileDto>("read_text_file", { projectId, path });
}

export function writeTextFile(projectId: string, path: string, content: string) {
  return tauriInvoke<FileStatDto>("write_text_file", { projectId, path, content });
}

export function fileStat(projectId: string, path: string) {
  return tauriInvoke<FileStatDto>("file_stat", { projectId, path });
}

export function createProjectFile(projectId: string, path: string) {
  return tauriInvoke<FileStatDto>("create_project_file", { projectId, path });
}

export function createProjectFolder(projectId: string, path: string) {
  return tauriInvoke<FileStatDto>("create_project_folder", { projectId, path });
}

export function renameProjectPath(projectId: string, from: string, to: string) {
  return tauriInvoke<FileStatDto>("rename_project_path", { projectId, from, to });
}

export function deleteProjectPath(projectId: string, path: string) {
  return tauriInvoke<void>("delete_project_path", { projectId, path });
}

/**
 * Register the open editor files with the backend watcher. The backend emits
 * `file:external-changed` when one of them is modified outside the app.
 */
export function watchProjectFiles(paths: readonly string[]) {
  return ResultAsync.fromPromise(invoke<void>("watch_project_files", { paths: [...paths] }), (e) =>
    String(e),
  );
}
