import type {
  ProjectCleanerExecutePayload,
  ProjectCleanerExecuteResult,
  ProjectCleanerScanOptions,
  ProjectCleanerScanResult,
} from "~/types/dto";
import { tauriInvoke } from "./utils";

export function projectCleanerScan(options: ProjectCleanerScanOptions) {
  return tauriInvoke<ProjectCleanerScanResult>("project_cleaner_scan", { options });
}

export function projectCleanerExecute(payload: ProjectCleanerExecutePayload) {
  return tauriInvoke<ProjectCleanerExecuteResult>("project_cleaner_execute", { payload });
}
