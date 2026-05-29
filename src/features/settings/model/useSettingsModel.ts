import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { toast } from "solid-sonner";
import { isGithubDeviceConfigured } from "~/services/tauri/github-auth";
import { exportLibrarySnapshot } from "~/services/tauri/projects";
import { listDiscoveredIdes } from "~/services/tauri/ide";
import { listAvailableShells, listDiscoveredTools } from "~/services/tauri/terminal";
import { deleteAllIndices } from "~/services/tauri/search";
import { checkForUpdates, installUpdate } from "~/services/tauri/updates";
import { getAutostartEnabled, setAutostartEnabled } from "~/services/tauri/autostart";
import { getSetting, setSetting } from "~/services/tauri/settings";
import { checkTunnelAvailable, startTunnelProxy, stopTunnelProxy } from "~/services/tauri/tunnel";
import { GITHUB_TOKEN_SETTING_KEY, fetchGitHubViewer } from "~/services/github";
import { runGithubDeviceSignIn } from "~/services/github-device-signin";
import { stableErrorMessage } from "~/lib/invoke-error";
import { queryKeys } from "~/services/query-keys";
import { rescanAllLibraryFolders } from "~/lib/rescan-library";
import type { Locale } from "~/messages";


const SHELL_KEY = "shell_path";
const SCAN_KEY = "scan_interval_minutes";
const DEFAULT_IDE_KEY = "default_ide_path";
const DEFAULT_SHELL_KEY = "default_shell_path";
const LOCALE_KEY = "ui_locale";
const AUTO_INDEX_KEY = "auto_index_projects";
const AUTO_CHECK_UPDATES_KEY = "auto_check_updates";
const AUTO_START_KEY = "auto_start";
const PORTLESS_ENABLED_KEY = "tunnel_portless_enabled";
const PORTLESS_PROXY_PORT_KEY = "tunnel_proxy_port";
const PORTLESS_TLS_KEY = "tunnel_tls_enabled";
const GLOBAL_TERMINAL_CWD_KEY = "global_terminal_cwd";

export type UseSettingsModelProps = Readonly<{
  t: (key: string, args?: any) => string;
  locale: () => Locale;
  onLocaleChange?: (l: Locale) => void;
}>;

