import { For, Show, type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { openExternal } from "~/lib/open-external";
import { dokployMatchKey } from "~/services/tauri/dokploy";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";

import { useDokployIdentity } from "./dokploy/useDokployIdentity";
import { useDokployMatches } from "./dokploy/useDokployMatches";
import { useDokployStatus } from "./dokploy/useDokployStatus";
import { LinkRepoSection } from "./dokploy/LinkRepoSection";
import { deploymentStatusIcon, relativeTime } from "./dokploy/dokployUiHelpers";

export const DokployNode: Component<CanvasNodeComponentProps> = (props) => {
  const { t, localeCode } = useI18n();
  const project = () => props.project();
  const identity = useDokployIdentity(project);
  const matches = useDokployMatches({
    t,
    identity: identity.identity,
    projectId: identity.projectId,
    project,
  });
  const status = useDokployStatus({
    t,
    identity: identity.identity,
    matches,
    branch: () => matches.branchQ.data?.branch,
    projectName: () => project().name,
    projectTags: () => project().tags,
  });
  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--cloud-upload-outline"
      badge={status.badge()}
      badgeVariant={status.badgeVariant()}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable={false}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex flex-col gap-2">
        <Show when={matches.backendStale()}>
          <div class="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <p class="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
              <span class="iconify mdi--alert-outline size-3.5 shrink-0" />
              {t("projectDetail.integrationsDokployBackendStale") as string}
            </p>
            <p class="text-[10px] leading-relaxed text-muted-foreground">
              {t("projectDetail.integrationsDokployBackendStaleHint") as string}
            </p>
          </div>
        </Show>
        <Show
          when={identity.identity() != null}
          fallback={
            <p class="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {t("projectDetail.integrationsActionsLinkHint") as string}
            </p>
          }
        >
          <Show
            when={
              matches.matchesQ.isPending ||
              identity.gitRefQ.isPending ||
              identity.remoteUrlQ.isPending
            }
          >
            <div class="flex items-center justify-center py-4">
              <span class="iconify mdi--loading animate-spin size-5 text-muted-foreground/40" />
            </div>
          </Show>
          <Show when={matches.matchesQ.isError}>
            <p class="rounded bg-destructive/10 p-2 text-[11px] text-destructive">
              {stableErrorMessage(t, matches.matchesQ.error as never)}
            </p>
          </Show>
          <Show when={matches.matchesQ.isSuccess && (matches.matchesQ.data?.length ?? 0) === 0}>
            <p class="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {t("projectDetail.integrationsDokployNoMatch") as string}
            </p>
            <Show
              when={identity.identity()?.owner && identity.identity()?.repo}
              fallback={
                <p class="rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">
                  {t("projectDetail.integrationsActionsLinkHint") as string}
                </p>
              }
            >
              <LinkRepoSection
                projectId={identity.projectId}
                owner={() => identity.identity()!.owner}
                repo={() => identity.identity()!.repo}
                defaultBranch={() => matches.branchQ.data?.branch ?? ""}
                candidates={() => matches.candidatesQ.data ?? []}
                candidatesError={() => matches.candidatesQ.error}
                providers={() => matches.providersQ.data ?? []}
                onLinked={() => {
                  status.setSelectedId(null);
                  void matches.matchesQ.refetch();
                  void matches.debugQ.refetch();
                }}
              />
            </Show>
            <Show when={matches.debugQ.data}>
              {(dbg) => (
                <div class="flex flex-col gap-1 rounded bg-muted/40 p-2 text-[10px]">
                  <p class="font-mono text-muted-foreground">
                    {t("projectDetail.integrationsDokployDebugLookingFor") as string}{" "}
                    {[dbg().localHost, dbg().localOwner, dbg().localRepo]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                    {" · "}
                    {t("projectDetail.integrationsDokployDebugSeen") as string} {dbg().serviceCount}{" "}
                    / {dbg().projectCount}
                  </p>
                  <For each={dbg().services.slice(0, 8)}>
                    {(s) => (
                      <p class="truncate font-mono text-muted-foreground">
                        {s.projectName}
                        <Show when={s.environment}> / {s.environment}</Show> · {s.kind}: {s.name} ·{" "}
                        {s.sourceType ?? "?"} · {[s.owner, s.repository].filter(Boolean).join("/")}{" "}
                        · {s.branch ?? "?"}
                      </p>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </Show>

          <Show when={(matches.debugQ.data?.unreachableServers?.length ?? 0) > 0}>
            <p class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-400">
              {
                t("settings.dokployPartialUnreachable", {
                  names: (matches.debugQ.data?.unreachableServers ?? []).join(", "),
                }) as string
              }
            </p>
          </Show>

          <Show when={status.needsPick() || (matches.matchesQ.data?.length ?? 0) > 1}>
            <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("projectDetail.integrationsDokployPickService") as string}
              <select
                class="rounded border border-border/60 bg-muted/40 px-1.5 py-1 text-[11px] font-medium normal-case tracking-normal text-foreground"
                value={status.selected() ? dokployMatchKey(status.selected()!) : ""}
                onChange={(e) => status.setSelectedId(e.currentTarget.value || null)}
              >
                <Show when={status.selected() == null}>
                  <option value="">
                    {t("projectDetail.integrationsDokployPickPlaceholder") as string}
                  </option>
                </Show>
                <For each={status.rankedMatches()}>
                  {(m) => (
                    <option value={dokployMatchKey(m)}>
                      {m.serverName ? `${m.serverName} · ` : ""}
                      {m.projectName} / {m.name} ({m.kind}
                      {m.environment ? `, ${m.environment}` : ""}
                      {m.branch ? `, ${m.branch}` : ""})
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>

          <Show when={status.selected()}>
            {(sel) => (
              <>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  onClick={() => {
                    const url = status.statusQ.data?.dashboardUrl;
                    if (url) void openExternal(url);
                  }}
                  title={status.statusQ.data?.dashboardUrl ?? ""}
                >
                  <span class="iconify mdi--cloud-upload-outline size-3.5 shrink-0 text-indigo-400" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[11px] font-medium text-foreground">
                      {status.statusQ.data?.name ?? sel().name}
                    </span>
                    <span class="block truncate font-mono text-[10px] text-muted-foreground">
                      <Show when={sel().serverName}>{sel().serverName} · </Show>
                      {sel().projectName} · {sel().kind}
                      <Show when={sel().environment}> · {sel().environment}</Show>
                      <Show when={sel().branch}> · {sel().branch}</Show>
                    </span>
                  </span>
                </button>

                <Show when={(status.statusQ.data?.domains?.length ?? 0) > 0}>
                  <div class="flex flex-col gap-1">
                    <p class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("projectDetail.integrationsDokployDomains") as string} (
                      {status.statusQ.data!.domains.length})
                    </p>
                    <div class="flex max-h-28 flex-col gap-1 overflow-y-auto">
                      <For each={status.statusQ.data!.domains}>
                        {(domain) => (
                          <div class="flex min-w-0 items-center gap-1 rounded bg-muted/40 px-1.5 py-1 transition-colors hover:bg-muted">
                            <button
                              type="button"
                              class="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-primary"
                              onClick={() => void openExternal(domain)}
                              title={domain}
                            >
                              {domain}
                            </button>
                            <button
                              type="button"
                              class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                const btn = e.currentTarget;
                                void navigator.clipboard.writeText(domain).then(() => {
                                  const icon = btn.querySelector(".iconify");
                                  if (!icon) return;
                                  const old = icon.className;
                                  icon.className = "iconify mdi--check size-3 text-green-500";
                                  setTimeout(() => {
                                    icon.className = old;
                                  }, 1500);
                                });
                              }}
                              title={domain}
                            >
                              <span class="iconify mdi--content-copy size-3" />
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={status.statusQ.isPending}>
                  <div class="flex items-center justify-center py-2">
                    <span class="iconify mdi--loading animate-spin size-4 text-muted-foreground/40" />
                  </div>
                </Show>
                <Show when={status.statusQ.isError}>
                  <p class="rounded bg-destructive/10 p-2 text-[11px] text-destructive">
                    {stableErrorMessage(t, status.statusQ.error as never)}
                  </p>
                </Show>

                <Show when={(status.statusQ.data?.deployments?.length ?? 0) > 0}>
                  <div class="flex flex-col gap-1">
                    <p class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("projectDetail.integrationsDokployDeployments") as string}
                    </p>
                    <For each={status.statusQ.data!.deployments.slice(0, 5)}>
                      {(d) => (
                        <div class="flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1 text-[11px]">
                          <span
                            class={`iconify size-3.5 shrink-0 ${deploymentStatusIcon(d.status)}`}
                          />
                          <span class="min-w-0 flex-1 truncate text-foreground">
                            {d.title ?? d.id}
                          </span>
                          <Show when={d.createdAt}>
                            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {relativeTime(d.createdAt, localeCode())}
                            </span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show
                  when={
                    status.statusQ.isSuccess &&
                    (status.statusQ.data?.deployments?.length ?? 0) === 0
                  }
                >
                  <p class="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                    {t("projectDetail.integrationsDokployNoDeployments") as string}
                  </p>
                </Show>

                <div class="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void status.onRedeploy()}
                    disabled={status.redeploying()}
                    class="flex flex-1 items-center justify-center gap-1.5 rounded border border-border/60 bg-secondary/50 py-1 text-[11px] font-medium transition-all hover:bg-secondary active:scale-95 disabled:opacity-50"
                  >
                    <Show
                      when={status.redeploying()}
                      fallback={<span class="iconify mdi--rocket-launch-outline size-3.5" />}
                    >
                      <span class="iconify mdi--loading animate-spin size-3.5" />
                    </Show>
                    {status.redeploying()
                      ? (t("projectDetail.integrationsDokployRedeploying") as string)
                      : (t("projectDetail.integrationsDokployRedeploy") as string)}
                  </button>
                  <Show when={status.statusQ.data?.dashboardUrl}>
                    <button
                      type="button"
                      onClick={() => void openExternal(status.statusQ.data!.dashboardUrl)}
                      class="flex items-center justify-center rounded border border-border/60 bg-secondary/50 px-2 py-1 transition-all hover:bg-secondary active:scale-95"
                      title={t("projectDetail.integrationsDokployOpenDashboard") as string}
                    >
                      <span class="iconify mdi--open-in-new size-3.5" />
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </Show>

        <Show when={!isTauri()}>
          <p class="rounded bg-muted/40 p-2 text-[10px] text-muted-foreground">
            Dokploy actions need the desktop app.
          </p>
        </Show>
      </div>
    </CanvasNodeContainer>
  );
};
