import type { ScanResultDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function scanLibraryLocation(locationId: string) {
  return tauriInvoke<ScanResultDto>("scan_library_location", { locationId });
}

export type DebugScanResultDto = {
  raw: unknown[];
  filtered: unknown[];
  monoreposExpanded: number;
  workspaceWarnings: number;
};

export function debugScanLocation(path: string) {
  return tauriInvoke<DebugScanResultDto>("debug_scan_location", { path });
}
