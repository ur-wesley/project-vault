import { tauriInvoke } from "./utils";

export type UpdateInfoDto = {
  version: string;
  currentVersion: string;
  notes: string;
};

export function checkForUpdates() {
  return tauriInvoke<UpdateInfoDto | null>("check_for_updates");
}

export function installUpdate() {
  return tauriInvoke<void>("install_update");
}
