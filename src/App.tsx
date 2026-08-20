import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Show, type Accessor, createMemo, createSignal, on, onMount, onCleanup, createEffect } from "solid-js";

import iconUrl from "../icon.png";

import {
  readAppUrl,
  pushUrlToLibrary,
  pushUrlToProcesses,
  pushUrlToProject,
  pushUrlToSettings,
  pushUrlToPluginPage,
  type AppView,
} from "~/lib/app-url";

import { CommandPalette } from "~/features/command-palette";
import { LibraryView, ProjectSidebarList } from "~/features/library";

import { ProjectDetailView } from "~/features/project-detail";
import { ProcessesView } from "~/features/processes";
import { NewProjectWizardDialog } from "~/features/project-wizard";
import { SettingsView } from "~/features/settings";
import { PluginPageView } from "~/features/plugin-page/PluginPageView";
import { PluginSidebarList } from "~/features/plugin-page/PluginSidebarList";
import { StatusBar } from "~/components/StatusBar";
import { GlobalTerminalDrawer } from "~/components/GlobalTerminalDrawer";
import { UpdateDialog, getSkippedVersion } from "~/components/UpdateDialog";
import { getGlobalTerminalStore } from "~/lib/global-terminal-store";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { useShortcuts } from "~/lib/shortcut-context";
import { installWebviewShortcutBlocker } from "~/lib/webview-shortcut-blocker";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { stableErrorMessage } from "~/lib/invoke-error";
import { GITHUB_TOKEN_SETTING_KEY, fetchGitHubViewer } from "~/services/github";
import { runGithubDeviceSignIn } from "~/services/github-device-signin";
import { getProject, listProjects, touchProjectViewed } from "~/services/tauri/projects";
import { listLocations } from "~/services/tauri/locations";
import { getSetting, setSetting } from "~/services/tauri/settings";
import { isGithubDeviceConfigured } from "~/services/tauri/github-auth";
import { listAllProcesses } from "~/services/tauri/sessions";
import { checkForUpdates } from "~/services/tauri/updates";
import { stopAllProjectProcesses } from "~/services/tauri/processes";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto } from "~/types/dto";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { toast } from "solid-sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "~/components/ui/sidebar";
import { StackIconSafelist } from "~/components/StackIconSafelist";
import { WindowTitleBar } from "~/components/WindowTitleBar";
import { buildStacksList } from "~/features/library/filter-projects";
import "./App.css";

import { SidebarHeaderSearch } from "~/components/SidebarHeaderSearch";
import { SidebarToggleListener } from "~/components/SidebarToggleListener";
import { useScreenshot } from "~/features/screenshot";
import { openClipboardOverlay } from "~/features/clipboard-history";
import AnnotationEditor from "~/features/screenshot/components/AnnotationEditor";
import SourceSelector from "~/features/screenshot/components/SourceSelector";
import { PluginUiBridge } from "~/components/PluginUiBridge";

type ProjectFilterOption = { value: string; label: string; textValue: string };

