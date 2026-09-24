import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { NotificationCenterApi } from "~/lib/notification-store";
import type { DeepLinkInstallState } from "./dialogTypes";

/**
 * Deep-link install-confirm domain: state, URL parse, install flow.
 * (Extracted verbatim from PluginUiBridge.)
 */
export function createDeepLinkInstallModel(opts: { notify: NotificationCenterApi["notify"] }) {
  const { notify } = opts;
  const [deepLinkInstall, setDeepLinkInstall] = createSignal<DeepLinkInstallState | null>(null);

  const installDeepLinkedPlugin = async () => {
    const info = deepLinkInstall();
    if (!info) return;
    setDeepLinkInstall(null);
    notify({
      severity: "info",
      title: "Installing Plugin",
      body: `Cloning plugin repository in the background...`,
      durationMs: 3000,
    });
    try {
      await invoke("install_plugin_git", {
        repo: info.repo,
        branch: info.branch || null,
        tag: info.tag || null,
        commit: info.commit || null,
      });
      notify({
        severity: "success",
        title: "Installation Successful",
        body: `Successfully installed plugin to plugins folder.`,
        durationMs: 5000,
      });
    } catch (err: any) {
      notify({
        severity: "error",
        title: "Installation Failed",
        body: err.message || String(err),
        durationMs: 8000,
      });
    }
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];
    void (async () => {
      unlistens.push(
        await listen<string>("deep-link:install-plugin", (event) => {
          try {
            const urlStr = event.payload;
            const url = new URL(
              urlStr.replace("project-vault://", "http://").replace("vault://", "http://"),
            );
            if (url.pathname === "/install-plugin" || url.host === "install-plugin") {
              const repo = url.searchParams.get("repo");
              if (repo) {
                setDeepLinkInstall({
                  repo,
                  branch: url.searchParams.get("branch") || undefined,
                  tag: url.searchParams.get("tag") || undefined,
                  commit: url.searchParams.get("commit") || undefined,
                });
              }
            }
          } catch (err) {
            console.error("Failed to parse deep link URL:", err);
          }
        }),
      );
    })();
    onCleanup(() => {
      for (const fn of unlistens) fn();
    });
  });

  return { deepLinkInstall, setDeepLinkInstall, installDeepLinkedPlugin };
}
