import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import {
  readAppUrl,
  replaceUrlToLibrary,
  replaceUrlToProject,
  replaceUrlToSettings,
} from "~/lib/app-url";

import { CommandPalette } from "~/features/command-palette";
import { LibraryView, ProjectSidebarList } from "~/features/library";
import { LocationManagerDialog } from "~/features/locations";
import { ProjectDetailView } from "~/features/project-detail";
import { NewProjectWizardDialog } from "~/features/project-wizard";
import { SettingsView } from "~/features/settings";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { stableErrorMessage } from "~/lib/invoke-error";
import { GITHUB_TOKEN_SETTING_KEY, fetchGitHubViewer } from "~/services/github";
import { runGithubDeviceSignIn } from "~/services/github-device-signin";
import { getProject, getSetting, isGithubDeviceConfigured, setSetting } from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
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
} from "~/components/ui/sidebar";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { StackIconSafelist } from "~/components/StackIconSafelist";
import { WindowTitleBar } from "~/components/WindowTitleBar";
import "./App.css";

function App() {
  const { t } = useI18n();
  const hub = useEventHub();
  const qc = useQueryClient();
  const [librarySearch, setLibrarySearch] = createSignal("");
  const [libraryFilter, setLibraryFilter] = createSignal("all");
  const [libraryToast, setLibraryToast] = createSignal<string | null>(null);
  const [locationsOpen, setLocationsOpen] = createSignal(false);
  const [wizardOpen, setWizardOpen] = createSignal(false);
  const initialUrl = readAppUrl();
  const [activeView, setActiveView] = createSignal<"library" | "project" | "settings">(
    initialUrl.view,
  );
  const [projectDetailId, setProjectDetailId] = createSignal<string | null>(initialUrl.projectId);
  const [detailTab, setDetailTab] = createSignal(initialUrl.tab);
  const [subDetail, setSubDetail] = createSignal<string | null>(initialUrl.subDetail);
  const [settingsTab, setSettingsTab] = createSignal(initialUrl.settingsTab);
  const [ghSignInBusy, setGhSignInBusy] = createSignal(false);
  const [accountBanner, setAccountBanner] = createSignal<string | null>(null);

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

  const onOpenGitHubProfile = (url: string) => {
    if (isTauri()) {
      void openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const onSignOut = async () => {
    setLibraryToast(null);
    setAccountBanner(null);
    const r = await setSetting(GITHUB_TOKEN_SETTING_KEY, "");
    if (r.isErr()) {
      setLibraryToast(stableErrorMessage(t, r.error));
      window.setTimeout(() => setLibraryToast(null), 6000);
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
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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
      return;
    }

    if (id == null) {
      replaceUrlToLibrary();
      return;
    }
    replaceUrlToProject(id, tab, sub);
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
    const id = projectDetailId();
    const projectName =
      id != null && titleBarProjectQ.data != null ? titleBarProjectQ.data.name : null;
    const s =
      projectName != null && projectName.length > 0 && projectName !== appName
        ? `${projectName} \u2013 ${appName}`
        : appName;
    document.title = s;
    if (isTauri()) {
      void getCurrentWindow().setTitle(s);
    }
  });

  const onHeaderSignIn = async () => {
    if (!isTauri()) return;
    setGhSignInBusy(true);
    setAccountBanner(t("account.signInBusy") as string);
    setLibraryToast(null);
    try {
      const r = await runGithubDeviceSignIn({
        onUserCode: (code) => {
          setAccountBanner(`${t("account.signInHint") as string} ${code}`);
        },
      });
      if (r !== "ok") {
        setAccountBanner(null);
        setLibraryToast(stableErrorMessage(t, r));
        window.setTimeout(() => setLibraryToast(null), 8000);
        return;
      }
      setAccountBanner(null);
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
      onOpenLocations={() => setLocationsOpen(true)}
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
        <StackIconSafelist />
        <Sidebar collapsible="offcanvas" variant="sidebar">

          <SidebarHeader class="gap-3 border-b border-sidebar-border py-3">
            <div
              class="flex items-center gap-2 px-2 cursor-pointer"
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
            <div class="px-2">

              <TextField>
                <TextFieldInput
                  placeholder={t("library.searchSidebar") as string}
                  class="h-9 border-sidebar-border bg-sidebar-accent/30 text-sm"
                  value={librarySearch()}
                  onInput={(e) => setLibrarySearch(e.currentTarget.value)}
                  autocomplete="off"
                />
              </TextField>
            </div>
          </SidebarHeader>
          <SidebarContent class="flex min-h-0 flex-1 flex-col gap-1">
            <ProjectSidebarList
              search={librarySearch}
              filter={libraryFilter}
              onFilterChange={setLibraryFilter}
              selectedProjectId={projectDetailId}
              onSelectProject={(id) => {
                setActiveView("project");
                setDetailTab("readme");
                setSubDetail(null);
                setProjectDetailId(id);
              }}

              onPlayError={(msg) => {
                setLibraryToast(msg);
                window.setTimeout(() => setLibraryToast(null), 6000);
              }}
            />
          </SidebarContent>
          <SidebarFooter class="border-t border-sidebar-border p-2">
            <div class="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  as={Button}
                  variant="ghost"
                  class="h-auto flex-1 min-w-0 justify-start gap-2 px-1 py-1.5 text-left text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <Avatar class="size-8 shrink-0">
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
                  <span class="min-w-0 flex-1 truncate text-left text-sm font-medium">
                    {ghViewerQ.data != null
                      ? ghViewerQ.data.login
                      : (t("account.notSignedIn") as string)}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-56">
                  <DropdownMenuLabel>
                    {ghViewerQ.data != null
                      ? (t("account.signedInAs") as string).replace("{login}", ghViewerQ.data.login)
                      : (t("account.notSignedIn") as string)}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <Show when={ghViewerQ.data != null}>
                    <DropdownMenuItem
                      onSelect={() => onOpenGitHubProfile(ghViewerQ.data!.profileUrl)}
                    >
                      {t("account.openProfile") as string}
                    </DropdownMenuItem>
                  </Show>
                  <DropdownMenuItem onSelect={() => setActiveView("settings")}>
                    {t("commandPalette.settings") as string}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <Show
                    when={ghViewerQ.data != null}
                    fallback={
                      <DropdownMenuItem
                        disabled={
                          !isTauri() ||
                          (ghDeviceReadyQ.isSuccess && !ghDeviceReadyQ.data) ||
                          ghSignInBusy()
                        }
                        onSelect={() => void onHeaderSignIn()}
                      >
                        {t("account.signInGithub") as string}
                      </DropdownMenuItem>
                    }
                  >
                    <DropdownMenuItem onSelect={() => void onSignOut()}>
                      {t("account.signOut") as string}
                    </DropdownMenuItem>
                  </Show>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="icon"
                class="size-8 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
                onClick={() => setActiveView("settings")}
                title={t("commandPalette.settings") as string}
              >
                <span class="iconify mdi--cog-outline size-5" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset class="flex max-h-svh flex-col overflow-hidden">
          <WindowTitleBar title={windowHeaderTitle} />
          <Show when={accountBanner() != null && (accountBanner() as string).length > 0}>
            <div class="shrink-0 border-b border-border bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
              {accountBanner()}
            </div>
          </Show>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={libraryToast()}>
              <div class="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
                {libraryToast()}
              </div>
            </Show>

            <Show when={activeView() === "settings"}>
              <SettingsView
                activeTab={settingsTab()}
                onTabChange={setSettingsTab}
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
          </div>
        </SidebarInset>
        <NewProjectWizardDialog open={wizardOpen()} onOpenChange={setWizardOpen} />
      </SidebarProvider>
    </CommandPalette>
  );
}

export default App;
