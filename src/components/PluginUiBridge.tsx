import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  upsertFooterSegment,
  removeFooterSegment,
  type PluginFooterColor,
} from "~/lib/plugin/plugin-footer";
import { upsertPluginPage, removePluginPage } from "~/lib/plugin/plugin-pages";
import { parsePollIntervalMs, pluginStoreMirror } from "~/features/plugin-ui/store/pluginStore";
import type { PluginStoreChangedEvent } from "~/features/plugin-ui/types";
import {
  upsertHeaderWidget,
  removeHeaderWidget,
  clearAllHeaderWidgets,
} from "~/lib/plugin/plugin-header-widgets";
import { useI18n } from "~/lib/i18n-context";
import { useNotificationCenter } from "~/lib/notification-store";
import { isGitStatusChangeType } from "~/lib/git-status-sync";
import { createInputBoxModel } from "~/features/plugin-ui/model/useInputBox";
import { createQuickPickModel } from "~/features/plugin-ui/model/useQuickPick";
import { createDynamicFormModel } from "~/features/plugin-ui/model/useDynamicForm";
import { createMarkdownDialogModel } from "~/features/plugin-ui/model/useMarkdownDialog";
import { createDeepLinkInstallModel } from "~/features/plugin-ui/model/useDeepLinkInstall";
import { InputBoxDialog } from "~/features/plugin-ui/dialogs/InputBoxDialog";
import { QuickPickDialog } from "~/features/plugin-ui/dialogs/QuickPickDialog";
import { FormDialog } from "~/features/plugin-ui/dialogs/FormDialog";
import { MarkdownDialog } from "~/features/plugin-ui/dialogs/MarkdownDialog";
import { DeepLinkDialog } from "~/features/plugin-ui/dialogs/DeepLinkDialog";

