import { createSignal, onMount, onCleanup, For, type Component } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "~/components/ui/button";
import { PluginDocsDialog } from "./PluginDocsDialog";
import { MonorepoInstallDialog } from "./MonorepoInstallDialog";
import { PluginRow } from "./PluginRow";
import { StoreTab } from "./StoreTab";
import { ProfileTab } from "./ProfileTab";
import { LogsTab } from "./LogsTab";
import { useNotificationCenter } from "~/lib/notification-store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { useI18n } from "~/lib/i18n-context";
import { settingElementId } from "../lib/settings-index";
import { pluginLocaleString, type PluginConfigItem, type PluginInfo } from "../model/pluginTypes";
import { createPluginListModel } from "../model/usePluginList";
import { createPluginConfigModel } from "../model/usePluginConfig";
import { createPluginUpdatesModel } from "../model/usePluginUpdates";
import { createPluginInstallModel } from "../model/usePluginInstall";
import { createPluginLogsModel } from "../model/usePluginLogs";

export const PluginDashboard: Component<{
  t: (key: string, params?: Record<string, unknown>) => string;
}> = (props) => {
  const center = useNotificationCenter();
  const queryClient = useQueryClient();
  const { locale } = useI18n();

  const pluginName = (plugin: PluginInfo) =>
    pluginLocaleString(plugin, locale(), "name") || plugin.name || plugin.id;
  const pluginDescription = (plugin: PluginInfo) =>
    pluginLocaleString(plugin, locale(), "description") || plugin.description;
  const configLabel = (plugin: PluginInfo, cfg: PluginConfigItem) =>
    pluginLocaleString(plugin, locale(), `config_${cfg.key}_label`) || cfg.label;
  const configDescription = (plugin: PluginInfo, cfg: PluginConfigItem) =>
    pluginLocaleString(plugin, locale(), `config_${cfg.key}_desc`) || cfg.description;
  const configOptionLabel = (
    plugin: PluginInfo,
    cfg: PluginConfigItem,
    opt: { id: string; label: string },
  ) =>
    pluginLocaleString(plugin, locale(), `config_${cfg.key}_option_${opt.id}`) ||
    (cfg.key === "footer_position"
      ? pluginLocaleString(plugin, locale(), `option_${opt.id}`)
      : undefined) ||
    opt.label;

  // Shell state (stays local); domain state lives in model/*.
  const [activeTab, setActiveTab] = createSignal<"plugins" | "store" | "profile" | "logs">(
    "plugins",
  );
  const [busy, setBusy] = createSignal(false);
  const [docsOpen, setDocsOpen] = createSignal(false);

  const t = props.t;
  const notify = center.notify;
  const list = createPluginListModel({ t, notify, setBusy });
  const config = createPluginConfigModel({
    notify,
    setBusy,
    plugins: list.plugins,
    fetchPlugins: list.fetchPlugins,
  });
  const updates = createPluginUpdatesModel({
    t,
    notify,
    setBusy,
    fetchPlugins: list.fetchPlugins,
    invalidatePluginUpdateQueries: () =>
      void queryClient.invalidateQueries({ queryKey: ["plugins", "updates"] }),
  });
  const install = createPluginInstallModel({
    t,
    notify,
    setBusy,
    plugins: list.plugins,
    fetchPlugins: list.fetchPlugins,
    setActiveTab,
  });
  const logs = createPluginLogsModel({
    t,
    plugins: list.plugins,
    activeTab,
    pluginName,
  });

  // Log-console state lives in model/usePluginLogs; LogsTab consumes it.

  const handleCheckUpdates = updates.handleCheckUpdates;

  const handleUpdateAll = updates.handleUpdateAll;

  // Install from a Git URL — first discovers what the repo offers, then either
  // opens the multi-select picker (monorepo with >1 entry) or installs directly.
  const commitInstall = install.commitInstall;

  // Live-link / monorepo-install state + handlers live in model/usePluginInstall.
  const localDiscovery = install.localDiscovery;
  const commitLocalInstall = install.commitLocalInstall;

  // Sync Lockfile
  const handleSyncLockfile = install.handleSyncLockfile;

  // Restore Lockfile
  const handleOpenPluginsDir = install.handleOpenPluginsDir;

  const handleSyncVendorLockfile = install.handleSyncVendorLockfile;

  const handleRestoreVendorLock = install.handleRestoreVendorLock;

  const handleRestore = install.handleRestore;

  onMount(() => {
    let unlistenReload: (() => void) | undefined;
    let unlistenDiscoveries: (() => void) | undefined;
    void listen("plugin:reload", () => {
      void list.fetchPlugins();
      void install.refreshDiscoveries();
    }).then((fn) => {
      unlistenReload = fn;
    });
    void listen("plugin:discoveries", () => {
      void install.refreshDiscoveries();
    }).then((fn) => {
      unlistenDiscoveries = fn;
    });
    onCleanup(() => {
      unlistenReload?.();
      unlistenDiscoveries?.();
    });

    void list.fetchPlugins();
    void install.refreshDiscoveries();

    void invoke<string>("get_official_plugins_repo")
      .then((repo) => install.setOfficialRepo(repo))
      .catch(() => {});

    if (isTauri()) {
      void invoke("refresh_plugins_from_repos").catch((e: unknown) => {
        console.debug("refresh_plugins_from_repos:", e);
      });
    }
  });

  // Derived stats live in model/*.
  const plugins = list.plugins;
  const totalPlugins = list.totalPlugins;
  const activeCount = list.activeCount;
  const lazyCount = list.lazyCount;
  const localCount = list.localCount;
  const totalLoadTime = list.totalLoadTime;
  const pendingUpdates = updates.pendingUpdates;
  const discovery = install.discovery;

  return (
    <div
      id={settingElementId("plugins")}
      class="flex flex-1 flex-col gap-6 animate-in fade-in duration-300 select-none"
    >
      {/* stats header dashboard */}
      <div class="grid shrink-0 grid-cols-2 md:grid-cols-5 gap-3 bg-muted/10 border border-muted/30 rounded-lg p-3 relative overflow-hidden backdrop-blur">
        <div class="flex flex-col">
          <span class="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
            <span class="iconify mdi--package-variant size-3.5 shrink-0" aria-hidden="true" />
            {props.t("pluginsDashboard.totalPlugins")}
          </span>
          <span class="text-xl font-bold font-mono text-foreground">{totalPlugins()}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] text-emerald-400 uppercase font-bold tracking-wider flex items-center gap-1">
            <span
              class="iconify mdi--play-circle-outline size-3.5 shrink-0 text-emerald-400"
              aria-hidden="true"
            />
            {props.t("pluginsDashboard.activeCount")}
          </span>
          <span class="text-xl font-bold font-mono text-emerald-400">{activeCount()}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] text-amber-400 uppercase font-bold tracking-wider flex items-center gap-1">
            <span class="iconify mdi--flash size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            {props.t("pluginsDashboard.lazyCount")}
          </span>
          <span class="text-xl font-bold font-mono text-amber-400">{lazyCount()}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] text-sky-400 uppercase font-bold tracking-wider flex items-center gap-1">
            <span
              class="iconify mdi--folder-outline size-3.5 shrink-0 text-sky-400"
              aria-hidden="true"
            />
            {props.t("pluginsDashboard.localCount")}
          </span>
          <span class="text-xl font-bold font-mono text-sky-400">{localCount()}</span>
        </div>
        <div class="flex flex-col col-span-2 md:col-span-1 justify-center">
          <span class="text-[10px] text-primary uppercase font-bold tracking-wider flex items-center gap-1">
            <span
              class="iconify mdi--timer-outline size-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {props.t("pluginsDashboard.loadSpeed")}
          </span>
          <span class="text-xl font-extrabold font-mono text-primary animate-pulse flex items-center gap-1">
            {totalLoadTime().toFixed(1)}ms
          </span>
        </div>
      </div>

      <Tabs
        value={activeTab()}
        onChange={(val) => setActiveTab(val as "plugins" | "store" | "profile" | "logs")}
        class="flex min-h-0 flex-1 flex-col gap-6"
      >
        <div class="flex shrink-0 flex-col gap-2 border-b border-muted/20 pb-3">
          <TabsList class="grid h-9 w-full grid-cols-4 gap-1 rounded border border-muted/40 bg-muted/30 p-0.5">
            <TabsTrigger
              value="plugins"
              class="h-7 w-full min-w-0 justify-center truncate px-2 text-xs font-semibold rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {props.t("pluginsDashboard.tabInstalled")}
            </TabsTrigger>
            <TabsTrigger
              value="store"
              class="h-7 w-full min-w-0 justify-center truncate px-2 text-xs font-semibold rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {props.t("pluginsDashboard.tabStore")}
            </TabsTrigger>
            <TabsTrigger
              value="profile"
              class="h-7 w-full min-w-0 justify-center truncate px-2 text-xs font-semibold rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {props.t("pluginsDashboard.tabProfiler")}
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              class="h-7 w-full min-w-0 justify-center truncate px-2 text-xs font-semibold rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {props.t("pluginsDashboard.tabLogs")}
            </TabsTrigger>
          </TabsList>

          <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start">
            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleOpenPluginsDir()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span
                  class="iconify mdi--folder-open-outline size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {props.t("pluginsDashboard.openPluginsDir")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy()}
                onClick={() => setDocsOpen(true)}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span
                  class="iconify mdi--book-open-page-variant size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {props.t("pluginsDashboard.devGuideBtn")}
              </Button>
            </div>
            <div class="hidden h-6 w-px shrink-0 bg-muted/50 sm:block" aria-hidden="true" />
            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleCheckUpdates()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--refresh size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.checkUpdates")}
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={busy() || pendingUpdates().length === 0}
                onClick={() => void handleUpdateAll()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--download size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.updateAll")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleSyncLockfile()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--content-save size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.syncLockfile")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleRestore()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--restore size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.restoreLock")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleSyncVendorLockfile()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--package-down size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.syncVendorLock")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() => void handleRestoreVendorLock()}
                class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span class="iconify mdi--package-variant size-3.5 shrink-0" aria-hidden="true" />
                {props.t("pluginsDashboard.restoreVendorLock")}
              </Button>
            </div>
          </div>
        </div>

        {/* Main Tabs Content */}
        <TabsContent value="plugins" class="mt-0 space-y-3 outline-none">
          <For each={plugins()}>
            {(plugin) => (
              <PluginRow
                plugin={plugin}
                t={t}
                busy={busy}
                list={list}
                config={config}
                updates={updates}
                install={install}
                labels={{
                  pluginName,
                  pluginDescription,
                  configLabel,
                  configDescription,
                  configOptionLabel,
                }}
              />
            )}
          </For>
        </TabsContent>

        {/* Store & Installation registry */}
        <TabsContent value="store" class="mt-0 space-y-6 outline-none">
          <StoreTab t={t} busy={busy} install={install} />
        </TabsContent>

        {/* Profiler loading timings bar chart */}
        <TabsContent value="profile" class="mt-0 space-y-4 outline-none">
          <ProfileTab t={t} plugins={plugins} totalLoadTime={totalLoadTime} />
        </TabsContent>
        {/* Log Console Tab */}
        <TabsContent value="logs" class="mt-0 flex min-h-0 flex-1 flex-col gap-3 outline-none">
          <LogsTab t={t} activeTab={activeTab} logs={logs} />
        </TabsContent>
      </Tabs>

      <PluginDocsDialog open={docsOpen()} onOpenChange={setDocsOpen} t={props.t} />

      <MonorepoInstallDialog
        t={props.t}
        discovery={discovery()}
        busy={busy()}
        onCancel={() => install.setDiscovery(null)}
        onInstall={async (selectedIds) => {
          const info = discovery();
          if (!info) return;
          await commitInstall(info, selectedIds);
        }}
      />

      <MonorepoInstallDialog
        t={props.t}
        discovery={localDiscovery()?.discovery ?? null}
        busy={busy()}
        onCancel={() => install.setLocalDiscovery(null)}
        onInstall={async (selectedIds) => {
          await commitLocalInstall(selectedIds);
        }}
      />
    </div>
  );
};
