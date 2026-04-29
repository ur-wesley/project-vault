import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, type Accessor, createMemo, createSignal, onMount, onCleanup, createEffect, untrack } from "solid-js";

import {
  readAppUrl,
  replaceUrlToLibrary,
  replaceUrlToProcesses,
  replaceUrlToProject,
  replaceUrlToSettings,
} from "~/lib/app-url";

import { CommandPalette } from "~/features/command-palette";
import { LibraryView, ProjectSidebarList } from "~/features/library";

import { ProjectDetailView } from "~/features/project-detail";
import { ProcessesView } from "~/features/processes";
import { NewProjectWizardDialog } from "~/features/project-wizard";
import { SettingsView } from "~/features/settings";
import { StatusBar } from "~/components/StatusBar";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { useShortcuts } from "~/lib/shortcut-context";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { stableErrorMessage } from "~/lib/invoke-error";
import { GITHUB_TOKEN_SETTING_KEY, fetchGitHubViewer } from "~/services/github";
import { runGithubDeviceSignIn } from "~/services/github-device-signin";
import { getProject, getSetting, isGithubDeviceConfigured, setSetting, listAllProcesses, listLocations, listProjects } from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Toaster } from "~/components/ui/sonner";
import { toast } from "solid-sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "~/components/ui/sidebar";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxControl,
  ComboboxItem,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { StackIconSafelist } from "~/components/StackIconSafelist";
import { WindowTitleBar } from "~/components/WindowTitleBar";
import { StackIcon } from "~/components/StackIcon";
import { buildStacksList } from "~/features/library/filter-projects";
import "./App.css";

type ProjectFilterOption = { value: string; label: string; textValue: string };

function SidebarHeaderSearch(props: {
  search: Accessor<string>;
  setSearch: (v: string) => void;
  filter: Accessor<string>;
  setFilter: (v: string) => void;
  filterOptions: Accessor<ProjectFilterOption[]>;
  t: (k: string) => string;
  shortcutHint: string;
  onOpenCommandPalette?: () => void;
}) {
  const selectedFilterOption = createMemo(() => {
    return props.filterOptions().find((o) => o.value === props.filter()) ?? props.filterOptions()[0];
  });

  return (
    <div class="flex items-center bg-sidebar-accent/15">
      <TextField class="flex-1">
        <TextFieldInput
          placeholder={`${props.t("common.search") as string} ${props.shortcutHint}`}
          class="h-9 border-0 bg-transparent text-xs focus-visible:ring-0 focus-visible:ring-offset-0 px-3 cursor-pointer placeholder:text-sidebar-foreground/40"
          value={props.search()}
          readOnly
          onClick={() => props.onOpenCommandPalette?.()}
          autocomplete="off"
        />
      </TextField>
      <div class="h-5 w-px bg-sidebar-border/30" />
      <Combobox<ProjectFilterOption>
        options={props.filterOptions()}
        optionValue="value"
        optionTextValue="textValue"
        optionLabel="label"
        value={selectedFilterOption()}
        onChange={(opt) => {
          if (opt) props.setFilter(opt.value);
        }}
        disallowEmptySelection
        defaultFilter="contains"
        itemComponent={(p) => {
          const opt = p.item.rawValue;
          const st = opt.value.startsWith("stack:") ? opt.value.slice(6) : null;
          return (
            <ComboboxItem item={p.item}>
              <span class="flex min-w-0 items-center gap-2">
                <Show when={st != null}>
                  <StackIcon stack={st!} class="h-3.5 w-3.5" title={opt.label} />
                </Show>
                <span class="truncate text-xs">{opt.label}</span>
              </span>
            </ComboboxItem>
          );
        }}
      >
        <ComboboxControl class="h-9 border-0 bg-transparent px-2">
          <ComboboxTrigger
            class="flex h-full w-auto items-center gap-0.5 opacity-70 hover:opacity-100"
            aria-label={props.t("library.filterLabel") as string}
          >
            <span class={props.filter() !== "all" ? "iconify mdi--filter size-3.5 text-primary" : "iconify mdi--filter-outline size-3.5"} />
            <span class="iconify mdi--chevron-down size-3" />
          </ComboboxTrigger>
        </ComboboxControl>
        <ComboboxContent />
      </Combobox>
    </div>
  );
}

function SidebarToggleListener() {
  const hub = useEventHub();
  const { toggleSidebar } = useSidebar();
  createEffect(() => {
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "sidebar:toggle") {
        toggleSidebar();
      }
    });
    onCleanup(() => listener());
  });
  return null;
}