function App() {
  const { t, setLocale } = useI18n();
  const hub = useEventHub();
  const shortcuts = useShortcuts();
  const qc = useQueryClient();
  const globalTerminal = getGlobalTerminalStore();
  const screenshot = useScreenshot();
  const [librarySearch, setLibrarySearch] = createSignal("");
  const [libraryFilter, setLibraryFilter] = createSignal("touched-10d");
  const [wizardOpen, setWizardOpen] = createSignal(false);
  const initialUrl = readAppUrl();
  const [activeView, setActiveView] = createSignal<AppView>(initialUrl.view);
  const [projectDetailId, setProjectDetailId] = createSignal<string | null>(initialUrl.projectId);
  const [detailTab, setDetailTab] = createSignal(initialUrl.tab);
  const [subDetail, setSubDetail] = createSignal<string | null>(initialUrl.subDetail);
  const [settingsTab, setSettingsTab] = createSignal(initialUrl.settingsTab);
  const [pluginPagePluginId, setPluginPagePluginId] = createSignal<string | null>(initialUrl.pluginId);
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
  const [_ghSignInBusy, setGhSignInBusy] = createSignal(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);
  const [updatePopupOpen, setUpdatePopupOpen] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<import("~/services/tauri/updates").UpdateInfoDto | null>(null);
  const [pathname, setPathname] = createSignal(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  let pendingPopstateSync = 0;

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
  }));

  const activePluginPageMeta = createMemo(() => {
    const pid = pluginPagePluginId();
    const pgid = pluginPageId();
    if (!pid || !pgid) return undefined;
    const plugin = (pluginsQ.data ?? []).find((p) => p.id === pid);
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
  });

  let lastPluginPageLoadKey = "";

  const runPluginPageCommand = (pid: string, pgid: string, force = false) => {
    const meta = activePluginPageMeta();
    if (!meta?.command) return;
    const key = `${pid}:${pgid}`;
    if (!force && key === lastPluginPageLoadKey) return;
    lastPluginPageLoadKey = key;
    void invoke("execute_plugin_command", {
      pluginId: pid,
      commandId: meta.command,
      context: { pageId: pgid },
    }).catch((e) => console.error("plugin page command failed", e));
  };

  const openPluginPage = (pluginId: string, pageId: string) => {
    const same =
      activeView() === "plugin" &&
      pluginPagePluginId() === pluginId &&
      pluginPageId() === pageId;
    setActiveView("plugin");
    setPluginPagePluginId(pluginId);
    setPluginPageId(pageId);
    setProjectDetailId(null);
    if (same) {
      runPluginPageCommand(pluginId, pageId, true);
    }
  };

  createEffect(() => {
    if (activeView() !== "plugin") return;
    const pid = pluginPagePluginId();
    const pgid = pluginPageId();
    if (!pid || !pgid) return;
    pluginsQ.data;
    runPluginPageCommand(pid, pgid);
  });

  const runningProcessCount = createMemo(() =>
    (processesQ.data ?? []).filter((p) => p.state === "running" || p.state === "starting").length,
  );

  // Auto-refresh projects when active processes change
  const runningProcessIds = createMemo(() =>
    (processesQ.data ?? [])
      .filter((p) => p.state === "running" || p.state === "starting")
      .map((p) => p.id)
      .sort()
      .join(","),
  );
  createEffect(() => {
    const ids = runningProcessIds();
    if (ids.length > 0) {
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
    }
  });

  // Auto-refresh projects when IDE closes
  createEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{ projectId: string; running: boolean }>("ide-state-changed", () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
    }).then((fn) => {
      if (active) {
        unlisten = fn;
      } else {
        fn();
      }
    });
    onCleanup(() => {
      active = false;
      unlisten?.();
    });
  });

  createEffect(() => {
    const d = densityQ.data;
    if (d === "compact") {
      document.documentElement.setAttribute("data-ui-density", "compact");
    } else if (d !== undefined) {
      document.documentElement.removeAttribute("data-ui-density");
    }
  });

  createEffect(() => {
    if (activeView() === "settings") {
      setProjectDetailId(null);
    }
  });

  createEffect(() => {
    const mins = scanMinsQ.data;
    if (mins == null || mins <= 0) return;
    const id = window.setInterval(() => {
      void (async () => {
        const n = await rescanAllLibraryFolders();
        hub.emit("scan:complete", { projectCount: n });
        void qc.invalidateQueries({ queryKey: queryKeys.projects });
        void qc.invalidateQueries({ queryKey: queryKeys.locations });
      })();
    }, mins * 60_000);
    onCleanup(() => window.clearInterval(id));
  });

  createEffect(() => {
    const openPlugins = hub.on("ui:open-plugins-settings", () => {
      setActiveView("settings");
      setSettingsTab("plugins");
    });
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "settings:open") {
        setActiveView("settings");
      } else if (payload.action === "locations:open") {
        setActiveView("settings");
        setSettingsTab("locations");
      } else if (payload.action === "new-project:open") {
        setWizardOpen(true);
      } else if (payload.action === "terminal:toggle") {
        globalTerminal.setOpen(!globalTerminal.open());
      } else if (payload.action === "screenshot:capture") {
        void screenshot.selectSource({ type: "region" }, (k, a) => t(k, a) as string);
      } else if (payload.action === "clipboard-history:open") {
        void openClipboardOverlay().catch((e) => {
          console.error("Failed to open clipboard overlay:", e);
          toast.error(String(t("clipboardHistory.openFailed")));
        });
      } else if (payload.action.startsWith("plugin:")) {
        const parts = payload.action.split(":");
        if (parts.length >= 3) {
          const pluginId = parts[1];
          const commandId = parts.slice(2).join(":");
          void (async () => {
            try {
              await invoke("execute_plugin_command", {
                pluginId,
                commandId,
                context: {
                  projectId: projectDetailId() ?? null,
                },
              });
            } catch (e) {
              console.error(`Failed to execute plugin command ${commandId} from hotkey:`, e);
            }
          })();
        }
      }
    });
    onCleanup(() => {
      openPlugins();
      listener();
    });
  });

  createEffect(() => {
    const listener = hub.on("project:opened", (payload) => {
      setActiveView("project");
      setDetailTab("readme");
      setSubDetail(null);
      setProjectDetailId(payload.projectId);
    });
    onCleanup(() => listener());
  });

  const _ghDeviceReadyQ = createQuery(() => ({
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

  const filterOptions = createMemo((): ProjectFilterOption[] => {
    const out: ProjectFilterOption[] = [
      { value: "all", label: t("library.filterAll") as string, textValue: `all ${t("library.filterAll")}` },
      { value: "touched-10d", label: t("library.filterTouched10d") as string, textValue: `touched ${t("library.filterTouched10d")}` },
      { value: "favorites", label: t("library.filterFavorites") as string, textValue: `favorites ${t("library.filterFavorites")}` },
      { value: "recent", label: t("library.filterRecent") as string, textValue: `recent ${t("library.filterRecent")}` },
      { value: "git", label: "Git", textValue: "git" },
      { value: "github", label: "GitHub", textValue: "github" },
    ];
    if (ghViewerQ.data) {
      out.push({ value: "own", label: t("library.filterMyRepos") as string, textValue: "own my repos" });
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

  const onOpenGitHubProfile = (url: string) => {
    if (isTauri()) {
      void openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const onSignOut = async () => {
    const r = await setSetting(GITHUB_TOKEN_SETTING_KEY, "");
    if (r.isErr()) {
      toast.error(stableErrorMessage(t, r.error));
      return;
    }
    void qc.invalidateQueries({ queryKey: queryKeys.githubViewer() });
    void qc.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
    });
  };

  onMount(() => {
    const onPopState = () => {
      pendingPopstateSync++;
      const n = readAppUrl();
      setActiveView(n.view);
      setProjectDetailId(n.projectId);
      setDetailTab(n.tab);
      setSubDetail(n.subDetail);
      setSettingsTab(n.settingsTab);
      setPluginPagePluginId(n.pluginId);
      setPluginPageId(n.pluginPageId);
      setPathname(window.location.pathname);
    };

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        window.history.back();
      } else if (e.button === 4) {
        e.preventDefault();
        window.history.forward();
      }
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("mousedown", onMouseDown);
    const removeShortcutBlocker = installWebviewShortcutBlocker();

    // Auto-check for updates on startup if enabled
    void (async () => {
      if (!isTauri()) return;
      const r = await getSetting("auto_check_updates");
      if (r.isOk() && r.value !== "false") {
        const updateR = await checkForUpdates();
        if (updateR.isOk() && updateR.value) {
          const skipped = getSkippedVersion();
          if (skipped !== updateR.value.version) {
            setUpdateInfo(updateR.value);
          }
        }
      }
    })();

    let active = true;

    // Confirm before closing when tasks are running
    let unlistenClose: (() => void) | undefined;
    if (isTauri()) {
      void getCurrentWindow().onCloseRequested(async (event) => {
        const count = runningProcessCount();
        if (count > 0) {
          const confirmed = await ask(
            t("processes.closeConfirm", { count: String(count) }) as string,
            { title: t("app.title") as string, kind: "warning" },
          );
          if (!confirmed) {
            event.preventDefault();
          }
        }
      }).then((fn) => {
        if (active) {
          unlistenClose = fn;
        } else {
          fn();
        }
      });
    }

    let unlistenOpenProjectFile: (() => void) | undefined;
    if (isTauri()) {
      void listen<{ projectId: string; filePath: string; line: number }>(
        "plugin:open-project-file",
        (event) => {
          const { projectId, filePath, line } = event.payload;
          setActiveView("project");
          setProjectDetailId(projectId);
          if (filePath && filePath !== "") {
            setDetailTab("files");
            setSubDetail(`${filePath}::${line}`);
          } else {
            setDetailTab("readme");
            setSubDetail(null);
          }
        }
      ).then((fn) => {
        if (active) {
          unlistenOpenProjectFile = fn;
        } else {
          fn();
        }
      });

      void listen<{ pluginId: string; enabled: boolean }>("plugin:status-changed", (event) => {
        void qc.invalidateQueries({ queryKey: ["plugins", "list"] });
        if (!event.payload.enabled && activeView() === "plugin" && pluginPagePluginId() === event.payload.pluginId) {
          setActiveView("library");
          setPluginPagePluginId(null);
          setPluginPageId(null);
        }
      });

      void listen("plugin:reload", () => {
        void qc.invalidateQueries({ queryKey: ["plugins", "list"] });
      });
    }

    onCleanup(() => {
      active = false;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("mousedown", onMouseDown);
      removeShortcutBlocker();
      unlistenClose?.();
      unlistenOpenProjectFile?.();
    });
  });

  createEffect(() => {
    const tab = detailTab();
    if (tab !== "issues" && tab !== "files") {
      setSubDetail(null);
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
      setPathname(window.location.pathname);
      return;
    }

    if (v === "settings") {
      pushUrlToSettings(sTab);
      setPathname(window.location.pathname);
      return;
    }

    if (v === "processes") {
      pushUrlToProcesses();
      setPathname(window.location.pathname);
      return;
    }

    if (v === "plugin") {
      const pid = pluginPagePluginId();
      const pgid = pluginPageId();
      if (pid && pgid) {
        pushUrlToPluginPage(pid, pgid);
      }
      setPathname(window.location.pathname);
      return;
    }

    if (id == null) {
      pushUrlToLibrary();
      setPathname(window.location.pathname);
      return;
    }
    pushUrlToProject(id, tab, sub);
    setPathname(window.location.pathname);
  });

  const titleBarProjectQ = createQuery(() => {
    const id = projectDetailId();
    return {
      queryKey: queryKeys.project(id ?? "none"),
      queryFn: async () => {
        if (id == null) return null;
        const r = await getProject(id);
        if (r.isErr()) throw new Error(r.error.message);
        return r.value;
      },
      enabled: id != null,
    };
  });

  const windowHeaderTitle = createMemo(() => {
    if (activeView() === "settings") {
      return t("settings.title") as string;
    }
    if (activeView() === "processes") {
      return t("processes.title") as string;
    }
    if (activeView() === "plugin") {
      return activePluginPageMeta()?.title ?? pluginPageId() ?? (t("app.title") as string);
    }
    if (projectDetailId() == null) {
      return t("app.title") as string;
    }
    if (titleBarProjectQ.data != null) {
      return titleBarProjectQ.data.name;
    }
    return t("app.title") as string;
  });

  createEffect(() => {
    const appName = t("app.title") as string;
    const view = activeView();
    const id = projectDetailId();
    const projectName =
      id != null && titleBarProjectQ.data != null ? titleBarProjectQ.data.name : null;
    let s = appName;
    if (view === "processes") {
      s = `${t("processes.title") as string} \u2013 ${appName}`;
    } else if (view === "settings") {
      s = `${t("settings.title") as string} \u2013 ${appName}`;
    } else if (view === "plugin") {
      const pageTitle = activePluginPageMeta()?.title;
      s = pageTitle ? `${pageTitle} \u2013 ${appName}` : appName;
    } else if (projectName != null && projectName.length > 0 && projectName !== appName) {
      s = `${projectName} \u2013 ${appName}`;
    }
    document.title = s;
    if (isTauri()) {
      void getCurrentWindow().setTitle(s);
    }
  });

  const _onHeaderSignIn = async () => {
    if (!isTauri()) return;
    setGhSignInBusy(true);
    toast.dismiss("github-signin");
    toast.loading(t("account.signInBusy") as string, { id: "github-signin" });
    try {
      const r = await runGithubDeviceSignIn({
        onUserCode: (code) => {
          toast.loading(`${t("account.signInHint") as string} ${code}`, { id: "github-signin" });
        },
      });
      if (r !== "ok") {
        toast.error(stableErrorMessage(t, r), { id: "github-signin" });
        return;
      }
      toast.dismiss("github-signin");
      void ghViewerQ.refetch();
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
      });
    } finally {
      setGhSignInBusy(false);
    }
  };

  return (
    <CommandPalette
      open={commandPaletteOpen()}
      onOpenChange={setCommandPaletteOpen}
              onOpenLocations={() => {
                setActiveView("settings");
                setSettingsTab("locations");
              }}
      onOpenSettings={() => setActiveView("settings")}
      onOpenNewProject={() => setWizardOpen(true)}
      onSelectProject={(p) => {
        setActiveView("project");
        setDetailTab("readme");
        setSubDetail(null);
        setProjectDetailId(p.id);
      }}
      activeProjectId={projectDetailId()}
    >
      <PluginUiBridge
        projectId={projectDetailId()}
        detailTab={detailTab()}
        subDetail={subDetail()}
        onOpenPluginPage={(pluginId, pageId) => openPluginPage(pluginId, pageId)}
      />
      <SidebarProvider>
        <SidebarToggleListener />
        <StackIconSafelist />
        <Sidebar collapsible="offcanvas" variant="sidebar">
          <SidebarHeader class="gap-0 border-b-0 p-0">
            <div
              class="flex items-center gap-2 px-3 py-3 cursor-pointer border-b border-sidebar-border"
              onClick={() => {
                setActiveView("library");
                setProjectDetailId(null);
                setSubDetail(null);
                setPluginPagePluginId(null);
                setPluginPageId(null);
              }}
            >
              <img
                src={iconUrl}
                alt="Project Vault"
                class="size-9 shrink-0 rounded object-contain"
              />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-semibold tracking-wide text-sidebar-foreground">
                  {t("app.title") as string}
                </span>
                <span class="truncate text-xs text-sidebar-foreground/60">
                  {t("app.librarySubtitle") as string}
                </span>
              </div>
            </div>
            <SidebarHeaderSearch
              search={librarySearch}
              setSearch={setLibrarySearch}
              filter={libraryFilter}
              setFilter={setLibraryFilter}
              filterOptions={filterOptions}
              t={(k) => t(k) as string}
              shortcutHint={shortcuts.format("command-palette:open")}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            />
          </SidebarHeader>
          <SidebarContent class="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
            <Tabs
              value={sidebarTab()}
              onChange={(v) => setSidebarTab(v as "projects" | "plugins")}
              class="flex min-h-0 flex-1 flex-col"
            >
              <div class="shrink-0 px-2 pt-1">
                <TabsList class="grid h-8 w-full shrink-0 grid-cols-2 p-0.5 bg-sidebar-accent/40">
                  <TabsTrigger
                    value="projects"
                    class="text-xs data-[selected]:bg-sidebar data-[selected]:text-sidebar-foreground"
                  >
                    {t("library.sidebarProjects") as string}
                  </TabsTrigger>
                  <TabsTrigger
                    value="plugins"
                    class="text-xs data-[selected]:bg-sidebar data-[selected]:text-sidebar-foreground"
                  >
                    {t("plugins.sidebarPages") as string}
                    <Show when={runningProcessCount() > 0}>
                      <span class="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                        {runningProcessCount()}
                      </span>
                    </Show>
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                forceMount
                value="projects"
                class="mt-1 hidden min-h-0 flex-1 flex-col overflow-hidden data-[selected]:flex"
              >
                <ProjectSidebarList
                  selectedProjectId={projectDetailId}
                  onSelectProject={(id) => {
                    setActiveView("project");
                    setDetailTab("readme");
                    setSubDetail(null);
                    setProjectDetailId(id);
                  }}
                  onPlayError={(msg) => {
                    toast.error(msg);
                  }}
                  onOpenLocations={() => {
                    setActiveView("settings");
                    setSettingsTab("locations");
                  }}
                  onOpenNewProject={() => setWizardOpen(true)}
                />
              </TabsContent>
              <TabsContent
                forceMount
                value="plugins"
                class="mt-1 hidden min-h-0 flex-1 flex-col overflow-hidden data-[selected]:flex"
              >
                <div class="min-h-0 flex-1 overflow-y-auto">
                  <PluginSidebarList
                    activePluginId={pluginPagePluginId()}
                    activePageId={pluginPageId()}
                    pinRevision={pluginPinRevision()}
                    onOpenPage={(pluginId, pageId) => openPluginPage(pluginId, pageId)}
                    onPinChange={() => setPluginPinRevision((n) => n + 1)}
                    onManagePlugins={() => {
                      setActiveView("settings");
                      setSettingsTab("plugins");
                    }}
                  />
                </div>
                <SidebarGroup class="shrink-0 px-2 pt-0 pb-1">
                  <ContextMenu>
                    <ContextMenuTrigger as="div" class="contents">
                      <Button
                        variant="ghost"
                        size="sm"
                        class={
                          "h-7 w-full justify-start gap-2 px-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground " +
                          (activeView() === "processes" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "")
                        }
                        onClick={() => setActiveView("processes")}
                      >
                        <span class="iconify mdi--application-cog-outline size-6 opacity-70" />
                        <span class="text-xs">{t("processes.title") as string}</span>
                        <Show when={runningProcessCount() > 0}>
                          <span class="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                            {runningProcessCount()}
                          </span>
                        </Show>
                      </Button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          const running = (processesQ.data ?? []).filter(
                            (p) => p.state === "running" || p.state === "starting",
                          );
                          const projectIds = new Set(running.map((p) => p.projectId));
                          for (const pid of projectIds) {
                            void stopAllProjectProcesses(pid);
                          }
                        }}
                      >
                        <span class="iconify mdi--close-circle-outline size-4" />
                        <span>Close everything</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarGroup>
              </TabsContent>
            </Tabs>
          </SidebarContent>
          <SidebarFooter class="border-t border-sidebar-border px-2 py-1.5">
            <div class="flex items-center gap-1">
              <ContextMenu>
                <ContextMenuTrigger as="div" class="contents">
                  <Tooltip>
                    <TooltipTrigger
                      as={Button}
                      variant="ghost"
                      class="h-8 flex-1 min-w-0 justify-start gap-2 px-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      onClick={() => {
                        setActiveView("settings");
                        setSettingsTab("accounts");
                      }}
                    >
                      <Avatar class="size-6 shrink-0">
                        <Show
                          when={ghViewerQ.data != null && (ghViewerQ.data!.avatarUrl?.length ?? 0) > 0}
                        >
                          <AvatarImage
                            class="object-cover"
                            src={ghViewerQ.data!.avatarUrl ?? undefined}
                            alt={ghViewerQ.data?.login ?? ""}
                          />
                        </Show>
                        <AvatarFallback class="bg-primary/20 text-xs font-medium text-primary">
                          {ghViewerQ.isLoading
                            ? "…"
                            : (ghViewerQ.data?.login?.slice(0, 2).toUpperCase() ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span class="min-w-0 flex-1 truncate text-left text-xs font-medium">
                        {ghViewerQ.data != null
                          ? ghViewerQ.data.login
                          : (t("account.notSignedIn") as string)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("settings.tabAccounts") as string}</TooltipContent>
                  </Tooltip>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <Show when={ghViewerQ.data}>
                    <ContextMenuItem
                      onSelect={() =>
                        onOpenGitHubProfile(`https://github.com/${ghViewerQ.data!.login}`)
                      }
                    >
                      <span class="iconify mdi--github size-4" />
                      <span>View GitHub profile</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </Show>
                  <ContextMenuItem onSelect={() => void onSignOut()}>
                    <span class="iconify mdi--logout size-4" />
                    <span>Logout</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>

              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon"
                  class="size-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                  onClick={() => void screenshot.openSelector((k, a) => t(k, a) as string)}
                >
                  <span class="iconify mdi--camera size-4" />
                </TooltipTrigger>
                <TooltipContent>{t("screenshot.tooltip")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon"
                  class="size-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                  onClick={() => {
                    setActiveView("settings");
                    setSettingsTab("general");
                  }}
                >
                  <span class="iconify mdi--cog-outline size-4" />
                </TooltipTrigger>
                <TooltipContent>{t("settings.title") as string}</TooltipContent>
              </Tooltip>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset class="flex max-h-svh flex-col overflow-hidden">
          <WindowTitleBar title={windowHeaderTitle} />
          <Toaster position="bottom-right" richColors />
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={activeView() === "settings"}>
              <SettingsView
                activeTab={settingsTab()}
                onTabChange={setSettingsTab}
                onLocaleChange={setLocale}
                onBack={() => {
                  setActiveView(projectDetailId() ? "project" : "library");
                  setSubDetail(null);
                }}
              />
            </Show>
            <Show when={activeView() === "library"}>
              <div class="min-h-0 flex-1 overflow-y-auto">
                <LibraryView
                  search={librarySearch}
                  onSearchChange={setLibrarySearch}
                  filter={libraryFilter}
                  onFilterChange={setLibraryFilter}
                  selectedProjectId={projectDetailId}
                  onOpenProject={(id) => {
                    setActiveView("project");
                    setDetailTab("readme");
                    setSubDetail(null);
                    setProjectDetailId(id);
                  }}
                  onOpenProjectTab={(id, tab) => {
                    setActiveView("project");
                    setDetailTab(tab as "readme" | "issues" | "files" | "tasks" | "terminal" | "history");
                    setSubDetail(null);
                    setProjectDetailId(id);
                  }}
                />
              </div>
            </Show>

            <Show when={activeView() === "project" && projectDetailId()}>
              <ProjectDetailView
                projectId={projectDetailId()!}
                detailTab={detailTab}
                onDetailTabChange={setDetailTab}
                subDetail={subDetail}
                onSubDetailChange={setSubDetail}
                onBack={() => {
                  setActiveView("library");
                  setProjectDetailId(null);
                }}
              />
            </Show>

            <Show when={activeView() === "processes"}>
              <ProcessesView
                onOpenProject={(id) => {
                  setActiveView("project");
                  setDetailTab("readme");
                  setSubDetail(null);
                  setProjectDetailId(id);
                }}
              />
            </Show>

            <Show when={activeView() === "plugin" && pluginPagePluginId() && pluginPageId()}>
              <PluginPageView
                pluginId={pluginPagePluginId()!}
                pageId={pluginPageId()!}
                meta={activePluginPageMeta()}
                pinRevision={pluginPinRevision()}
                onPinChange={() => setPluginPinRevision((n) => n + 1)}
              />
            </Show>
          </div>

          <StatusBar
            activeView={activeView()}
            projectName={titleBarProjectQ.data?.name}
            projectId={projectDetailId()}
            onShowProcesses={() => setActiveView("processes")}
            onToggleTerminal={() => globalTerminal.setOpen(!globalTerminal.open())}
            updateVersion={updateInfo()?.version}
            onOpenUpdatePopup={() => setUpdatePopupOpen(true)}
          />
        </SidebarInset>
        <GlobalTerminalDrawer />
        <UpdateDialog
          open={updatePopupOpen()}
          onOpenChange={setUpdatePopupOpen}
          updateInfo={updateInfo()}
          onSkipped={() => setUpdateInfo(null)}
        />
        <NewProjectWizardDialog
          open={wizardOpen()}
          onOpenChange={setWizardOpen}
          onOpenProjectTerminal={(id) => {
            setActiveView("project");
            setProjectDetailId(id);
            setDetailTab("terminal");
            setSubDetail(null);
          }}
        />
        <Show when={screenshot.appState() === "selecting"}>
          <SourceSelector
            screens={screenshot.screens()}
            windows={screenshot.windows()}
            onSelect={(source) => void screenshot.selectSource(source, (k, a) => t(k, a) as string)}
            onClose={() => screenshot.close()}
          />
        </Show>
        <Show when={screenshot.appState() === "editing" && screenshot.imageData()}>
          <AnnotationEditor
            imageData={screenshot.imageData()!}
            onClose={() => screenshot.close()}
            onSave={(data) => void screenshot.save(data, (k, a) => t(k, a) as string)}
            onCopy={(data) => void screenshot.copyToClipboard(data, (k, a) => t(k, a) as string)}
          />
        </Show>
      </SidebarProvider>
    </CommandPalette>
  );
}

export default App;
