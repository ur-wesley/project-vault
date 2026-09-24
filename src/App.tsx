import { useQueryClient } from "@tanstack/solid-query";
import { Show, createSignal, onMount, onCleanup, createEffect } from "solid-js";

import { refreshPinnedProjects, unpinProject, PINS_EVENT } from "~/lib/project-pins";
import { CommandPalette } from "~/features/command-palette";
import { NewProjectWizardDialog } from "~/features/project-wizard";
import { GlobalTerminalDrawer } from "~/components/GlobalTerminalDrawer";
import { UpdateDialog, getSkippedVersion } from "~/components/UpdateDialog";
import { getGlobalTerminalStore } from "~/lib/global-terminal-store";
import { useAppRouting } from "./app/useAppRouting";
import { useSidebarData } from "./app/useSidebarData";
import { useWindowTitle } from "./app/useWindowTitle";
import { AppSidebar } from "./app/AppSidebar";
import { AppMainView } from "./app/AppMainView";
import { useEventHub } from "~/lib/event-hub-context";
import { useI18n } from "~/lib/i18n-context";
import { useShortcuts } from "~/lib/shortcut-context";
import { installWebviewShortcutBlocker } from "~/lib/webview-shortcut-blocker";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import { getSetting } from "~/services/tauri/settings";
import { checkForUpdates } from "~/services/tauri/updates";
import { queryKeys } from "~/services/query-keys";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { Toaster } from "~/components/ui/sonner";
import { toast } from "solid-sonner";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { StackIconSafelist } from "~/components/StackIconSafelist";
import { WindowTitleBar } from "~/components/WindowTitleBar";
import "./App.css";