export function useSettingsModel(props: UseSettingsModelProps) {
  const qc = useQueryClient();
  const [shellPath, setShellPath] = createSignal("");
  const [scanMinutes, setScanMinutes] = createSignal("0");
  const [defaultIde, setDefaultIde] = createSignal("");
  const [defaultShell, setDefaultShell] = createSignal("");
  const [selectedLocale, setSelectedLocale] = createSignal<Locale>("en");
  const [autoIndex, setAutoIndex] = createSignal(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = createSignal(true);
  const [autoStart, setAutoStart] = createSignal(false);
  const [portlessEnabled, setPortlessEnabled] = createSignal(false);
  const [portlessProxyPort, setPortlessProxyPort] = createSignal("4200");
  const [portlessTls, setPortlessTls] = createSignal(false);
  const [portlessAvailable, setPortlessAvailable] = createSignal(false);
  const [githubToken, setGithubToken] = createSignal("");
  const [githubUserCode, setGithubUserCode] = createSignal("");
  const [globalTerminalCwd, setGlobalTerminalCwd] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const settingsQ = createQuery(() => ({
    queryKey: ["settings", "view"] as const,
    queryFn: async () => {
      const [sh, scan, gh, di, ds, loc, ai, au, as, pe, pp, pt, gtc] = await Promise.all([
        getSetting(SHELL_KEY),
        getSetting(SCAN_KEY),
        getSetting(GITHUB_TOKEN_SETTING_KEY),
        getSetting(DEFAULT_IDE_KEY),
        getSetting(DEFAULT_SHELL_KEY),
        getSetting(LOCALE_KEY),
        getSetting(AUTO_INDEX_KEY),
        getSetting(AUTO_CHECK_UPDATES_KEY),
        getAutostartEnabled(),
        getSetting(PORTLESS_ENABLED_KEY),
        getSetting(PORTLESS_PROXY_PORT_KEY),
        getSetting(PORTLESS_TLS_KEY),
        getSetting(GLOBAL_TERMINAL_CWD_KEY),
      ]);
      if (sh.isErr()) throw new Error(sh.error.message);
      if (scan.isErr()) throw new Error(scan.error.message);
      if (gh.isErr()) throw new Error(gh.error.message);
      if (di.isErr()) throw new Error(di.error.message);
      if (ds.isErr()) throw new Error(ds.error.message);
      if (loc.isErr()) throw new Error(loc.error.message);
      if (ai.isErr()) throw new Error(ai.error.message);
      if (au.isErr()) throw new Error(au.error.message);

      const tunnelR = await checkTunnelAvailable();
      setPortlessAvailable(tunnelR.isOk() ? tunnelR.value : false);

      return {
        shell: sh.value ?? "",
        scan: scan.value ?? "0",
        githubToken: gh.value ?? "",
        defaultIde: di.value ?? "",
        defaultShell: ds.value ?? "",
        locale: loc.value ?? "en",
        autoIndex: ai.value !== "false",
        autoCheckUpdates: au.value !== "false",
        autoStart: as.isOk() ? as.value : false,
        portlessEnabled: pe.value === "true",
        portlessProxyPort: pp.value || "",
        portlessTls: pt.value === "true",
        globalTerminalCwd: gtc.value ?? "",
      };
    },
  }));

  const idesQ = createQuery(() => ({
    queryKey: queryKeys.discoveredIdes,
    queryFn: async () => {
      const r = await listDiscoveredIdes();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const shellsQ = createQuery(() => ({
    queryKey: queryKeys.availableShells,
    queryFn: async () => {
      const r = await listAvailableShells();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const toolsQ = createQuery(() => ({
    queryKey: ["settings", "discovered-tools"] as const,
    queryFn: async () => {
      const r = await listDiscoveredTools();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const ghViewerQ = createQuery(() => ({
    queryKey: queryKeys.githubViewer(),
    queryFn: async () => {
      if (!isTauri()) return null;
      const r = await fetchGitHubViewer();
      if (r.isErr()) return null;
      return r.value;
    },
  }));

  const ghDeviceReadyQ = createQuery(() => ({
    queryKey: ["settings", "github", "device", "ready"] as const,
    queryFn: async () => {
      if (!isTauri()) return false;
      const envId = import.meta.env.VITE_GITHUB_DEVICE_CLIENT_ID;
      const r = await isGithubDeviceConfigured(envId);
      if (r.isErr()) return false;
      return r.value;
    },
  }));

  createEffect(() => {
    if (settingsQ.isSuccess && settingsQ.data) {
      const d = settingsQ.data;
      setShellPath(d.shell);
      setScanMinutes(d.scan);
      setGithubToken(d.githubToken);
      setDefaultIde(d.defaultIde);
      setDefaultShell(d.defaultShell);
      setSelectedLocale((d.locale as Locale) || props.locale());
      setAutoIndex(d.autoIndex);
      setAutoCheckUpdates(d.autoCheckUpdates);
      setAutoStart(d.autoStart);
      setPortlessEnabled(d.portlessEnabled);
      setPortlessProxyPort(d.portlessProxyPort);
      setPortlessTls(d.portlessTls);
      setGlobalTerminalCwd(d.globalTerminalCwd);
    }
  });

  const onSave = async () => {
    setBusy(true);
    toast.dismiss("settings");
    try {
      const asR = await setAutostartEnabled(autoStart());
      if (asR.isErr()) {
        toast.error(stableErrorMessage(props.t, asR.error), { id: "settings" });
        return;
      }
      for (const [key, val] of [
        [SHELL_KEY, shellPath()],
        [SCAN_KEY, scanMinutes().trim() || "0"],
        [GITHUB_TOKEN_SETTING_KEY, githubToken()],
        [DEFAULT_IDE_KEY, defaultIde()],
        [DEFAULT_SHELL_KEY, defaultShell()],
        [LOCALE_KEY, selectedLocale()],
        [AUTO_INDEX_KEY, autoIndex() ? "true" : "false"],
        [AUTO_CHECK_UPDATES_KEY, autoCheckUpdates() ? "true" : "false"],
        [AUTO_START_KEY, autoStart() ? "true" : "false"],
        [PORTLESS_ENABLED_KEY, portlessEnabled() ? "true" : "false"],
        [PORTLESS_PROXY_PORT_KEY, portlessProxyPort()],
        [PORTLESS_TLS_KEY, portlessTls() ? "true" : "false"],
        [GLOBAL_TERMINAL_CWD_KEY, globalTerminalCwd()],
      ] as const) {
        const r = await setSetting(key, val);
        if (r.isErr()) {
          toast.error(stableErrorMessage(props.t, r.error), { id: "settings" });
          return;
        }
      }
      void settingsQ.refetch();
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "settings",
      });
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
      });

      if (portlessEnabled()) {
        const r = await startTunnelProxy();
        if (r.isErr()) {
          toast.error(stableErrorMessage(props.t, r.error), { id: "settings" });
        }
      } else {
        void stopTunnelProxy();
      }

      toast.success(props.t("settings.saved"), { id: "settings" });
      props.onLocaleChange?.(selectedLocale());
    } finally {
      setBusy(false);
    }
  };

  const onGithubDeviceSignIn = async () => {
    if (!isTauri()) return;
    setBusy(true);
    toast.dismiss("settings");
    setGithubUserCode("");
    try {
      const envId = import.meta.env.VITE_GITHUB_DEVICE_CLIENT_ID;
      const r = await runGithubDeviceSignIn({
        clientId: envId,
        onUserCode: (code) => {
          setGithubUserCode(code);
          toast.loading(`${props.t("settings.githubDeviceWaiting")} ${code}`, { id: "settings" });
        },
      });
      if (r !== "ok") {
        toast.error(stableErrorMessage(props.t, r), { id: "settings" });
        return;
      }
      setGithubUserCode("");
      const tokR = await getSetting(GITHUB_TOKEN_SETTING_KEY);
      if (tokR.isOk() && tokR.value != null) {
        setGithubToken(tokR.value);
      }
      void settingsQ.refetch();
      void ghViewerQ.refetch();
      void qc.invalidateQueries({ queryKey: queryKeys.githubViewer() });
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "github",
      });
      toast.success(props.t("settings.githubDeviceSuccess"), { id: "settings" });
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setBusy(true);
    toast.dismiss("settings");
    try {
      const r = await exportLibrarySnapshot();
      if (r.isErr()) {
        toast.error(stableErrorMessage(props.t, r.error), { id: "settings" });
        return;
      }
      const blob = new Blob([JSON.stringify(r.value, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-vault-export-${r.value.exportedAtMs}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async (safeConfirm: (msg: string) => Promise<boolean>) => {
    if (await safeConfirm(props.t("settings.signOutConfirm"))) {
      setBusy(true);
      setSetting(GITHUB_TOKEN_SETTING_KEY, "").then(() => {
        void settingsQ.refetch();
        void ghViewerQ.refetch();
        setBusy(false);
      });
    }
  };

  const onRebuildDatabase = async (safeConfirm: (msg: string) => Promise<boolean>) => {
    if (!(await safeConfirm(props.t("settings.rebuildDatabaseConfirm")))) return;
    setBusy(true);
    toast.dismiss("settings");
    try {
      await deleteAllIndices();
      const count = await rescanAllLibraryFolders();
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      void qc.invalidateQueries({ queryKey: queryKeys.locations });
      toast.success(props.t("settings.rebuildDatabaseSuccess", { count }), { id: "settings" });
    } catch (e) {
      toast.error(props.t("settings.rebuildDatabaseError", { message: String(e) }), { id: "settings" });
    } finally {
      setBusy(false);
    }
  };

  const onInstallUpdate = async () => {
    if (!isTauri()) return;
    setBusy(true);
    toast.dismiss("settings");
    try {
      const r = await installUpdate();
      if (r.isErr()) {
        toast.error(stableErrorMessage(props.t, r.error), { id: "settings" });
        return;
      }
      toast.success(props.t("settings.updateInstalling"), { id: "settings" });
    } finally {
      setBusy(false);
    }
  };

  const onCheckForUpdates = async () => {
    if (!isTauri()) return;
    setBusy(true);
    toast.dismiss("settings");
    try {
      const r = await checkForUpdates();
      if (r.isErr()) {
        toast.error(stableErrorMessage(props.t, r.error), { id: "settings" });
        return;
      }
      const update = r.value;
      if (update == null) {
        toast.success(props.t("settings.noUpdateAvailable"), { id: "settings" });
        return;
      }
      toast.info(
        props.t("settings.updateAvailable", { version: update.version }),
        {
          id: "settings",
          duration: 30000,
          action: {
            label: props.t("updater.install"),
            onClick: () => void onInstallUpdate(),
          },
        },
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    settingsQ,
    idesQ,
    shellsQ,
    toolsQ,
    ghViewerQ,
    ghDeviceReadyQ,
    shellPath,
    setShellPath,
    scanMinutes,
    setScanMinutes,
    defaultIde,
    setDefaultIde,
    defaultShell,
    setDefaultShell,
    selectedLocale,
    setSelectedLocale,
    autoIndex,
    setAutoIndex,
    autoCheckUpdates,
    setAutoCheckUpdates,
    autoStart,
    setAutoStart,
    portlessEnabled,
    setPortlessEnabled,
    portlessProxyPort,
    setPortlessProxyPort,
    portlessTls,
    setPortlessTls,
    portlessAvailable,
    githubToken,
    setGithubToken,
    githubUserCode,
    globalTerminalCwd,
    setGlobalTerminalCwd,
    busy,
    onSave,
    onGithubDeviceSignIn,
    onExport,
    onSignOut,
    onRebuildDatabase,
    onCheckForUpdates,
    onInstallUpdate,
  };
}
