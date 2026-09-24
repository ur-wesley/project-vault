import { createEffect, on } from "solid-js";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { invoke } from "@tauri-apps/api/core";

import {
  pushUrlToLibrary,
  pushUrlToPluginPage,
  pushUrlToProcesses,
  pushUrlToProject,
  pushUrlToSettings,
  readAppUrl,
  type AppView,
  type ProjectDetailTab,
} from "~/lib/app-url";
import { lastTabFor, rememberTab } from "~/lib/project-last-tab";
import { broadcastActiveProject } from "~/features/canvas";
import { touchProjectViewed } from "~/services/tauri/projects";
import type { ProjectDto } from "~/types/dto";
import { queryKeys } from "~/services/query-keys";

export type PluginListEntry = {
  id: string;
  pages?: Array<{
    id: string;
    title: string;
    icon?: string;
    defaultPinned: boolean;
    command?: string;
  }>;
};

/**
 * App-shell routing domain: view/id/tab signals, navigation functions,
 * plugin-page command dispatch, URL bar sync. (Extracted verbatim from App.)
 */
export function useAppRouting(opts: { plugins: Accessor<PluginListEntry[] | undefined> }) {
  const qc = useQueryClient();
  const initialUrl = readAppUrl();
  const [activeView, setActiveView] = createSignal<AppView>(initialUrl.view);
  const [projectDetailId, setProjectDetailId] = createSignal<string | null>(initialUrl.projectId);
  const [detailTab, setDetailTab] = createSignal(initialUrl.tab);
  const [subDetail, setSubDetail] = createSignal<string | null>(initialUrl.subDetail);
  const [settingsTab, setSettingsTab] = createSignal(initialUrl.settingsTab);
  const [pluginPagePluginId, setPluginPagePluginId] = createSignal<string | null>(
    initialUrl.pluginId,
  );
  const [pluginPageId, setPluginPageId] = createSignal<string | null>(initialUrl.pluginPageId);
  const [pluginPinRevision, setPluginPinRevision] = createSignal(0);
  const [sidebarTab, setSidebarTab] = createSignal<"projects" | "plugins">(
    localStorage.getItem("pv-sidebar-tab") === "plugins" ? "plugins" : "projects",
  );
  createEffect(on(sidebarTab, (v) => localStorage.setItem("pv-sidebar-tab", v)));
  createEffect(
    on(activeView, (view) => {
      if (view === "plugin") setSidebarTab("plugins");
      else if (view === "project" || view === "library") setSidebarTab("projects");
    }),
  );

  function openProject(id: string, tab?: ProjectDetailTab) {
    setActiveView("project");
    setDetailTab(tab ?? lastTabFor(id));
    setSubDetail(null);
    setProjectDetailId(id);
    setPluginPagePluginId(null);
    setPluginPageId(null);
    broadcastActiveProject(id);
  }

  // Leaving the plugin route must not leave a stale highlighted sidebar entry.
  createEffect(
    on(activeView, (view) => {
      if (view !== "plugin") {
        setPluginPagePluginId(null);
        setPluginPageId(null);
      }
    }),
  );

  createEffect(() => {
    const id = projectDetailId();
    if (id) {
      broadcastActiveProject(id);
    }
  });

  createEffect(() => {
    const id = projectDetailId();
    const tab = detailTab();
    if (id && activeView() === "project") {
      rememberTab(id, tab);
    }
  });

  createEffect(
    on(projectDetailId, (id) => {
      if (!id) return;
      const now = Date.now();
      qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => {
        if (!old) return old;
        return old.map((p) => (p.id === id ? { ...p, lastViewedAtMs: now } : p));
      });
      void touchProjectViewed(id);
    }),
  );

  let pendingPopstateSync = 0;

  const syncFromUrl = () => {
    pendingPopstateSync++;
    const n = readAppUrl();
    setActiveView(n.view);
    setProjectDetailId(n.projectId);
    setDetailTab(n.tab);
    setSubDetail(n.subDetail);
    setSettingsTab(n.settingsTab);
    setPluginPagePluginId(n.pluginId);
    setPluginPageId(n.pluginPageId);
  };

  const activePluginPageMeta = () => {
    const pid = pluginPagePluginId();
    const pgid = pluginPageId();
    if (!pid || !pgid) return undefined;
    const plugin = (opts.plugins() ?? []).find((p) => p.id === pid);
    const page = plugin?.pages?.find((p) => p.id === pgid);
    if (!page) return undefined;
    return {
      pluginId: pid,
      pageId: pgid,
      title: page.title,
      icon: page.icon,
      defaultPinned: page.defaultPinned,
      command: page.command,
    };
  };

  let lastPluginPageLoadKey = "";

  // `command` may come straight from the sidebar entry so the first click
  // doesn't wait for the plugins list query to resolve (cold backend scan).
  const runPluginPageCommand = (pid: string, pgid: string, force = false, command?: string) => {
    const cmd = command ?? activePluginPageMeta()?.command;
    if (!cmd) return;
    const key = `${pid}:${pgid}`;
    if (!force && key === lastPluginPageLoadKey) return;
    lastPluginPageLoadKey = key;
    void invoke("execute_plugin_command", {
      pluginId: pid,
      commandId: cmd,
      context: { pageId: pgid },
    }).catch((e) => console.error("plugin page command failed", e));
  };

  const openPluginPage = (pluginId: string, pageId: string, command?: string) => {
    const same =
      activeView() === "plugin" && pluginPagePluginId() === pluginId && pluginPageId() === pageId;
    setActiveView("plugin");
    setPluginPagePluginId(pluginId);
    setPluginPageId(pageId);
    setProjectDetailId(null);
    // Fire immediately with the sidebar's declared command when available;
    // the effect below covers event-driven opens (no command known) and the
    // meta path once the plugins list arrives. The load key dedupes.
    if (command) {
      runPluginPageCommand(pluginId, pageId, same, command);
    } else if (same) {
      runPluginPageCommand(pluginId, pageId, true);
    }
  };

  createEffect(() => {
    if (activeView() !== "plugin") return;
    const pid = pluginPagePluginId();
    const pgid = pluginPageId();
    if (!pid || !pgid) return;
    opts.plugins();
    runPluginPageCommand(pid, pgid);
  });

  createEffect(() => {
    const tab = detailTab();
    if (tab !== "issues" && tab !== "files") {
      setSubDetail(null);
    }
  });

  createEffect(() => {
    const v = activeView();
    if (v === "settings") {
      setProjectDetailId(null);
    }
  });

  createEffect(() => {
    const v = activeView();
    const id = projectDetailId();
    const tab = detailTab();
    const sub = subDetail();
    const sTab = settingsTab();

    if (pendingPopstateSync > 0) {
      pendingPopstateSync--;
      return;
    }

    if (v === "settings") {
      pushUrlToSettings(sTab);
      return;
    }

    if (v === "processes") {
      pushUrlToProcesses();
      return;
    }

    if (v === "plugin") {
      const pid = pluginPagePluginId();
      const pgid = pluginPageId();
      if (pid && pgid) {
        pushUrlToPluginPage(pid, pgid);
      }
      return;
    }

    if (id == null) {
      pushUrlToLibrary();
      return;
    }
    pushUrlToProject(id, tab, sub);
  });

  return {
    activeView,
    setActiveView,
    projectDetailId,
    setProjectDetailId,
    detailTab,
    setDetailTab,
    subDetail,
    setSubDetail,
    settingsTab,
    setSettingsTab,
    pluginPagePluginId,
    setPluginPagePluginId,
    pluginPageId,
    setPluginPageId,
    pluginPinRevision,
    setPluginPinRevision,
    sidebarTab,
    setSidebarTab,
    openProject,
    openPluginPage,
    activePluginPageMeta,
    syncFromUrl,
  };
}
