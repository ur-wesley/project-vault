import { createSignal, onMount, onCleanup, createMemo, createEffect, For, Show, type Component } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "~/components/ui/button";
import { PluginDocsDialog } from "./PluginDocsDialog";
import { MonorepoInstallDialog, type MonorepoDiscovery } from "./MonorepoInstallDialog";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { useNotificationCenter } from "~/lib/notification-center";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Select } from "~/components/ui/select";
import { getPluginLogStore } from "~/lib/plugin-log-store";

// Interfaces
interface PluginCommandMetadata {
  id: string;
  title: string;
  scope: string;
  pluginId: string;
  locales?: Record<string, unknown>;
}

interface PluginConfigItem {
  key: string;
  label: string;
  description?: string;
  type: string;
  default?: string;
  options?: { id: string; label: string }[];
}

interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  enabled: boolean;
  commands: PluginCommandMetadata[];
  locales?: Record<string, unknown>;
  options?: { id: string; label: string }[];
  activeOption?: string;
  config?: PluginConfigItem[];
  // Lazy loading additions
  lazy: boolean;
  active: boolean;
  loadTimeMs: number;
  repo?: string;
  dir?: string;
  dependencies: string[];
  externals: string[];
}

interface DiscoveredPlugin {
  id: string;
  name: string | null;
  description: string | null;
  version: string | null;
  category: string | null;
}

interface DiscoveredRepo {
  repo: string;
  slug: string;
  entries: DiscoveredPlugin[];
}

function asPluginOptionList(value: unknown): { id: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { id: string; label: string } =>
      item != null &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { label?: unknown }).label === "string",
  );
}

function asPluginConfigList(value: unknown): PluginConfigItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PluginConfigItem =>
      item != null &&
      typeof item === "object" &&
      typeof (item as PluginConfigItem).key === "string" &&
      typeof (item as PluginConfigItem).label === "string" &&
      typeof (item as PluginConfigItem).type === "string",
  );
}

function pluginHasSettings(plugin: PluginInfo): boolean {
  return asPluginOptionList(plugin.options).length > 0 || asPluginConfigList(plugin.config).length > 0;
}

function normalizeHexColor(value: string, fallback = "#000000"): string {
  let hex = value.trim();
  if (!hex) return fallback;
  if (!hex.startsWith("#")) hex = `#${hex}`;
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  return fallback;
}

