import { getSetting, setSetting } from "~/services/tauri/settings";

export const CLEANER_SETTING_KEYS = {
  unusedDays: "project_cleaner_unused_days",
  protectRecentDays: "project_cleaner_protect_recent_days",
  protectFavorites: "project_cleaner_protect_favorites",
  minPlaytimeMs: "project_cleaner_min_playtime_ms",
} as const;

export type ProjectCleanerThresholds = {
  unusedDays: number;
  protectRecentDays: number;
  protectFavorites: boolean;
  minPlaytimeMs: number;
};

export const DEFAULT_CLEANER_THRESHOLDS: ProjectCleanerThresholds = {
  unusedDays: 90,
  protectRecentDays: 30,
  protectFavorites: true,
  minPlaytimeMs: 300_000,
};

export async function loadCleanerThresholds(): Promise<ProjectCleanerThresholds> {
  const [unused, recent, favorites, playtime] = await Promise.all([
    getSetting(CLEANER_SETTING_KEYS.unusedDays),
    getSetting(CLEANER_SETTING_KEYS.protectRecentDays),
    getSetting(CLEANER_SETTING_KEYS.protectFavorites),
    getSetting(CLEANER_SETTING_KEYS.minPlaytimeMs),
  ]);

  return {
    unusedDays:
      unused.isOk() && unused.value != null
        ? Number.parseInt(unused.value, 10) || DEFAULT_CLEANER_THRESHOLDS.unusedDays
        : DEFAULT_CLEANER_THRESHOLDS.unusedDays,
    protectRecentDays:
      recent.isOk() && recent.value != null
        ? Number.parseInt(recent.value, 10) || DEFAULT_CLEANER_THRESHOLDS.protectRecentDays
        : DEFAULT_CLEANER_THRESHOLDS.protectRecentDays,
    protectFavorites:
      favorites.isOk() && favorites.value != null
        ? favorites.value === "true"
        : DEFAULT_CLEANER_THRESHOLDS.protectFavorites,
    minPlaytimeMs:
      playtime.isOk() && playtime.value != null
        ? Number.parseInt(playtime.value, 10) || DEFAULT_CLEANER_THRESHOLDS.minPlaytimeMs
        : DEFAULT_CLEANER_THRESHOLDS.minPlaytimeMs,
  };
}

export async function saveCleanerThresholds(thresholds: ProjectCleanerThresholds): Promise<void> {
  await Promise.all([
    setSetting(CLEANER_SETTING_KEYS.unusedDays, String(thresholds.unusedDays)),
    setSetting(CLEANER_SETTING_KEYS.protectRecentDays, String(thresholds.protectRecentDays)),
    setSetting(
      CLEANER_SETTING_KEYS.protectFavorites,
      thresholds.protectFavorites ? "true" : "false",
    ),
    setSetting(CLEANER_SETTING_KEYS.minPlaytimeMs, String(thresholds.minPlaytimeMs)),
  ]);
}