import { SidebarToggleListener } from "~/components/SidebarToggleListener";
import { useScreenshot } from "~/features/screenshot";
import { openClipboardOverlay } from "~/features/clipboard-history";
import AnnotationEditor from "~/features/screenshot/components/AnnotationEditor";
import SourceSelector from "~/features/screenshot/components/SourceSelector";
import { PluginUiBridge } from "~/components/PluginUiBridge";
import { PluginUiExtensions } from "~/features/plugin-ui/bridge/PluginUiExtensions";

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

  // Domain state lives in src/app/* (extracted from this file).
  const data = useSidebarData({ t });
  const routing = useAppRouting({ plugins: () => data.pluginsQ.data });
  const title = useWindowTitle({
    t,
    activeView: routing.activeView,
    projectDetailId: routing.projectDetailId,
    pluginPageId: routing.pluginPageId,
    activePluginPageMeta: routing.activePluginPageMeta,
  });

  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);
  const [updatePopupOpen, setUpdatePopupOpen] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<
    import("~/services/tauri/updates").UpdateInfoDto | null
  >(null);

  // Server state (queries, pins, filters) lives in useSidebarData.

  // Auto-refresh projects when active processes change
  createEffect(() => {
    const ids = data.runningProcessIds();
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
    const d = data.densityQ.data;
    if (d === "compact") {
      document.documentElement.setAttribute("data-ui-density", "compact");
    } else if (d !== undefined) {
      document.documentElement.removeAttribute("data-ui-density");
    }
  });

  createEffect(() => {
    const mins = data.scanMinsQ.data;
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
      routing.setActiveView("settings");
      routing.setSettingsTab("plugins");
    });
    const listener = hub.on("shortcut:action", (payload) => {
      if (payload.action === "settings:open") {
        routing.setActiveView("settings");
      } else if (payload.action === "locations:open") {
        routing.setActiveView("settings");
        routing.setSettingsTab("locations");
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
                  projectId: routing.projectDetailId() ?? null,
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
      routing.openProject(payload.projectId);
    });
    onCleanup(() => listener());
  });

  onMount(() => {
    const onPopState = () => {
      routing.syncFromUrl();
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

    // Keep pinned-project tabs in sync (other tabs / header pin button).
    refreshPinnedProjects();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pv-pinned-projects" || e.key == null) refreshPinnedProjects();
    };
    const onPinsEvent = () => refreshPinnedProjects();
    window.addEventListener("storage", onStorage);
    window.addEventListener(PINS_EVENT, onPinsEvent);

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
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          const count = data.runningProcessCount();
          if (count > 0) {
            const confirmed = await ask(
              t("processes.closeConfirm", { count: String(count) }) as string,
              { title: t("app.title") as string, kind: "warning" },
            );
            if (!confirmed) {
              event.preventDefault();
            }
          }
        })
        .then((fn) => {
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
          if (filePath && filePath !== "") {
            routing.setActiveView("project");
            routing.setProjectDetailId(projectId);
            routing.setDetailTab("files");
            routing.setSubDetail(`${filePath}::${line}`);
            routing.setPluginPagePluginId(null);
            routing.setPluginPageId(null);
          } else {
            routing.openProject(projectId);
          }
        },
      ).then((fn) => {
        if (active) {
          unlistenOpenProjectFile = fn;
        } else {
          fn();
        }
      });

      void listen<{ pluginId: string; enabled: boolean }>("plugin:status-changed", (event) => {
        void qc.invalidateQueries({ queryKey: ["plugins", "list"] });
        if (
          !event.payload.enabled &&
          routing.activeView() === "plugin" &&
          routing.pluginPagePluginId() === event.payload.pluginId
        ) {
          routing.setActiveView("library");
          routing.setPluginPagePluginId(null);
          routing.setPluginPageId(null);
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
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PINS_EVENT, onPinsEvent);
      removeShortcutBlocker();
      unlistenClose?.();
      unlistenOpenProjectFile?.();
    });
  });

  // (detail-tab reset, URL sync, and window title live in
  // useAppRouting / useWindowTitle.)

  return (
    <CommandPalette
      open={commandPaletteOpen()}
      onOpenChange={setCommandPaletteOpen}
      onOpenLocations={() => {
        routing.setActiveView("settings");
        routing.setSettingsTab("locations");
      }}
      onOpenSettings={() => routing.setActiveView("settings")}
      onOpenNewProject={() => setWizardOpen(true)}
      onSelectProject={(p) => {
        routing.openProject(p.id);
      }}
      activeProjectId={routing.projectDetailId()}
    >
      <PluginUiBridge
        projectId={routing.projectDetailId()}
        detailTab={routing.detailTab()}
        subDetail={routing.subDetail()}
        onOpenPluginPage={(pluginId, pageId) => routing.openPluginPage(pluginId, pageId)}
      />
      <PluginUiExtensions />
      <SidebarProvider
        class="relative h-svh overflow-hidden"
        style={{ "--titlebar-height": data.showTabs() ? "4.5rem" : "2.25rem" }}
      >
        <SidebarToggleListener />
        <StackIconSafelist />
        <WindowTitleBar
          title={title.windowHeaderTitle}
          showTabs={data.showTabs()}
          tabs={data.pinnedTabs()}
          activeTabId={routing.projectDetailId()}
          onSelectTab={(id) => routing.openProject(id)}
          onUnpinTab={(id) => void unpinProject(id)}
        />
        <div class="absolute inset-x-0 bottom-0 top-[var(--titlebar-height,0px)] flex min-h-0">
          <AppSidebar
            t={t}
            routing={routing}
            data={data}
            librarySearch={librarySearch}
            setLibrarySearch={setLibrarySearch}
            libraryFilter={libraryFilter}
            setLibraryFilter={setLibraryFilter}
            shortcutHint={shortcuts.format("command-palette:open")}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onOpenLocations={() => {
              routing.setActiveView("settings");
              routing.setSettingsTab("locations");
            }}
            onOpenNewProject={() => setWizardOpen(true)}
            onOpenSettingsTab={(tab) => {
              routing.setActiveView("settings");
              routing.setSettingsTab(tab);
            }}
            onOpenScreenshotSelector={() =>
              void screenshot.openSelector((k, a) => t(k, a) as string)
            }
          />
          <SidebarInset class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Toaster position="bottom-right" richColors />
            <AppMainView
              routing={routing}
              librarySearch={librarySearch}
              setLibrarySearch={setLibrarySearch}
              libraryFilter={libraryFilter}
              setLibraryFilter={setLibraryFilter}
              projectName={title.titleBarProjectQ.data?.name}
              projectId={routing.projectDetailId()}
              updateVersion={updateInfo()?.version}
              setLocale={setLocale}
              onShowProcesses={() => routing.setActiveView("processes")}
              onToggleTerminal={() => globalTerminal.setOpen(!globalTerminal.open())}
              onOpenUpdatePopup={() => setUpdatePopupOpen(true)}
            />
          </SidebarInset>
        </div>
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
            routing.openProject(id, "terminal");
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