export function PluginUiBridge(props: {
  projectId?: string | null;
  detailTab?: string | null;
  subDetail?: string | null;
  onOpenPluginPage?: (pluginId: string, pageId: string) => void;
}) {
  const { t } = useI18n();
  const center = useNotificationCenter();

  // Dialog domains live in features/plugin-ui/model/*.
  const inputBoxModel = createInputBoxModel();
  const quickPickModel = createQuickPickModel();
  const formModel = createDynamicFormModel();
  const markdownModel = createMarkdownDialogModel();
  const deepLinkModel = createDeepLinkInstallModel({ notify: center.notify });

  // ── Plugin lifecycle ───────────────────────────────────────────────────────
  const [enabledPlugins, setEnabledPlugins] = createSignal<string[]>([]);

  let gitStatusDispatchTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingGitStatusProjectId: string | null = null;

  // ── System stats live tick (sysmon plugin) ─────────────────────────────
  // Lua has no timers, so the host drives the refresh: the sysmon plugin
  // publishes its persisted refresh interval to the store mirror (default
  // 1s, configurable via its "Configure" command) and this effect keeps a
  // matching setInterval while sysmon is enabled. No timer — and zero
  // overhead — when sysmon is off.
  const SYSMON_INTERVAL_KEY = "refresh_interval_ms";
  const SYSMON_DEFAULT_INTERVAL_MS = 1000;
  const [sysmonIntervalMs, setSysmonIntervalMs] = createSignal(SYSMON_DEFAULT_INTERVAL_MS);
  const dispatchSystemStatsChanged = () => {
    if (!enabledPlugins().includes("sysmon")) return;
    void invoke("execute_plugin_command", {
      pluginId: "sysmon",
      commandId: "system_stats_changed",
      context: {},
    }).catch(() => {});
  };

  const dispatchGitStatusChanged = (projectId: string) => {
    pendingGitStatusProjectId = projectId;
    if (gitStatusDispatchTimeoutId !== undefined) {
      clearTimeout(gitStatusDispatchTimeoutId);
    }
    gitStatusDispatchTimeoutId = setTimeout(() => {
      gitStatusDispatchTimeoutId = undefined;
      const pid = pendingGitStatusProjectId;
      pendingGitStatusProjectId = null;
      if (!pid) return;
      for (const pluginId of enabledPlugins()) {
        void invoke("execute_plugin_command", {
          pluginId,
          commandId: "git_status_changed",
          context: { projectId: pid },
        }).catch(() => {});
      }
    }, 150);
  };

  onMount(() => {
    const unlistens: (() => void)[] = [];

    void (async () => {
      // Dialog subscriptions (input/quick-pick/form/markdown/deep-link) live
      // in features/plugin-ui/model/* — each model owns its listeners.
      unlistens.push(
        await listen<{ pluginId: string; css: string }>("plugin:inject-css", (event) => {
          const { pluginId, css } = event.payload;
          const styleId = `plugin-style-${pluginId}`;
          let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = css;
        }),
      );

      unlistens.push(
        await listen<{ pluginId: string; enabled: boolean }>(
          "plugin:status-changed",
          async (event) => {
            const { pluginId, enabled } = event.payload;
            if (enabled) {
              setEnabledPlugins((prev) => {
                if (prev.includes(pluginId)) return prev;
                return [...prev, pluginId];
              });
            } else {
              setEnabledPlugins((prev) => prev.filter((id) => id !== pluginId));
              const styleId = `plugin-style-${pluginId}`;
              document.getElementById(styleId)?.remove();
            }
          },
        ),
      );
      unlistens.push(
        await listen<{
          pluginId: string;
          id: string;
          text: string;
          icon?: string;
          tooltip?: string;
          command?: string;
          color: PluginFooterColor;
          position?: "left" | "right";
        }>("plugin:set-footer", (event) => {
          upsertFooterSegment(event.payload);
        }),
      );

      unlistens.push(
        await listen<{ pluginId: string; id: string }>("plugin:clear-footer", (event) => {
          removeFooterSegment(event.payload.pluginId, event.payload.id);
        }),
      );

      // (Markdown subscription lives in model/useMarkdownDialog.)

      unlistens.push(
        await listen<{
          pluginId: string;
          id: string;
          type: "button" | "badge" | "text";
          text: string;
          icon?: string;
          tooltip?: string;
          command?: string;
          color: PluginFooterColor;
        }>("plugin:set-header-widget", (event) => {
          upsertHeaderWidget(event.payload);
        }),
      );

      unlistens.push(
        await listen<{ pluginId: string; id: string }>("plugin:clear-header-widget", (event) => {
          removeHeaderWidget(event.payload.pluginId, event.payload.id);
        }),
      );

      unlistens.push(
        await listen<{
          pluginId: string;
          id: string;
          title?: string;
          itemCommand?: string;
          items: { id: string; label: string; detail?: string; icon?: string }[];
        }>("plugin:set-page", (event) => {
          const { pluginId, id, title, itemCommand, items } = event.payload;
          upsertPluginPage({ pluginId, id, title, itemCommand, items });
        }),
      );

      unlistens.push(
        await listen<{ pluginId: string; id: string }>("plugin:clear-page", (event) => {
          removePluginPage(event.payload.pluginId, event.payload.id);
        }),
      );

      unlistens.push(
        await listen<{ pluginId: string; pageId: string }>("plugin:open-page", (event) => {
          props.onOpenPluginPage?.(event.payload.pluginId, event.payload.pageId);
        }),
      );

      unlistens.push(
        await listen<{ projectId: string; changeType: string }>("project:changed", (event) => {
          const { projectId, changeType } = event.payload;
          if (isGitStatusChangeType(changeType)) {
            dispatchGitStatusChanged(projectId);
          }
        }),
      );

      unlistens.push(
        await listen<{ projectId: string; changeType: string }>("git:status-changed", (event) => {
          const { projectId, changeType } = event.payload;
          if (isGitStatusChangeType(changeType)) {
            dispatchGitStatusChanged(projectId);
          }
        }),
      );

      // Sysmon publishes its refresh interval to the store mirror; retime the
      // tick live when the user changes it via the plugin's Configure command.
      unlistens.push(
        await listen<PluginStoreChangedEvent>("plugin:store-changed", (event) => {
          if (
            event.payload.pluginId === "sysmon" &&
            event.payload.key === SYSMON_INTERVAL_KEY &&
            !event.payload.removed
          ) {
            setSysmonIntervalMs(parsePollIntervalMs(event.payload.value));
          }
        }),
      );

      // (Deep-link subscription lives in model/useDeepLinkInstall.)

      try {
        const pluginsList = await invoke<{ id: string; enabled: boolean }[]>("list_plugins");
        setEnabledPlugins(pluginsList.filter((p) => p.enabled).map((p) => p.id));
        for (const p of pluginsList) {
          if (p.enabled) {
            try {
              await invoke("execute_plugin_command", {
                pluginId: p.id,
                commandId: "init",
                context: {},
              });
            } catch (initErr) {
              console.debug(`No custom init sequence for plugin: ${p.id}`, initErr);
            }
          }
        }
      } catch (e) {
        console.error("Failed to run startup plugin initializations:", e);
      }

      // Seed the sysmon tick from the persisted interval. The plugin re-emits
      // it on init, which the listener below picks up if it arrives later.
      setSysmonIntervalMs(
        parsePollIntervalMs(
          pluginStoreMirror.get("sysmon", SYSMON_INTERVAL_KEY),
          SYSMON_DEFAULT_INTERVAL_MS,
        ),
      );
    })();

    onCleanup(() => {
      if (gitStatusDispatchTimeoutId !== undefined) {
        clearTimeout(gitStatusDispatchTimeoutId);
      }
      for (const fn of unlistens) fn();
    });
  });

  // Reactive sysmon tick: recreated whenever sysmon is (dis)abled or its
  // interval changes. No debounce needed — ticks are already periodic.
  createEffect(() => {
    const ms = sysmonIntervalMs();
    if (!enabledPlugins().includes("sysmon")) return;
    const id = setInterval(dispatchSystemStatsChanged, ms);
    onCleanup(() => clearInterval(id));
  });

  let lastProjectId: string | null | undefined = undefined;
  let activeProjectIdAtLastTrigger: string | null | undefined = undefined;
  let pluginCommandTimeoutId: any = null;

  // Notify all enabled plugins when the active project or its view state changes
  createEffect(() => {
    const projectId = props.projectId ?? null;
    const detailTab = props.detailTab ?? null;
    const subDetail = props.subDetail ?? null;
    const plugins = enabledPlugins();

    onCleanup(() => {
      if (pluginCommandTimeoutId) {
        clearTimeout(pluginCommandTimeoutId);
      }
    });

    void (async () => {
      // 1. Immediately update backend active project (fast, no Luau VM)
      if (projectId !== lastProjectId) {
        lastProjectId = projectId;
        await invoke("set_active_project", { projectId }).catch(console.error);
        clearAllHeaderWidgets();
      }

      // 2. Debounce the heavy Luau plugin commands to avoid thread-spawning heap corruption
      pluginCommandTimeoutId = setTimeout(() => {
        if (plugins.length > 0) {
          const projectChanged = projectId !== activeProjectIdAtLastTrigger;
          activeProjectIdAtLastTrigger = projectId;

          for (const pluginId of plugins) {
            if (projectChanged) {
              invoke("execute_plugin_command", {
                pluginId,
                commandId: "project_focus",
                context: { projectId },
              }).catch(() => {});
            }

            invoke("execute_plugin_command", {
              pluginId,
              commandId: "project_state_changed",
              context: { projectId, detailTab, subDetail },
            }).catch(() => {});
          }
        }
      }, 150);
    })();
  });

  // (The debounced effect above is the single sender for
  // project_focus/project_state_changed; a former duplicate immediate effect
  // doubled every broadcast and is intentionally gone.)

  // ── Render: dialog components own their JSX ────────────────────────────────
  return (
    <>
      <InputBoxDialog t={t} model={inputBoxModel} />
      <QuickPickDialog t={t} model={quickPickModel} />
      <FormDialog t={t} model={formModel} />
      <MarkdownDialog t={t} model={markdownModel} />
      <DeepLinkDialog t={t} model={deepLinkModel} />
    </>
  );
}
