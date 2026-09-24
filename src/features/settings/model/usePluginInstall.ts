import { createMemo, createSignal } from "solid-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import type { Accessor, Setter } from "solid-js";

import type { NotificationCenterApi } from "~/lib/notification-store";
import { unknownErrorMessage } from "~/lib/invoke-error";
import type { MonorepoDiscovery } from "../components/MonorepoInstallDialog";
import { type DiscoveredRepo, type PluginInfo, type TFunction } from "./pluginTypes";

/**
 * Install domain: git/local/discovered flows, lockfiles, discoveries.
 * (Extracted verbatim from PluginDashboard.)
 */
export function createPluginInstallModel(opts: {
  t: TFunction;
  notify: NotificationCenterApi["notify"];
  setBusy: Setter<boolean>;
  plugins: Accessor<PluginInfo[]>;
  fetchPlugins: () => Promise<void>;
  setActiveTab: Setter<"plugins" | "store" | "profile" | "logs">;
}) {
  const { t, notify, setBusy, plugins, fetchPlugins, setActiveTab } = opts;
  const [customRepoUrl, setCustomRepoUrl] = createSignal("");
  const [officialRepo, setOfficialRepo] = createSignal("https://github.com/ur-wesley/pv-plugins");
  const [discovery, setDiscovery] = createSignal<MonorepoDiscovery | null>(null);
  const [discoveredRepos, setDiscoveredRepos] = createSignal<DiscoveredRepo[]>([]);

  type LocalFolderEntry = {
    id: string;
    dir: string | null;
    name: string | null;
    description: string | null;
    version: string | null;
    category: string | null;
    existing: boolean;
  };

  type LocalFolderDiscovery = {
    srcPath: string;
    kind: "single" | "monorepo";
    entries: LocalFolderEntry[];
  };

  const [localDiscovery, setLocalDiscovery] = createSignal<{
    srcPath: string;
    discovery: MonorepoDiscovery;
  } | null>(null);

  const officialPluginsInstalled = createMemo(() => {
    const repo = officialRepo()
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    return plugins().some((p) => p.repo?.replace(/\.git$/, "").replace(/\/$/, "") === repo);
  });

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
      await commitInstall(
        info,
        info.entries.map((e) => e.id),
      );
      setCustomRepoUrl("");
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
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
    notify({
      severity: "info",
      title: t("pluginsDashboard.notifyInstalling"),
      body: t("pluginsDashboard.notifyInstallingDesc", { url: info.repo }),
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
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyInstalledSuccess"),
        body: t("pluginsDashboard.notifyInstalledSuccessDesc"),
        durationMs: 4000,
      });
      setDiscovery(null);
      await fetchPlugins();
      await refreshDiscoveries();
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Live-link a local plugin folder: the app reads the sources in place, so
  // edits hot-reload in dev and release builds — no git push, no re-import.
  // Accepts a single plugin folder (init.luau) or a monorepo root
  // (plugins.registry.luau), in which case a picker dialog chooses entries.
  const linkLocalEntry = async (
    srcRoot: string,
    entry: { id: string; dir: string | null },
    overwrite: boolean,
  ) => {
    const id = await invoke<string>("install_plugin_local", {
      srcPath: srcRoot,
      pluginId: entry.id,
      overwrite,
      subdir: entry.dir,
    });
    notify({
      severity: "success",
      title: t("pluginsDashboard.notifyLocalInstalled"),
      body: t("pluginsDashboard.notifyLocalInstalledDesc", { id }),
      durationMs: 5000,
    });
    await fetchPlugins();
    await refreshDiscoveries();
    setActiveTab("plugins");
  };

  // Link one entry, asking once when it would replace an installed plugin
  // (e.g. the store version of the same id).
  const handleLocalEntryInstall = async (
    srcRoot: string,
    entry: { id: string; dir: string | null },
  ) => {
    setBusy(true);
    try {
      await linkLocalEntry(srcRoot, entry, false);
    } catch (e: unknown) {
      const msg = unknownErrorMessage(e);
      if (msg.includes("already installed")) {
        const yes = await ask(msg + "\n\nReplace it with a link to the selected folder?", {
          title: t("pluginsDashboard.localExistsTitle"),
          kind: "warning",
        });
        if (yes) {
          try {
            await linkLocalEntry(srcRoot, entry, true);
          } catch (retryErr: unknown) {
            notify({
              severity: "error",
              title: t("pluginsDashboard.notifyInstallFailed"),
              body: unknownErrorMessage(retryErr),
              durationMs: 6000,
            });
          }
        }
      } else {
        notify({
          severity: "error",
          title: t("pluginsDashboard.notifyInstallFailed"),
          body: msg,
          durationMs: 6000,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleInstallLocal = async () => {
    if (!isTauri()) return;
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Pick a plugin folder or monorepo root",
    });
    const srcPath = Array.isArray(picked) ? picked[0] : picked;
    if (!srcPath) return;
    setBusy(true);
    notify({
      severity: "info",
      title: t("pluginsDashboard.notifyLocalInstalling"),
      body: t("pluginsDashboard.notifyLocalInstallingDesc", { path: srcPath }),
      durationMs: 3000,
    });
    try {
      const info = await invoke<LocalFolderDiscovery>("discover_local_folder", { srcPath });
      if (info.kind === "single" || info.entries.length <= 1) {
        const entry = info.entries[0];
        setBusy(false);
        await handleLocalEntryInstall(info.srcPath, entry);
        return;
      }
      const slug =
        info.srcPath
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() ?? info.srcPath;
      setLocalDiscovery({
        srcPath: info.srcPath,
        discovery: {
          repo: info.srcPath,
          slug,
          branch: null,
          tag: null,
          commit: null,
          kind: "monorepo",
          entries: info.entries,
        },
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
        body: unknownErrorMessage(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Link every dialog-selected monorepo entry. Selection is explicit, so
  // existing installations are replaced without a second confirm.
  const commitLocalInstall = async (selectedIds: string[]) => {
    const pending = localDiscovery();
    if (!pending || selectedIds.length === 0) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        const entry = pending.discovery.entries.find((e) => e.id === id);
        if (!entry) continue;
        await linkLocalEntry(pending.srcPath, entry, true);
      }
      setLocalDiscovery(null);
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
        body: unknownErrorMessage(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Point an installed local (non-git) plugin at a different source folder.
  const handleRelinkLocal = async (pluginId: string) => {
    if (!isTauri()) return;
    const picked = await open({
      directory: true,
      multiple: false,
      title: `Pick the source folder for '${pluginId}'`,
    });
    const srcPath = Array.isArray(picked) ? picked[0] : picked;
    if (!srcPath) return;
    setBusy(true);
    try {
      await invoke("reimport_plugin_local", { pluginId, srcPath });
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyLocalInstalled"),
        body: t("pluginsDashboard.notifyLocalInstalledDesc", { id: pluginId }),
        durationMs: 4000,
      });
      await fetchPlugins();
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
        body: unknownErrorMessage(e),
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
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyInstalledSuccess"),
        body: t("pluginsDashboard.notifyInstalledSuccessDesc"),
        durationMs: 4000,
      });
      await fetchPlugins();
      await refreshDiscoveries();
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyInstallFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  // Sync Lockfile
  const handleSyncLockfile = async () => {
    setBusy(true);
    try {
      await invoke("sync_lockfile");
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyLockfileSynced"),
        body: t("pluginsDashboard.notifyLockfileSyncedDesc"),
        durationMs: 3000,
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyLockfileSyncFailed"),
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
      notify({
        severity: "error",
        title: t("pluginsDashboard.openPluginsDirFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    }
  };

  const handleSyncVendorLockfile = async () => {
    setBusy(true);
    try {
      await invoke("sync_vendor_lockfile_cmd");
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyVendorLockSynced"),
        body: t("pluginsDashboard.notifyVendorLockSyncedDesc"),
        durationMs: 3000,
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyVendorLockSyncFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreVendorLock = async () => {
    if (!confirm(t("pluginsDashboard.restoreVendorConfirm"))) {
      return;
    }
    setBusy(true);
    try {
      await invoke("restore_vendor_lockfile_cmd");
      await fetchPlugins();
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyVendorRestoreComplete"),
        body: t("pluginsDashboard.notifyVendorRestoreCompleteDesc"),
        durationMs: 4000,
      });
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyVendorRestoreFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm(t("pluginsDashboard.restoreConfirm"))) {
      return;
    }
    setBusy(true);
    try {
      await invoke("restore_from_lockfile");
      notify({
        severity: "success",
        title: t("pluginsDashboard.notifyRestoreComplete"),
        body: t("pluginsDashboard.notifyRestoreCompleteDesc"),
        durationMs: 4000,
      });
      await fetchPlugins();
    } catch (e: unknown) {
      notify({
        severity: "error",
        title: t("pluginsDashboard.notifyRestoreFailed"),
        body: e instanceof Error ? e.message : String(e),
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    customRepoUrl,
    setCustomRepoUrl,
    officialRepo,
    setOfficialRepo,
    discovery,
    setDiscovery,
    discoveredRepos,
    localDiscovery,
    setLocalDiscovery,
    officialPluginsInstalled,
    refreshDiscoveries,
    handleInstallGit,
    commitInstall,
    handleLocalEntryInstall,
    handleInstallLocal,
    commitLocalInstall,
    handleRelinkLocal,
    handleInstallDiscovered,
    handleSyncLockfile,
    handleOpenPluginsDir,
    handleSyncVendorLockfile,
    handleRestoreVendorLock,
    handleRestore,
  };
}
