import type { SettingEntryDto } from "~/types/dto";
import { tauriInvoke } from "./utils";

export function getSetting(key: string) {
  return tauriInvoke<string | null>("get_setting", { key });
}

export function setSetting(key: string, value: string) {
  return tauriInvoke<void>("set_setting", { key, value });
}

export function listSettings() {
  return tauriInvoke<SettingEntryDto[]>("list_settings");
}

export function getAppDataDir() {
  return tauriInvoke<string>("get_app_data_dir");
}
