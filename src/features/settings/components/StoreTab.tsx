import { For, Show, type Component } from "solid-js";
import type { Accessor } from "solid-js";

import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import type { TFunction } from "../model/pluginTypes";
import type { createPluginInstallModel } from "../model/usePluginInstall";

/**
 * Store tab: discovered repos, local-folder installer, custom git installer,
 * official monorepo. (Extracted verbatim from PluginDashboard.)
 */
export const StoreTab: Component<{
  t: TFunction;
  busy: Accessor<boolean>;
  install: ReturnType<typeof createPluginInstallModel>;
}> = (props) => {
  const { t, busy, install } = props;

  return (
    <>
      {/* Discovered section */}
      <Show when={install.discoveredRepos().length > 0}>
        <div class="flex flex-col gap-2 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div class="flex items-center justify-between">
            <h5 class="text-xs font-bold text-amber-400 uppercase tracking-wider">
              {t("pluginsDashboard.discoveredSectionTitle")}
            </h5>
            <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 uppercase font-mono tracking-wider">
              {install.discoveredRepos().reduce((acc, r) => acc + r.entries.length, 0)}
            </span>
          </div>
          <p class="text-[10px] text-muted-foreground/80 leading-normal">
            {t("pluginsDashboard.discoveredSectionSubtitle")}
          </p>
          <div class="space-y-3 mt-1">
            <For each={install.discoveredRepos()}>
              {(repo) => (
                <div class="border border-muted/40 bg-background/60 rounded-md p-3 space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-foreground truncate">{repo.slug}</div>
                      <div
                        class="text-[10px] font-mono text-muted-foreground/70 truncate"
                        title={repo.repo}
                      >
                        {repo.repo}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy()}
                      onClick={() =>
                        void install.handleInstallDiscovered(
                          repo,
                          repo.entries.map((e) => e.id),
                        )
                      }
                      class="h-7 px-3 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span class="iconify mdi--download size-3.5 shrink-0" aria-hidden="true" />
                      {t("pluginsDashboard.discoveredInstallAllBtn")}
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
                            onClick={() => void install.handleInstallDiscovered(repo, [entry.id])}
                            class="h-6 px-2 text-[10px] font-bold"
                          >
                            {t("pluginsDashboard.discoveredInstallBtn")}
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

      {/* Local folder installer — test created/updated plugins as real plugins */}
      <div class="flex flex-col gap-2 p-4 rounded-lg border border-sky-500/30 bg-sky-500/5">
        <h5 class="text-xs font-bold text-foreground">{t("pluginsDashboard.localInstallTitle")}</h5>
        <p class="text-[10px] text-muted-foreground/80 leading-normal">
          {t("pluginsDashboard.localInstallHint")}
        </p>
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy()}
            onClick={() => void install.handleInstallLocal()}
            class="h-8 px-3 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span class="iconify mdi--folder-open-outline size-3.5 shrink-0" aria-hidden="true" />
            {t("pluginsDashboard.localInstallBtn")}
          </Button>
        </div>
      </div>

      {/* Custom Git installer input */}
      <div class="flex flex-col gap-2 p-4 rounded-lg border border-muted/50 bg-muted/5">
        <h5 class="text-xs font-bold text-foreground">
          {t("pluginsDashboard.customInstallTitle")}
        </h5>
        <div class="flex gap-2 items-center">
          <TextField
            value={install.customRepoUrl()}
            onChange={install.setCustomRepoUrl}
            class="flex-1"
            id="custom-git-install"
          >
            <TextFieldInput
              type="text"
              class="h-8 text-xs bg-background border-muted/40 placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:outline-none"
              placeholder="e.g. https://github.com/username/project-vault-plugin"
              onKeyDown={(e) =>
                e.key === "Enter" && install.handleInstallGit(install.customRepoUrl())
              }
            />
          </TextField>
          <Button
            size="sm"
            disabled={busy() || !install.customRepoUrl().trim()}
            onClick={() => void install.handleInstallGit(install.customRepoUrl())}
            class="shrink-0 text-xs px-4 h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("pluginsDashboard.installBtn")}
          </Button>
        </div>
        <p class="text-[10px] text-muted-foreground/60 leading-normal">
          {t("pluginsDashboard.customInstallHint")}
        </p>
      </div>

      {/* Official plugin monorepo */}
      <div class="space-y-3">
        <h5 class="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {t("pluginsDashboard.officialTitle")}
        </h5>
        <div class="border border-primary/30 bg-primary/5 rounded-lg p-4 flex flex-col gap-3">
          <div>
            <span class="text-sm font-bold text-foreground">
              {t("pluginsDashboard.officialName")}
            </span>
            <p class="text-[11px] text-muted-foreground/80 mt-1 leading-normal">
              {t("pluginsDashboard.officialDesc")}
            </p>
            <p
              class="text-[10px] font-mono text-muted-foreground/60 mt-2 truncate"
              title={install.officialRepo()}
            >
              {install.officialRepo()}
            </p>
          </div>
          <div class="flex items-center justify-between border-t border-muted/10 pt-3">
            <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase font-mono tracking-widest">
              {t("pluginsDashboard.officialBadge")}
            </span>
            <Button
              size="sm"
              variant={install.officialPluginsInstalled() ? "outline" : "default"}
              disabled={busy() || install.officialPluginsInstalled()}
              onClick={() => void install.handleInstallGit(install.officialRepo())}
              class="h-7 px-3 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {install.officialPluginsInstalled()
                ? t("pluginsDashboard.installedBtn")
                : t("pluginsDashboard.officialInstallBtn")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