function App() {
  const { t, setLocale } = useI18n();
  const hub = useEventHub();
  const shortcuts = useShortcuts();
  const qc = useQueryClient();
  const [librarySearch, setLibrarySearch] = createSignal("");
  const [libraryFilter, setLibraryFilter] = createSignal("all");
  const [wizardOpen, setWizardOpen] = createSignal(false);
  const initialUrl = readAppUrl();
  const [activeView, setActiveView] = createSignal<"library" | "project" | "processes" | "settings">(
    initialUrl.view,
  );
  const [projectDetailId, setProjectDetailId] = createSignal<string | null>(initialUrl.projectId);
  const [detailTab, setDetailTab] = createSignal(initialUrl.tab);
  const [subDetail, setSubDetail] = createSignal<string | null>(initialUrl.subDetail);
  const [settingsTab, setSettingsTab] = createSignal(initialUrl.settingsTab);
  const [ghSignInBusy, setGhSignInBusy] = createSignal(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);
  const [pathname, setPathname] = createSignal(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

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
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<{ projectId: string; running: boolean }>("ide-state-changed", () => {
        void qc.invalidateQueries({ queryKey: queryKeys.projects });
      });
    })();
    onCleanup(() => unlisten?.());
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
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "settings:open") {
        setActiveView("settings");
      } else if (payload.action === "locations:open") {
        setActiveView("settings");
        setSettingsTab("locations");
      } else if (payload.action === "new-project:open") {
        setWizardOpen(true);
      }
    });
    onCleanup(() => listener());
  });

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

  const filterOptions = createMemo((): ProjectFilterOption[] => {
    const out: ProjectFilterOption[] = [
      { value: "all", label: t("library.filterAll") as string, textValue: `all ${t("library.filterAll")}` },
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
      const n = readAppUrl();
      setActiveView(n.view);
      setProjectDetailId(n.projectId);
      setDetailTab(n.tab);
      setSubDetail(n.subDetail);
      setSettingsTab(n.settingsTab);
      setPathname(window.location.pathname);
    };

    const preventDefaultShortcuts = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
      }
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
      }
    };

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", preventDefaultShortcuts);
    window.addEventListener("contextmenu", preventContextMenu);

    onCleanup(() => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", preventDefaultShortcuts);
      window.removeEventListener("contextmenu", preventContextMenu);
    });
  });

  createEffect(() => {
    const tab = detailTab();
    if (tab !== "issues") {
      setSubDetail(null);
    }
  });

  createEffect(() => {
    const v = activeView();
    const id = projectDetailId();
    const tab = detailTab();
    const sub = subDetail();
    const sTab = settingsTab();

    if (v === "settings") {
      replaceUrlToSettings(sTab);
      setPathname(window.location.pathname);
      return;
    }

    if (v === "processes") {
      replaceUrlToProcesses();
      setPathname(window.location.pathname);
      return;
    }

    if (id == null) {
      replaceUrlToLibrary();
      setPathname(window.location.pathname);
      return;
    }
    replaceUrlToProject(id, tab, sub);
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
    } else if (projectName != null && projectName.length > 0 && projectName !== appName) {
      s = `${projectName} \u2013 ${appName}`;
    }
    document.title = s;
    if (isTauri()) {
      void getCurrentWindow().setTitle(s);
    }
  });

  const onHeaderSignIn = async () => {
    if (!isTauri()) return;
    setGhSignInBusy(true);
    toast.dismiss("github-signin");
    const busyToast = toast.loading(t("account.signInBusy") as string, { id: "github-signin" });
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
    >
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
              }}
            >
              <div class="flex size-9 shrink-0 items-center justify-center rounded border border-primary/40 bg-primary/15 text-xs font-bold tracking-tight text-primary">
                PV
              </div>
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
          <SidebarContent class="flex min-h-0 flex-1 flex-col gap-1">
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
          </SidebarContent>
          <SidebarFooter class="border-t border-sidebar-border px-2 py-1.5">
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
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                class="h-8 flex-1 min-w-0 justify-start gap-2 px-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => {
                  setActiveView("settings");
                  setSettingsTab("accounts");
                }}
                title={t("settings.tabAccounts") as string}
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
              </Button>

              <Button
                variant="ghost"
                size="icon"
                class="size-7 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                onClick={() => {
                  setActiveView("settings");
                  setSettingsTab("general");
                }}
                title={t("settings.title") as string}
              >
                <span class="iconify mdi--cog-outline size-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset class="flex max-h-svh flex-col overflow-hidden">
          <WindowTitleBar title={windowHeaderTitle} />
          <Toaster position="top-center" richColors />
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
              {(id) => (
                <ProjectDetailView
                  projectId={id()}
                  detailTab={detailTab}
                  onDetailTabChange={setDetailTab}
                  subDetail={subDetail}
                  onSubDetailChange={setSubDetail}
                  onBack={() => {
                    setActiveView("library");
                    setProjectDetailId(null);
                  }}
                />
              )}
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
          </div>

          <StatusBar
            activeView={activeView()}
            pathname={pathname()}
            projectName={titleBarProjectQ.data?.name}
            projectId={projectDetailId()}
            onShowProcesses={() => setActiveView("processes")}
          />
        </SidebarInset>
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
      </SidebarProvider>
    </CommandPalette>
  );
}

export default App;
