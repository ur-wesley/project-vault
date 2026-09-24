import { createEffect, createMemo } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { prunePinnedProjects, usePinnedProjects } from "~/lib/project-pins";
import type { PinnedTabProject } from "~/components/ProjectTabsBar";
import { buildStacksList } from "~/features/library/filter-projects";
import { useI18n } from "~/lib/i18n-context";
import { listProjects } from "~/services/tauri/projects";
import { listLocations } from "~/services/tauri/locations";
import { getSetting } from "~/services/tauri/settings";
import { isGithubDeviceConfigured } from "~/services/tauri/github-auth";
import { listAllProcesses } from "~/services/tauri/sessions";
import { fetchGitHubViewer } from "~/services/github";
import { queryKeys } from "~/services/query-keys";

export type ProjectFilterOption = { value: string; label: string; textValue: string };
export type TFunction = ReturnType<typeof useI18n>["t"];
export type SetLocaleFn = ReturnType<typeof useI18n>["setLocale"];

/**
 * Sidebar/app-shell server state: queries, pinned tabs, filter options,
 * process counts. (Extracted verbatim from App.)
 */
export function useSidebarData(opts: { t: TFunction }) {
  const { t } = opts;

  const locQ = createQuery(() => ({
    queryKey: queryKeys.locations,
    queryFn: async () => {
      const r = await listLocations();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const projectsQ = createQuery(() => ({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const r = await listProjects();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const scanMinsQ = createQuery(() => ({
    queryKey: ["settings", "scan_interval_minutes"] as const,
    queryFn: async () => {
      const r = await getSetting("scan_interval_minutes");
      if (r.isErr()) throw new Error(r.error.message);
      const v = parseInt(r.value ?? "0", 10);
      return Number.isFinite(v) ? v : 0;
    },
  }));

  const densityQ = createQuery(() => ({
    queryKey: ["settings", "ui_density"] as const,
    queryFn: async () => {
      const r = await getSetting("ui_density");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value === "compact" ? "compact" : "comfortable";
    },
  }));

  const projectTabsEnabledQ = createQuery(() => ({
    queryKey: ["settings", "ui_project_tabs_enabled"] as const,
    queryFn: async () => {
      const r = await getSetting("ui_project_tabs_enabled");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value !== "false";
    },
  }));

  const processesQ = createQuery(() => ({
    queryKey: ["processes", "all"] as const,
    queryFn: async () => {
      const r = await listAllProcesses();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 3000,
    enabled: isTauri(),
  }));

  const pluginsQ = createQuery(() => ({
    queryKey: ["plugins", "list"] as const,
    queryFn: async () => {
      if (!isTauri()) return [];
      return invoke<
        Array<{
          id: string;
          name: string;
          enabled: boolean;
          pages: Array<{
            id: string;
            title: string;
            icon?: string;
            defaultPinned: boolean;
            command?: string;
          }>;
        }>
      >("list_plugins");
    },
    enabled: isTauri(),
    // Plugin metadata rarely changes; invalidated on plugin:reload /
    // plugin:status-changed. Avoids re-running the expensive backend scan
    // (fresh Lua eval per plugin) on every navigation.
    staleTime: 30_000,
  }));

  const ghDeviceReadyQ = createQuery(() => ({
    queryKey: ["app", "github", "device", "ready"] as const,
    queryFn: async () => {
      if (!isTauri()) return false;
      const envId = import.meta.env.VITE_GITHUB_DEVICE_CLIENT_ID;
      const r = await isGithubDeviceConfigured(envId);
      if (r.isErr()) return false;
      return r.value;
    },
  }));

  const ghViewerQ = createQuery(() => ({
    queryKey: queryKeys.githubViewer(),
    queryFn: async () => {
      if (!isTauri()) return null;
      const r = await fetchGitHubViewer();
      if (r.isErr()) {
        if (r.error.code === "GITHUB_UNAUTHORIZED") return null;
        throw new Error(r.error.message);
      }
      return r.value;
    },
    staleTime: 60_000 * 2,
  }));

  const pins = usePinnedProjects();
  const tabsEnabled = createMemo(() => projectTabsEnabledQ.data ?? true);

  const pinnedTabs = createMemo((): PinnedTabProject[] => {
    const byId = new Map((projectsQ.data ?? []).map((p) => [p.id, p]));
    const runningIds = new Set(
      (processesQ.data ?? [])
        .filter((p) => p.state === "running" || p.state === "starting")
        .map((p) => p.projectId),
    );
    const out: PinnedTabProject[] = [];
    for (const id of pins()) {
      const p = byId.get(id);
      if (!p) continue;
      out.push({
        id: p.id,
        name: p.name,
        path: p.path,
        stack: p.stack,
        iconPath: p.iconPath,
        running: runningIds.has(p.id),
      });
    }
    return out;
  });

  const showTabs = createMemo(() => tabsEnabled() && pinnedTabs().length > 0);

  // Drop pins for projects that no longer exist.
  createEffect(() => {
    const projects = projectsQ.data;
    if (!projects) return;
    const existing = new Set(projects.map((p) => p.id));
    if (pins().some((id) => !existing.has(id))) {
      prunePinnedProjects(existing);
    }
  });

  const runningProcessCount = createMemo(
    () =>
      (processesQ.data ?? []).filter((p) => p.state === "running" || p.state === "starting").length,
  );

  // Auto-refresh projects when active processes change
  const runningProcessIds = createMemo(() =>
    (processesQ.data ?? [])
      .filter((p) => p.state === "running" || p.state === "starting")
      .map((p) => p.sessionId)
      .sort()
      .join(","),
  );

  const filterOptions = createMemo((): ProjectFilterOption[] => {
    const out: ProjectFilterOption[] = [
      {
        value: "all",
        label: t("library.filterAll") as string,
        textValue: `all ${t("library.filterAll")}`,
      },
      {
        value: "touched-10d",
        label: t("library.filterTouched10d") as string,
        textValue: `touched ${t("library.filterTouched10d")}`,
      },
      {
        value: "favorites",
        label: t("library.filterFavorites") as string,
        textValue: `favorites ${t("library.filterFavorites")}`,
      },
      {
        value: "recent",
        label: t("library.filterRecent") as string,
        textValue: `recent ${t("library.filterRecent")}`,
      },
      { value: "git", label: "Git", textValue: "git" },
      { value: "github", label: "GitHub", textValue: "github" },
    ];
    if (ghViewerQ.data) {
      out.push({
        value: "own",
        label: t("library.filterMyRepos") as string,
        textValue: "own my repos",
      });
    }
    for (const loc of locQ.data ?? []) {
      out.push({ value: `loc:${loc.id}`, label: loc.name, textValue: loc.name });
    }
    const stacks = buildStacksList(projectsQ.data ?? []);
    for (const st of stacks) {
      out.push({ value: `stack:${st}`, label: st, textValue: st });
    }
    return out;
  });

  return {
    locQ,
    projectsQ,
    scanMinsQ,
    densityQ,
    projectTabsEnabledQ,
    processesQ,
    pluginsQ,
    ghDeviceReadyQ,
    ghViewerQ,
    pinnedTabs,
    showTabs,
    runningProcessCount,
    runningProcessIds,
    filterOptions,
  };
}
