import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { normalizeHexColor } from "~/lib/color";
import { configDefaultToString } from "~/lib/plugin/plugin-config-value";
import {
  asPluginConfigList,
  asPluginOptionList,
  pluginHasSettings,
  type PluginConfigItem,
  type PluginInfo,
  type TFunction,
} from "../model/pluginTypes";
import type { createPluginConfigModel } from "../model/usePluginConfig";
import type { createPluginInstallModel } from "../model/usePluginInstall";
import type { createPluginListModel } from "../model/usePluginList";
import type { createPluginUpdatesModel } from "../model/usePluginUpdates";

export type PluginRowLabels = {
  pluginName: (plugin: PluginInfo) => string;
  pluginDescription: (plugin: PluginInfo) => string | undefined;
  configLabel: (plugin: PluginInfo, cfg: PluginConfigItem) => string;
  configDescription: (plugin: PluginInfo, cfg: PluginConfigItem) => string | undefined;
  configOptionLabel: (
    plugin: PluginInfo,
    cfg: PluginConfigItem,
    opt: { id: string; label: string },
  ) => string;
};

/**
 * One installed-plugin row: badges, actions, expanded details, config form.
 * (Extracted verbatim from PluginDashboard's plugins tab.)
 */
export const PluginRow: Component<{
  plugin: PluginInfo;
  t: TFunction;
  busy: Accessor<boolean>;
  list: Pick<ReturnType<typeof createPluginListModel>, "handleToggle" | "handleUninstall">;
  config: Pick<
    ReturnType<typeof createPluginConfigModel>,
    "expandedPlugin" | "configValues" | "handleExpand" | "handleSelectPreset" | "handleSaveConfig"
  >;
  updates: Pick<
    ReturnType<typeof createPluginUpdatesModel>,
    "pendingUpdates" | "handleUpdatePlugin"
  >;
  install: Pick<ReturnType<typeof createPluginInstallModel>, "handleRelinkLocal">;
  labels: PluginRowLabels;
}> = (props) => {
  const { plugin } = props;
  const { t, busy, list, config, updates, install, labels } = props;
  const { pluginName, pluginDescription, configLabel, configDescription, configOptionLabel } =
    labels;

  return (
    <div class="border border-muted/50 bg-muted/5 rounded-lg p-3 transition-all hover:bg-muted/15 flex flex-col gap-2">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-2">
          <button
            onClick={() => config.handleExpand(plugin.id)}
            class="text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded shrink-0"
            aria-label={
              config.expandedPlugin() === plugin.id
                ? t("pluginsDashboard.collapseTooltip")
                : t("pluginsDashboard.expandTooltip")
            }
          >
            <span
              class="iconify mdi--chevron-right size-4 shrink-0 transition-transform duration-200"
              class:rotate-90={config.expandedPlugin() === plugin.id}
              aria-hidden="true"
            />
          </button>
          <span class="text-sm font-bold text-foreground">{pluginName(plugin)}</span>
          <Show when={plugin.version}>
            <span class="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-muted/30">
              v{plugin.version}
            </span>
          </Show>

          {/* Category badge */}
          <Show when={plugin.category}>
            <Badge
              variant="secondary"
              class="text-[9px] py-0 px-1.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono uppercase tracking-wider"
            >
              {plugin.category}
            </Badge>
          </Show>

          {/* Status badges */}
          <Show when={!plugin.enabled}>
            <Badge
              variant="outline"
              class="text-[9px] py-0 px-1 border-muted text-muted-foreground/60"
            >
              {t("pluginsDashboard.disabledBadge")}
            </Badge>
          </Show>
          <Show when={plugin.enabled}>
            <Show when={plugin.active}>
              <Badge class="bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] py-0 px-1">
                {t("pluginsDashboard.activeBadge", {
                  time: plugin.loadTimeMs.toFixed(1),
                })}
              </Badge>
            </Show>
            <Show when={!plugin.active && plugin.lazy}>
              <Badge class="bg-amber-500/10 hover:bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] py-0 px-1">
                {t("pluginsDashboard.lazyBadge")}
              </Badge>
            </Show>
          </Show>

          {/* Local (non-git) badge — installed from a folder for testing */}
          <Show when={!plugin.repo}>
            <span class="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-400 border border-sky-500/20">
              {t("pluginsDashboard.localBadge")}
            </span>
          </Show>

          {/* Update indicator */}
          <Show when={updates.pendingUpdates().includes(plugin.id)}>
            <span class="rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-400 border border-rose-500/20 animate-pulse">
              {t("pluginsDashboard.updatePendingBadge")}
            </span>
          </Show>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <Show when={!plugin.repo}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy()}
              onClick={() => void install.handleRelinkLocal(plugin.id)}
              title={t("pluginsDashboard.localReimportHint")}
              class="h-7 px-2 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span
                class="iconify mdi--folder-refresh-outline size-3 shrink-0"
                aria-hidden="true"
              />
              {t("pluginsDashboard.localReimportBtn")}
            </Button>
          </Show>
          <Show when={updates.pendingUpdates().includes(plugin.id) && plugin.repo}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy()}
              onClick={() => void updates.handleUpdatePlugin(plugin.id)}
              class="h-7 px-2 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span class="iconify mdi--download size-3 shrink-0" aria-hidden="true" />
              {t("pluginsDashboard.updatePluginBtn")}
            </Button>
          </Show>
          <Show when={pluginHasSettings(plugin)}>
            <button
              type="button"
              onClick={() => void config.handleExpand(plugin.id)}
              disabled={busy()}
              class="text-muted-foreground hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded p-0.5"
              title={t("pluginsDashboard.pluginSettingsBtn")}
              aria-label={t("pluginsDashboard.pluginSettingsBtn")}
            >
              <span class="iconify mdi--cog-outline size-4 shrink-0" aria-hidden="true" />
            </button>
          </Show>
          <Checkbox
            id={`toggle-dashboard-${plugin.id}`}
            checked={plugin.enabled}
            disabled={busy()}
            onChange={() => void list.handleToggle(plugin)}
            class="cursor-pointer"
            aria-label={t("pluginsDashboard.togglePluginLabel", {
              name: pluginName(plugin),
            })}
          />
          <button
            onClick={() => void list.handleUninstall(plugin.id)}
            disabled={busy()}
            class="text-muted-foreground hover:text-rose-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            title={t("pluginsDashboard.uninstallTooltip")}
            aria-label={t("pluginsDashboard.uninstallTooltip")}
          >
            <span class="iconify mdi--trash-can-outline size-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p class="text-xs text-muted-foreground pl-6 leading-relaxed">
        {pluginDescription(plugin) || t("pluginsDashboard.noDescription")}
      </p>

      {/* Expanded Details */}
      <Show when={config.expandedPlugin() === plugin.id}>
        <div class="mt-2 pl-6 pt-2 border-t border-muted/20 text-[11px] font-mono grid grid-cols-1 md:grid-cols-2 gap-3 animate-in slide-in-from-top-1 duration-200">
          <div class="space-y-1">
            <div class="flex justify-between py-0.5 border-b border-border/40">
              <span class="text-muted-foreground">{t("pluginsDashboard.pluginIdLabel")}</span>
              <span class="text-foreground font-bold">{plugin.id}</span>
            </div>
            <Show when={plugin.repo}>
              <div class="flex justify-between py-0.5 border-b border-border/40">
                <span class="text-muted-foreground">{t("pluginsDashboard.sourceRepoLabel")}</span>
                <span class="text-foreground truncate max-w-[200px]" title={plugin.repo}>
                  {plugin.repo}
                </span>
              </div>
            </Show>
            <Show when={plugin.dir}>
              <div class="flex justify-between py-0.5 border-b border-border/40">
                <span class="text-muted-foreground">{t("pluginsDashboard.localPathLabel")}</span>
                <span class="text-foreground truncate max-w-[200px]" title={plugin.dir}>
                  {plugin.dir}
                </span>
              </div>
            </Show>
            <Show when={plugin.localPath}>
              <div class="flex justify-between py-0.5 border-b border-border/40">
                <span class="text-muted-foreground">{t("pluginsDashboard.linkedFolderLabel")}</span>
                <span class="text-foreground truncate max-w-[200px]" title={plugin.localPath}>
                  {plugin.localPath}
                </span>
              </div>
            </Show>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between py-0.5 border-b border-border/40">
              <span class="text-muted-foreground">{t("pluginsDashboard.lazyLoadingLabel")}</span>
              <span class="text-foreground font-bold">
                {plugin.lazy ? t("pluginsDashboard.lazyTrue") : t("pluginsDashboard.lazyFalse")}
              </span>
            </div>
            <Show when={plugin.dependencies.length > 0}>
              <div class="flex justify-between py-0.5 border-b border-border/40">
                <span class="text-muted-foreground">{t("pluginsDashboard.dependenciesLabel")}</span>
                <span class="text-foreground font-bold">{plugin.dependencies.join(", ")}</span>
              </div>
            </Show>
            <Show when={plugin.externals.length > 0}>
              <div class="flex justify-between py-0.5 border-b border-border/40">
                <span class="text-muted-foreground">{t("pluginsDashboard.externalsLabel")}</span>
                <span class="text-foreground font-bold">{plugin.externals.join(", ")}</span>
              </div>
            </Show>
            <div class="flex justify-between py-0.5 border-b border-border/40">
              <span class="text-muted-foreground">{t("pluginsDashboard.commandsLabel")}</span>
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
                {t("pluginsDashboard.configPresetTitle")}
              </span>
              <div class="flex flex-wrap gap-2">
                <For each={asPluginOptionList(plugin.options)}>
                  {(opt) => {
                    const isActive = () =>
                      plugin.activeOption === opt.id ||
                      (!plugin.activeOption && opt.id === "mocha");
                    return (
                      <button
                        type="button"
                        onClick={() => void config.handleSelectPreset(plugin.id, opt.id)}
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
                {t("pluginsDashboard.configCustomTitle")}
              </span>
              <div class="space-y-2">
                <For each={asPluginConfigList(plugin.config)}>
                  {(cfg) => {
                    const currentVal = () =>
                      (config.configValues()[plugin.id] || {})[cfg.key] ??
                      configDefaultToString(cfg.default);
                    const fieldId = `cfg-${plugin.id}-${cfg.key}`;
                    return (
                      <div class="flex flex-col gap-1">
                        <label class="font-bold text-[11px] text-foreground/80" for={fieldId}>
                          {configLabel(plugin, cfg)}
                        </label>
                        <Show when={configDescription(plugin, cfg)}>
                          <span class="text-[10px] text-muted-foreground leading-normal">
                            {configDescription(plugin, cfg)}
                          </span>
                        </Show>

                        <Show when={cfg.type === "select"}>
                          <select
                            id={fieldId}
                            class="bg-background rounded border border-muted/40 px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            value={currentVal()}
                            onChange={(e) =>
                              config.handleSaveConfig(plugin.id, cfg.key, e.currentTarget.value)
                            }
                          >
                            <For each={cfg.options}>
                              {(opt) => (
                                <option value={opt.id}>
                                  {configOptionLabel(plugin, cfg, opt)}
                                </option>
                              )}
                            </For>
                          </select>
                        </Show>

                        <Show when={cfg.type === "boolean"}>
                          <div class="flex items-center gap-2 mt-0.5">
                            <Checkbox
                              id={fieldId}
                              checked={currentVal() === "true"}
                              onChange={(checked) =>
                                config.handleSaveConfig(
                                  plugin.id,
                                  cfg.key,
                                  checked ? "true" : "false",
                                )
                              }
                              class="cursor-pointer"
                              aria-label={configLabel(plugin, cfg)}
                            />
                          </div>
                        </Show>

                        <Show when={cfg.type === "color"}>
                          <div class="flex gap-2 items-center">
                            <input
                              id={fieldId}
                              type="color"
                              value={normalizeHexColor(
                                currentVal(),
                                normalizeHexColor(String(cfg.default ?? ""), "#000000"),
                              )}
                              onInput={(e) =>
                                config.handleSaveConfig(plugin.id, cfg.key, e.currentTarget.value)
                              }
                              class="size-8 shrink-0 cursor-pointer rounded border border-muted/40 bg-background p-0.5"
                              aria-label={configLabel(plugin, cfg)}
                            />
                            <TextField
                              value={currentVal()}
                              onChange={(val) => config.handleSaveConfig(plugin.id, cfg.key, val)}
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

                        <Show
                          when={
                            cfg.type !== "select" && cfg.type !== "boolean" && cfg.type !== "color"
                          }
                        >
                          <TextField
                            value={currentVal()}
                            onChange={(val) => config.handleSaveConfig(plugin.id, cfg.key, val)}
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
  );
};