export const PluginDashboard: Component<{ t: (key: string, params?: Record<string, unknown>) => string }> = (props) => {
  const center = useNotificationCenter();
  const queryClient = useQueryClient();
  const logStore = getPluginLogStore();

  // State
  const [plugins, setPlugins] = createSignal<PluginInfo[]>([]);
  const [activeTab, setActiveTab] = createSignal<"plugins" | "store" | "profile" | "logs">("plugins");
  
  const [busy, setBusy] = createSignal(false);
  const [customRepoUrl, setCustomRepoUrl] = createSignal("");
  const [pendingUpdates, setPendingUpdates] = createSignal<string[]>([]);
  const [logFilter, setLogFilter] = createSignal<"all" | "info" | "error">("all");
  const [logPluginFilter, setLogPluginFilter] = createSignal("all");
  const [expandedPlugin, setExpandedPlugin] = createSignal<string | null>(null);
  const [configValues, setConfigValues] = createSignal<Record<string, Record<string, string>>>({});
  const [officialRepo, setOfficialRepo] = createSignal("https://github.com/ur-wesley/pv-plugins");
  const [docsOpen, setDocsOpen] = createSignal(false);

  const [discovery, setDiscovery] = createSignal<MonorepoDiscovery | null>(null);
  const [discoveredRepos, setDiscoveredRepos] = createSignal<DiscoveredRepo[]>([]);

  const officialPluginsInstalled = createMemo(() => {
    const repo = officialRepo().replace(/\.git$/, "").replace(/\/$/, "");
    return plugins().some((p) => p.repo?.replace(/\.git$/, "").replace(/\/$/, "") === repo);
  });

  const handleExpand = async (pluginId: string) => {
    const nextVal = expandedPlugin() === pluginId ? null : pluginId;
    setExpandedPlugin(nextVal);
    
    if (nextVal) {
      const pluginObj = plugins().find(p => p.id === pluginId);
      const configItems = asPluginConfigList(pluginObj?.config);
      if (configItems.length > 0) {
        const values: Record<string, string> = {};
        for (const item of configItems) {
          const dbKey = `plugin:${pluginId}:${item.key}`;
          try {
            const val = await invoke<string | null>("get_setting", { key: dbKey });
            values[item.key] = val !== null ? val : (item.default || "");
          } catch (e: unknown) {
            console.error("Failed to load setting:", e);
            values[item.key] = item.default || "";
          }
        }
        setConfigValues(prev => ({ ...prev, [pluginId]: values }));
      }
    }
  };

  const handleSelectPreset = async (pluginId: string, optionId: string) => {
    setBusy(true);
    try {
      const dbKey = `plugin:${pluginId}:active_flavor`;
      await invoke("set_setting", { key: dbKey, value: optionId });
      
      const pluginObj = plugins().find(p => p.id === pluginId);
      if (pluginObj && pluginObj.active && pluginObj.enabled) {
        await invoke("execute_plugin_command", {
          pluginId,
          commandId: "apply_theme",
          context: { flavor: optionId }
        });
      }
      
      center.notify({
        severity: "success",
        title: "Preset Option Selected",
        body: `Applied flavor: ${optionId}`,
        durationMs: 3000,
      });

      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to select preset:", e);
      center.notify({
        severity: "error",
        title: "Preset Selection Failed",
        body: e instanceof Error ? e.message : String(e),
        durationMs: 4000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (pluginId: string, key: string, value: string) => {
    try {
      const dbKey = `plugin:${pluginId}:${key}`;
      await invoke("set_setting", { key: dbKey, value });

      setConfigValues(prev => ({
        ...prev,
        [pluginId]: {
          ...(prev[pluginId] || {}),
          [key]: value
        }
      }));

      const pluginObj = plugins().find(p => p.id === pluginId);
      if (pluginObj && pluginObj.active && pluginObj.enabled) {
        await invoke("execute_plugin_command", {
          pluginId,
          commandId: "init",
          context: {}
        });
      }
    } catch (e: unknown) {
      console.error("Failed to save config:", e);
    }
  };

  let logsContainerRef: HTMLDivElement | undefined;

  // Fetch all plugins
  const fetchPlugins = async () => {
    try {
      const res = await invoke<PluginInfo[]>("list_plugins");
      setPlugins(
        res.map((plugin) => ({
          ...plugin,
          commands: Array.isArray(plugin.commands) ? plugin.commands : [],
          options: asPluginOptionList(plugin.options),
          config: asPluginConfigList(plugin.config),
        })),
      );
    } catch (e: unknown) {
      console.error("Failed to list plugins:", e);
    }
  };

  // Check for updates
  const handleCheckUpdates = async () => {
    setBusy(true);
    center.notify({
      severity: "info",
      title: props.t("pluginsDashboard.notifyCheckingUpdates"),
      body: props.t("pluginsDashboard.notifyCheckingUpdatesDesc"),
      durationMs: 3000,
    });
    try {
      const updates = await invoke<string[]>("check_plugin_updates");
      setPendingUpdates(updates);
      if (updates.length > 0) {
        center.notify({
          severity: "success",
          title: props.t("pluginsDashboard.notifyUpdatesFound"),
          body: props.t("pluginsDashboard.notifyUpdatesFoundDesc", { count: updates.length }),
          durationMs: 5000,
        });
      } else {
        center.notify({
          severity: "info",
          title: props.t("pluginsDashboard.notifyUpToDate"),
          body: props.t("pluginsDashboard.notifyUpToDateDesc"),
          durationMs: 3000,
        });
      }
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyUpdateCheckFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshPendingUpdates = async () => {
    try {
      const updates = await invoke<string[]>("check_plugin_updates");
      setPendingUpdates(updates);
    } catch {
      setPendingUpdates([]);
    }
    void queryClient.invalidateQueries({ queryKey: ["plugins", "updates"] });
  };

  const refreshDiscoveries = async () => {
    if (!isTauri()) return;
    try {
      const list = await invoke<DiscoveredRepo[]>("get_pending_discoveries");
      setDiscoveredRepos(list ?? []);
    } catch (e) {
      console.error("Failed to fetch discoveries:", e);
      setDiscoveredRepos([]);
    }
  };

  const handleUpdatePlugin = async (pluginId: string) => {
    setBusy(true);
    center.notify({
      severity: "info",
      title: props.t("pluginsDashboard.notifyUpdatingPlugin"),
      body: props.t("pluginsDashboard.notifyUpdatingPluginDesc"),
      durationMs: 3000,
    });
    try {
      await invoke("update_plugin_git", { pluginId });
      await fetchPlugins();
      await refreshPendingUpdates();
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyPluginUpdated"),
        body: props.t("pluginsDashboard.notifyPluginUpdatedDesc"),
        durationMs: 4000,
      });
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyPluginUpdateFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateAll = async () => {
    const pending = pendingUpdates();
    if (pending.length === 0) return;
    setBusy(true);
    center.notify({
      severity: "info",
      title: props.t("pluginsDashboard.notifyUpdatingAll"),
      body: props.t("pluginsDashboard.notifyUpdatingAllDesc"),
      durationMs: 3000,
    });
    try {
      const updated = await invoke<string[]>("update_all_plugins");
      await fetchPlugins();
      await refreshPendingUpdates();
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyAllUpdated"),
        body: props.t("pluginsDashboard.notifyAllUpdatedDesc", { count: updated.length }),
        durationMs: 5000,
      });
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyAllUpdateFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Toggle enable/disable
  const handleToggle = async (plugin: PluginInfo) => {
    setBusy(true);
    try {
      const nextState = !plugin.enabled;
      await invoke("toggle_plugin", { pluginId: plugin.id, enabled: nextState });
      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to toggle plugin:", e);
    } finally {
      setBusy(false);
    }
  };

  // Install from a Git URL — first discovers what the repo offers, then either
  // opens the multi-select picker (monorepo with >1 entry) or installs directly.
  const handleInstallGit = async (repoUrl: string) => {
    if (!repoUrl.trim()) return;
    setBusy(true);
    try {
      const info = await invoke<MonorepoDiscovery>("discover_monorepo", {
        repo: repoUrl.trim(),
        branch: null,
        tag: null,
        commit: null,
      });
      if (info.kind === "monorepo" && info.entries.length > 1) {
        setDiscovery(info);
        return;
      }
      await commitInstall(info, info.entries.map((e) => e.id));
      setCustomRepoUrl("");
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyInstallFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  const commitInstall = async (info: MonorepoDiscovery, selectedIds: string[]) => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    center.notify({
      severity: "info",
      title: props.t("pluginsDashboard.notifyInstalling"),
      body: props.t("pluginsDashboard.notifyInstallingDesc", { url: info.repo }),
      durationMs: 3000,
    });
    try {
      await invoke("install_plugin_git", {
        repo: info.repo,
        branch: info.branch ?? null,
        tag: info.tag ?? null,
        commit: info.commit ?? null,
        selectedIds,
      });
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyInstalledSuccess"),
        body: props.t("pluginsDashboard.notifyInstalledSuccessDesc"),
        durationMs: 4000,
      });
      setDiscovery(null);
      await fetchPlugins();
      await refreshDiscoveries();
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyInstallFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleInstallDiscovered = async (repo: DiscoveredRepo, pluginIds: string[]) => {
    if (pluginIds.length === 0) return;
    setBusy(true);
    try {
      await invoke("install_plugin_git", {
        repo: repo.repo,
        branch: null,
        tag: null,
        commit: null,
        selectedIds: pluginIds,
      });
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyInstalledSuccess"),
        body: props.t("pluginsDashboard.notifyInstalledSuccessDesc"),
        durationMs: 4000,
      });
      await fetchPlugins();
      await refreshDiscoveries();
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyInstallFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Uninstall plugin
  const handleUninstall = async (pluginId: string) => {
    if (!confirm(props.t("pluginsDashboard.uninstallConfirm", { id: pluginId }))) {
      return;
    }
    setBusy(true);
    try {
      await invoke("uninstall_plugin", { pluginId });
      center.notify({
        severity: "info",
        title: props.t("pluginsDashboard.notifyUninstalled"),
        body: props.t("pluginsDashboard.notifyUninstalledDesc", { id: pluginId }),
        durationMs: 3000,
      });
      await fetchPlugins();
    } catch (e: unknown) {
      console.error("Failed to uninstall:", e);
    } finally {
      setBusy(false);
    }
  };

  // Sync Lockfile
  const handleSyncLockfile = async () => {
    setBusy(true);
    try {
      await invoke("sync_lockfile");
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyLockfileSynced"),
        body: props.t("pluginsDashboard.notifyLockfileSyncedDesc"),
        durationMs: 3000,
      });
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyLockfileSyncFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Restore Lockfile
  const handleOpenPluginsDir = async () => {
    if (!isTauri()) return;
    try {
      await invoke("open_plugins_dir");
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.openPluginsDirFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    }
  };

  const handleSyncVendorLockfile = async () => {
    setBusy(true);
    try {
      await invoke("sync_vendor_lockfile_cmd");
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyVendorLockSynced"),
        body: props.t("pluginsDashboard.notifyVendorLockSyncedDesc"),
        durationMs: 3000,
      });
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyVendorLockSyncFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreVendorLock = async () => {
    if (!confirm(props.t("pluginsDashboard.restoreVendorConfirm"))) {
      return;
    }
    setBusy(true);
    try {
      await invoke("restore_vendor_lockfile_cmd");
      await fetchPlugins();
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyVendorRestoreComplete"),
        body: props.t("pluginsDashboard.notifyVendorRestoreCompleteDesc"),
        durationMs: 4000,
      });
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyVendorRestoreFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm(props.t("pluginsDashboard.restoreConfirm"))) {
      return;
    }
    setBusy(true);
    center.notify({
      severity: "info",
      title: props.t("pluginsDashboard.notifyRestoring"),
      body: props.t("pluginsDashboard.notifyRestoringDesc"),
      durationMs: 3000,
    });
    try {
      await invoke("restore_from_lockfile");
      center.notify({
        severity: "success",
        title: props.t("pluginsDashboard.notifyRestoreComplete"),
        body: props.t("pluginsDashboard.notifyRestoreCompleteDesc"),
        durationMs: 4000,
      });
      await fetchPlugins();
    } catch (e: unknown) {
      center.notify({
        severity: "error",
        title: props.t("pluginsDashboard.notifyRestoreFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    let unlistenReload: (() => void) | undefined;
    let unlistenDiscoveries: (() => void) | undefined;
    void listen("plugin:reload", () => {
      void fetchPlugins();
      void refreshDiscoveries();
    }).then((fn) => {
      unlistenReload = fn;
    });
    void listen("plugin:discoveries", () => {
      void refreshDiscoveries();
    }).then((fn) => {
      unlistenDiscoveries = fn;
    });
    onCleanup(() => {
      unlistenReload?.();
      unlistenDiscoveries?.();
    });

    void fetchPlugins();
    void refreshDiscoveries();

    void invoke<string>("get_official_plugins_repo")
      .then((repo) => setOfficialRepo(repo))
      .catch(() => {});

    if (isTauri()) {
      void invoke("refresh_plugins_from_repos").catch((e: unknown) => {
        console.debug("refresh_plugins_from_repos:", e);
      });
    }
  });

  // Auto-scroll logs
  createEffect(() => {
    const el = logsContainerRef;
    if (el && logStore.logs().length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  });

  // Derived stats
  const totalPlugins = createMemo(() => plugins().length);
  const activeCount = createMemo(() => plugins().filter((p) => p.active && p.enabled).length);
  const lazyCount = createMemo(() => plugins().filter((p) => p.lazy && !p.active && p.enabled).length);
  const localCount = createMemo(() => plugins().filter((p) => !!p.dir).length);
  const totalLoadTime = createMemo(() =>
    plugins().reduce((acc, p) => acc + (p.active && p.enabled ? p.loadTimeMs : 0), 0)
  );

  type LogPluginOption = { value: string; label: string; textValue: string };

  const logPluginOptions = createMemo((): LogPluginOption[] => {
    const options: LogPluginOption[] = [
      {
        value: "all",
        label: props.t("pluginsDashboard.logFilterPluginAll"),
        textValue: props.t("pluginsDashboard.logFilterPluginAll"),
      },
    ];
    const seen = new Set<string>();
    for (const plugin of plugins()) {
      if (seen.has(plugin.id)) continue;
      seen.add(plugin.id);
      options.push({
        value: plugin.id,
        label: plugin.name || plugin.id,
        textValue: plugin.id,
      });
    }
    for (const log of logStore.logs()) {
      if (seen.has(log.pluginId)) continue;
      seen.add(log.pluginId);
      options.push({
        value: log.pluginId,
        label: log.pluginId,
        textValue: log.pluginId,
      });
    }
    options.sort((a, b) => {
      if (a.value === "all") return -1;
      if (b.value === "all") return 1;
      return a.label.localeCompare(b.label);
    });
    return options;
  });

  const currentLogPluginOption = createMemo(
    () => logPluginOptions().find((o) => o.value === logPluginFilter()) ?? logPluginOptions()[0],
  );

  const filteredLogs = createMemo(() => {
    const pluginId = logPluginFilter();
    return logStore.logs().filter((log) => {
      if (pluginId !== "all" && log.pluginId !== pluginId) return false;
      return logFilter() === "all" || log.level === logFilter();
    });
  });

  return (
    <div class="space-y-6 animate-in fade-in duration-300 select-none">
      
      {/* stats header dashboard */}
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 bg-muted/10 border border-muted/30 rounded-lg p-3 relative overflow-hidden backdrop-blur">
        <div class="flex flex-col">
          <span class="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
            <span class="iconify mdi--package-variant size-3.5 shrink-0" aria-hidden="true" />
            {props.t("pluginsDashboard.totalPlugins")}
          </span>
          <span class="text-xl font-bold font-mono text-foreground">{totalPlugins()}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] text-emerald-400 uppercase font-bold tracking-wider flex items-center gap-1">
            <span class="iconify mdi--play-circle-outline size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
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
            <span class="iconify mdi--folder-outline size-3.5 shrink-0 text-sky-400" aria-hidden="true" />
            {props.t("pluginsDashboard.localCount")}
          </span>
          <span class="text-xl font-bold font-mono text-sky-400">{localCount()}</span>
        </div>
        <div class="flex flex-col col-span-2 md:col-span-1 justify-center">
          <span class="text-[10px] text-primary uppercase font-bold tracking-wider flex items-center gap-1">
            <span class="iconify mdi--timer-outline size-3.5 shrink-0 text-primary" aria-hidden="true" />
            {props.t("pluginsDashboard.loadSpeed")}
          </span>
          <span class="text-xl font-extrabold font-mono text-primary animate-pulse flex items-center gap-1">
            {totalLoadTime().toFixed(1)}ms
          </span>
        </div>
      </div>

    <Tabs value={activeTab()} onChange={(val) => setActiveTab(val as "plugins" | "store" | "profile" | "logs")} class="space-y-6">
      <div class="flex flex-col gap-2 border-b border-muted/20 pb-3">
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
              <span class="iconify mdi--folder-open-outline size-3.5 shrink-0" aria-hidden="true" />
              {props.t("pluginsDashboard.openPluginsDir")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy()}
              onClick={() => setDocsOpen(true)}
              class="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span class="iconify mdi--book-open-page-variant size-3.5 shrink-0" aria-hidden="true" />
              {props.t("pluginsDashboard.devGuideBtn")}
            </Button>
          </div>
          <div
            class="hidden h-6 w-px shrink-0 bg-muted/50 sm:block"
            aria-hidden="true"
          />
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
            <div class="border border-muted/50 bg-muted/5 rounded-lg p-3 transition-all hover:bg-muted/15 flex flex-col gap-2">
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-2">
                  <button
                    onClick={() => handleExpand(plugin.id)}
                    class="text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded shrink-0"
                    aria-label={expandedPlugin() === plugin.id ? props.t("pluginsDashboard.collapseTooltip") : props.t("pluginsDashboard.expandTooltip")}
                  >
                    <span
                      class="iconify mdi--chevron-right size-4 shrink-0 transition-transform duration-200"
                      class:rotate-90={expandedPlugin() === plugin.id}
                      aria-hidden="true"
                    />
                  </button>
                  <span class="text-sm font-bold text-foreground">{plugin.name}</span>
                  <Show when={plugin.version}>
                    <span class="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-muted/30">
                      v{plugin.version}
                    </span>
                  </Show>
                  
                  {/* Category badge */}
                  <Show when={plugin.category}>
                    <Badge variant="secondary" class="text-[9px] py-0 px-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono uppercase tracking-wider">
                      {plugin.category}
                    </Badge>
                  </Show>
                  
                  {/* Status badges */}
                  <Show when={!plugin.enabled}>
                    <Badge variant="outline" class="text-[9px] py-0 px-1 border-muted text-muted-foreground/60">
                      {props.t("pluginsDashboard.disabledBadge")}
                    </Badge>
                  </Show>
                  <Show when={plugin.enabled}>
                    <Show when={plugin.active}>
                      <Badge class="bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] py-0 px-1">
                        {props.t("pluginsDashboard.activeBadge", { time: plugin.loadTimeMs.toFixed(1) })}
                      </Badge>
                    </Show>
                    <Show when={!plugin.active && plugin.lazy}>
                      <Badge class="bg-amber-500/10 hover:bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] py-0 px-1">
                        {props.t("pluginsDashboard.lazyBadge")}
                      </Badge>
                    </Show>
                  </Show>
                  
                  {/* Update indicator */}
                  <Show when={pendingUpdates().includes(plugin.id)}>
                    <span class="rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-400 border border-rose-500/20 animate-pulse">
                      {props.t("pluginsDashboard.updatePendingBadge")}
                    </span>
                  </Show>
                </div>
                
                <div class="flex items-center gap-2 shrink-0">
                  <Show when={pendingUpdates().includes(plugin.id) && plugin.repo}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy()}
                      onClick={() => void handleUpdatePlugin(plugin.id)}
                      class="h-7 px-2 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span class="iconify mdi--download size-3 shrink-0" aria-hidden="true" />
                      {props.t("pluginsDashboard.updatePluginBtn")}
                    </Button>
                  </Show>
                  <Show when={pluginHasSettings(plugin)}>
                    <button
                      type="button"
                      onClick={() => void handleExpand(plugin.id)}
                      disabled={busy()}
                      class="text-muted-foreground hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded p-0.5"
                      title={props.t("pluginsDashboard.pluginSettingsBtn")}
                      aria-label={props.t("pluginsDashboard.pluginSettingsBtn")}
                    >
                      <span class="iconify mdi--cog-outline size-4 shrink-0" aria-hidden="true" />
                    </button>
                  </Show>
                  <Checkbox
                    id={`toggle-dashboard-${plugin.id}`}
                    checked={plugin.enabled}
                    disabled={busy()}
                    onChange={() => void handleToggle(plugin)}
                    class="cursor-pointer"
                    aria-label={props.t("pluginsDashboard.togglePluginLabel", { name: plugin.name })}
                  />
                  <button
                    onClick={() => void handleUninstall(plugin.id)}
                    disabled={busy()}
                    class="text-muted-foreground hover:text-rose-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                    title={props.t("pluginsDashboard.uninstallTooltip")}
                    aria-label={props.t("pluginsDashboard.uninstallTooltip")}
                  >
                    <span class="iconify mdi--trash-can-outline size-4 shrink-0" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <p class="text-xs text-muted-foreground pl-6 leading-relaxed">
                {plugin.description || props.t("pluginsDashboard.noDescription")}
              </p>

              {/* Expanded Details */}
              <Show when={expandedPlugin() === plugin.id}>
                <div class="mt-2 pl-6 pt-2 border-t border-muted/20 text-[11px] font-mono grid grid-cols-1 md:grid-cols-2 gap-3 animate-in slide-in-from-top-1 duration-200">
                  <div class="space-y-1">
                    <div class="flex justify-between py-0.5 border-b border-border/40">
                      <span class="text-muted-foreground">{props.t("pluginsDashboard.pluginIdLabel")}</span>
                      <span class="text-foreground font-bold">{plugin.id}</span>
                    </div>
                    <Show when={plugin.repo}>
                      <div class="flex justify-between py-0.5 border-b border-border/40">
                        <span class="text-muted-foreground">{props.t("pluginsDashboard.sourceRepoLabel")}</span>
                        <span class="text-foreground truncate max-w-[200px]" title={plugin.repo}>{plugin.repo}</span>
                      </div>
                    </Show>
                    <Show when={plugin.dir}>
                      <div class="flex justify-between py-0.5 border-b border-border/40">
                        <span class="text-muted-foreground">{props.t("pluginsDashboard.localPathLabel")}</span>
                        <span class="text-foreground truncate max-w-[200px]" title={plugin.dir}>{plugin.dir}</span>
                      </div>
                    </Show>
                  </div>

                  <div class="space-y-1">
                    <div class="flex justify-between py-0.5 border-b border-border/40">
                      <span class="text-muted-foreground">{props.t("pluginsDashboard.lazyLoadingLabel")}</span>
                      <span class="text-foreground font-bold">{plugin.lazy ? props.t("pluginsDashboard.lazyTrue") : props.t("pluginsDashboard.lazyFalse")}</span>
                    </div>
                    <Show when={plugin.dependencies.length > 0}>
                      <div class="flex justify-between py-0.5 border-b border-border/40">
                        <span class="text-muted-foreground">{props.t("pluginsDashboard.dependenciesLabel")}</span>
                        <span class="text-foreground font-bold">{plugin.dependencies.join(", ")}</span>
                      </div>
                    </Show>
                    <Show when={plugin.externals.length > 0}>
                      <div class="flex justify-between py-0.5 border-b border-border/40">
                        <span class="text-muted-foreground">{props.t("pluginsDashboard.externalsLabel")}</span>
                        <span class="text-foreground font-bold">{plugin.externals.join(", ")}</span>
                      </div>
                    </Show>
                    <div class="flex justify-between py-0.5 border-b border-border/40">
                      <span class="text-muted-foreground">{props.t("pluginsDashboard.commandsLabel")}</span>
                      <span class="text-foreground font-bold">{plugin.commands.length}</span>
                    </div>
                  </div>
                </div>

                {/* Plugin settings option section */}
                <div class="mt-3 pt-3 border-t border-muted/20 text-xs font-sans grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-1 duration-200">
                  
                  {/* Presets/Options selection */}
                  <Show when={asPluginOptionList(plugin.options).length > 0}>
                    <div class="space-y-2">
                      <span class="font-bold text-[10px] text-muted-foreground uppercase tracking-wider block">
                        {props.t("pluginsDashboard.configPresetTitle")}
                      </span>
                      <div class="flex flex-wrap gap-2">
                        <For each={asPluginOptionList(plugin.options)}>
                          {(opt) => {
                            const isActive = () => plugin.activeOption === opt.id || (!plugin.activeOption && opt.id === "mocha");
                            return (
                              <button
                                type="button"
                                onClick={() => void handleSelectPreset(plugin.id, opt.id)}
                                class={`px-2.5 py-1 text-[11px] font-semibold rounded border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isActive() ? "bg-primary border-primary text-primary-foreground shadow-sm" : "bg-muted/20 border-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                              >
                                {opt.label}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* Custom Config fields */}
                  <Show when={asPluginConfigList(plugin.config).length > 0}>
                    <div class="space-y-3">
                      <span class="font-bold text-[10px] text-muted-foreground uppercase tracking-wider block">
                        {props.t("pluginsDashboard.configCustomTitle")}
                      </span>
                      <div class="space-y-2">
                        <For each={asPluginConfigList(plugin.config)}>
                          {(cfg) => {
                            const currentVal = () => (configValues()[plugin.id] || {})[cfg.key] ?? cfg.default ?? "";
                            const fieldId = `cfg-${plugin.id}-${cfg.key}`;
                            return (
                              <div class="flex flex-col gap-1">
                                <label class="font-bold text-[11px] text-foreground/80" for={fieldId}>{cfg.label}</label>
                                <Show when={cfg.description}>
                                  <span class="text-[10px] text-muted-foreground leading-normal">{cfg.description}</span>
                                </Show>
                                
                                <Show when={cfg.type === "select"}>
                                  <select
                                    id={fieldId}
                                    class="bg-background rounded border border-muted/40 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    value={currentVal()}
                                    onChange={(e) => handleSaveConfig(plugin.id, cfg.key, e.currentTarget.value)}
                                  >
                                    <For each={cfg.options}>
                                      {(opt) => (
                                        <option value={opt.id}>{opt.label}</option>
                                      )}
                                    </For>
                                  </select>
                                </Show>

                                <Show when={cfg.type === "boolean"}>
                                  <div class="flex items-center gap-2 mt-0.5">
                                    <Checkbox
                                      id={fieldId}
                                      checked={currentVal() === "true"}
                                      onChange={(checked) => handleSaveConfig(plugin.id, cfg.key, checked ? "true" : "false")}
                                      class="cursor-pointer"
                                      aria-label={cfg.label}
                                    />
                                  </div>
                                </Show>

                                <Show when={cfg.type === "color"}>
                                  <div class="flex gap-2 items-center">
                                    <input
                                      id={fieldId}
                                      type="color"
                                      value={normalizeHexColor(currentVal(), normalizeHexColor(cfg.default ?? "", "#000000"))}
                                      onInput={(e) => handleSaveConfig(plugin.id, cfg.key, e.currentTarget.value)}
                                      class="size-8 shrink-0 cursor-pointer rounded border border-muted/40 bg-background p-0.5"
                                      aria-label={cfg.label}
                                    />
                                    <TextField
                                      value={currentVal()}
                                      onChange={(val) => handleSaveConfig(plugin.id, cfg.key, val)}
                                      class="flex-1"
                                    >
                                      <TextFieldInput
                                        type="text"
                                        placeholder="#000000"
                                        class="h-8 text-xs bg-background border-muted/40 font-mono placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:outline-none"
                                      />
                                    </TextField>
                                  </div>
                                </Show>

                                <Show when={cfg.type !== "select" && cfg.type !== "boolean" && cfg.type !== "color"}>
                                  <TextField
                                    value={currentVal()}
                                    onChange={(val) => handleSaveConfig(plugin.id, cfg.key, val)}
                                    class="flex-1"
                                    id={fieldId}
                                  >
                                    <TextFieldInput
                                      type="text"
                                      class="h-8 text-xs bg-background border-muted/40 placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:outline-none"
                                    />
                                  </TextField>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>

                </div>
              </Show>
            </div>
          )}
        </For>
      </TabsContent>

      {/* Store & Installation registry */}
      <TabsContent value="store" class="mt-0 space-y-6 outline-none">
        {/* Discovered section */}
        <Show when={discoveredRepos().length > 0}>
          <div class="flex flex-col gap-2 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <div class="flex items-center justify-between">
              <h5 class="text-xs font-bold text-amber-400 uppercase tracking-wider">
                {props.t("pluginsDashboard.discoveredSectionTitle")}
              </h5>
              <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 uppercase font-mono tracking-wider">
                {discoveredRepos().reduce((acc, r) => acc + r.entries.length, 0)}
              </span>
            </div>
            <p class="text-[10px] text-muted-foreground/80 leading-normal">
              {props.t("pluginsDashboard.discoveredSectionSubtitle")}
            </p>
            <div class="space-y-3 mt-1">
              <For each={discoveredRepos()}>
                {(repo) => (
                  <div class="border border-muted/40 bg-background/60 rounded-md p-3 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-foreground truncate">{repo.slug}</div>
                        <div class="text-[10px] font-mono text-muted-foreground/70 truncate" title={repo.repo}>
                          {repo.repo}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy()}
                        onClick={() => void handleInstallDiscovered(repo, repo.entries.map((e) => e.id))}
                        class="h-7 px-3 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span class="iconify mdi--download size-3.5 shrink-0" aria-hidden="true" />
                        {props.t("pluginsDashboard.discoveredInstallAllBtn")}
                      </Button>
                    </div>
                    <div class="divide-y divide-muted/30 border border-muted/30 rounded">
                      <For each={repo.entries}>
                        {(entry) => (
                          <div class="flex items-start gap-3 p-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-foreground">
                                  {entry.name || entry.id}
                                </span>
                                <Show when={entry.version}>
                                  <span class="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-muted/30">
                                    v{entry.version}
                                  </span>
                                </Show>
                                <Show when={entry.category}>
                                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase font-mono tracking-wider">
                                    {entry.category}
                                  </span>
                                </Show>
                              </div>
                              <Show when={entry.description}>
                                <p class="text-[10px] text-muted-foreground/80 mt-0.5 leading-normal">
                                  {entry.description}
                                </p>
                              </Show>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy()}
                              onClick={() => void handleInstallDiscovered(repo, [entry.id])}
                              class="h-6 px-2 text-[10px] font-bold"
                            >
                              {props.t("pluginsDashboard.discoveredInstallBtn")}
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Custom Git installer input */}
        <div class="flex flex-col gap-2 p-4 rounded-lg border border-muted/50 bg-muted/5">
          <h5 class="text-xs font-bold text-foreground">{props.t("pluginsDashboard.customInstallTitle")}</h5>
          <div class="flex gap-2 items-center">
            <TextField
              value={customRepoUrl()}
              onChange={setCustomRepoUrl}
              class="flex-1"
              id="custom-git-install"
            >
              <TextFieldInput
                type="text"
                class="h-8 text-xs bg-background border-muted/40 placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:outline-none"
                placeholder="e.g. https://github.com/username/project-vault-plugin"
                onKeyDown={(e) => e.key === "Enter" && handleInstallGit(customRepoUrl())}
              />
            </TextField>
            <Button
              size="sm"
              disabled={busy() || !customRepoUrl().trim()}
              onClick={() => void handleInstallGit(customRepoUrl())}
              class="shrink-0 text-xs px-4 h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {props.t("pluginsDashboard.installBtn")}
            </Button>
          </div>
          <p class="text-[10px] text-muted-foreground/60 leading-normal">
            {props.t("pluginsDashboard.customInstallHint")}
          </p>
        </div>

        {/* Official plugin monorepo */}
        <div class="space-y-3">
          <h5 class="text-xs font-bold text-muted-foreground uppercase tracking-wider">{props.t("pluginsDashboard.officialTitle")}</h5>
          <div class="border border-primary/30 bg-primary/5 rounded-lg p-4 flex flex-col gap-3">
            <div>
              <span class="text-sm font-bold text-foreground">{props.t("pluginsDashboard.officialName")}</span>
              <p class="text-[11px] text-muted-foreground/80 mt-1 leading-normal">
                {props.t("pluginsDashboard.officialDesc")}
              </p>
              <p class="text-[10px] font-mono text-muted-foreground/60 mt-2 truncate" title={officialRepo()}>
                {officialRepo()}
              </p>
            </div>
            <div class="flex items-center justify-between border-t border-muted/10 pt-3">
              <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase font-mono tracking-widest">
                {props.t("pluginsDashboard.officialBadge")}
              </span>
              <Button
                size="sm"
                variant={officialPluginsInstalled() ? "outline" : "default"}
                disabled={busy() || officialPluginsInstalled()}
                onClick={() => void handleInstallGit(officialRepo())}
                class="h-7 px-3 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {officialPluginsInstalled()
                  ? props.t("pluginsDashboard.installedBtn")
                  : props.t("pluginsDashboard.officialInstallBtn")}
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>

      {/* Profiler loading timings bar chart */}
      <TabsContent value="profile" class="mt-0 space-y-4 outline-none">
        <div class="flex justify-between border-b border-muted/20 pb-2">
          <h5 class="text-xs font-bold text-foreground">{props.t("pluginsDashboard.loadTimeBreakdown")}</h5>
          <span class="text-xs text-muted-foreground">
            {props.t("pluginsDashboard.totalLoadTime", { time: totalLoadTime().toFixed(1) })}
          </span>
        </div>

        <div class="space-y-3 font-mono text-[11px]">
          <For each={plugins().filter((p) => p.active && p.enabled).sort((a, b) => b.loadTimeMs - a.loadTimeMs)}>
            {(plugin) => {
              // Calculate percentage width for visual bar
              const pct = createMemo(() => {
                const max = Math.max(...plugins().map((p) => p.loadTimeMs), 1);
                return (plugin.loadTimeMs / max) * 100;
              });

              return (
                <div class="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                  <div class="flex items-center gap-1.5 md:col-span-1">
                    <span class="iconify mdi--flash-outline size-3 shrink-0 text-amber-400" aria-hidden="true" />
                    <span class="truncate font-bold text-foreground">{plugin.id}</span>
                  </div>
                  <div class="md:col-span-2 bg-muted/20 h-2 rounded overflow-hidden">
                    <div class="bg-primary h-full rounded transition-all duration-500" style={{ width: `${pct()}%` }} />
                  </div>
                  <div class="md:col-span-1 text-right text-muted-foreground font-bold text-[10px]">
                    {plugin.loadTimeMs.toFixed(2)}ms
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={plugins().filter((p) => p.active && p.enabled).length === 0}>
            <div class="py-8 text-center text-xs text-muted-foreground font-sans">
              {props.t("pluginsDashboard.noActivePlugins")}
            </div>
          </Show>
        </div>
      </TabsContent>

      {/* Log Console Tab */}
      <TabsContent value="logs" class="mt-0 space-y-3 outline-none">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h5 class="text-xs font-bold text-foreground">{props.t("pluginsDashboard.consoleTitle")}</h5>
          <div class="flex flex-wrap items-center gap-2">
            <Select<LogPluginOption>
              options={logPluginOptions()}
              optionValue="value"
              optionTextValue="textValue"
              value={currentLogPluginOption()}
              onChange={(o) => o && setLogPluginFilter(o.value)}
              itemComponent={(p) => (
                <Select.Item item={p.item}>
                  <Select.ItemLabel>{p.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.Trigger class="h-7 min-w-[8rem] max-w-[12rem] border bg-muted/20 px-2 text-[10px] font-semibold shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Select.Value<LogPluginOption>>
                  {(s) => (
                    <span class="truncate">
                      {s.selectedOption()?.label ?? props.t("pluginsDashboard.logFilterPluginAll")}
                    </span>
                  )}
                </Select.Value>
                <span class="iconify mdi--chevron-down size-3.5 shrink-0 opacity-50" aria-hidden="true" />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select>
            <div class="flex items-center rounded border bg-muted/20 p-0.5">
              <button
                class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logFilter() === "all" ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
                onClick={() => setLogFilter("all")}
              >
                {props.t("pluginsDashboard.logFilterAll")}
              </button>
              <button
                class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logFilter() === "info" ? "bg-background shadow text-emerald-400" : "text-muted-foreground"}`}
                onClick={() => setLogFilter("info")}
              >
                {props.t("pluginsDashboard.logFilterInfo")}
              </button>
              <button
                class={`px-2 py-0.5 text-[9px] font-medium rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${logFilter() === "error" ? "bg-background shadow text-rose-400" : "text-muted-foreground"}`}
                onClick={() => setLogFilter("error")}
              >
                {props.t("pluginsDashboard.logFilterError")}
              </button>
            </div>
            <button
              class="text-muted-foreground hover:text-foreground text-[10px] flex items-center font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              onClick={() => logStore.clear()}
            >
              {props.t("pluginsDashboard.consoleClear")}
            </button>
          </div>
        </div>

        <div
          ref={logsContainerRef}
          class="h-64 rounded-lg border border-muted/50 bg-[#07090e] p-3 font-mono text-[10px] overflow-y-auto scrollbar-thin select-text flex flex-col gap-1.5"
        >
          <Show
            when={filteredLogs().length > 0}
            fallback={
              <div class="flex h-full flex-col items-center justify-center text-muted-foreground/30 font-sans">
                <span class="iconify mdi--console mb-1 size-8 shrink-0" aria-hidden="true" />
                <span class="text-[9px] font-semibold tracking-wide uppercase">{props.t("pluginsDashboard.consoleEmpty")}</span>
              </div>
            }
          >
            <For each={filteredLogs()}>
              {(log) => (
                <div class="flex items-start gap-2 border-b border-white/[0.02] pb-1 last:border-0 leading-relaxed">
                  <span class="text-muted-foreground/50 shrink-0 select-none">
                    [{log.timestamp}]
                  </span>
                  <span class="text-sky-400 font-bold shrink-0 uppercase tracking-wider">
                    {log.pluginId}
                  </span>
                  <span
                    class="font-extrabold shrink-0 select-none"
                    class:text-emerald-500={log.level === "info"}
                    class:text-rose-500={log.level === "error"}
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span
                    class="break-all whitespace-pre-wrap flex-1"
                    class:text-slate-200={log.level === "info"}
                    class:text-rose-300={log.level === "error"}
                  >
                    {log.message}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </TabsContent>
    </Tabs>

      <PluginDocsDialog
        open={docsOpen()}
        onOpenChange={setDocsOpen}
        t={props.t}
      />

      <MonorepoInstallDialog
        t={props.t}
        discovery={discovery()}
        busy={busy()}
        onCancel={() => setDiscovery(null)}
        onInstall={async (selectedIds) => {
          const info = discovery();
          if (!info) return;
          await commitInstall(info, selectedIds);
        }}
      />
  </div>
  );
};
