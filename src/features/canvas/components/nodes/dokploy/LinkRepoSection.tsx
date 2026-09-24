import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import {
  dokployLinkGithub,
  type DokployGitProvider,
  type DokployServiceCandidate,
} from "~/services/tauri/dokploy";
import { queryKeys } from "~/services/query-keys";
import { confirmRedeploy } from "./dokployUiHelpers";

/**
 * Link-this-repo flow: when no Dokploy service matches the local remote,
 * offer Dokploy services (ranked by project name) and wire the chosen one
 * up via saveGithubProvider. Existing trigger/build config is preserved.
 * Data comes from the node-level queries so the auto-link effect can share
 * them without duplicate fetching.
 * (Extracted verbatim from DokployNode.)
 */
export const LinkRepoSection: Component<{
  projectId: () => string;
  owner: () => string;
  repo: () => string;
  defaultBranch: () => string;
  candidates: () => readonly DokployServiceCandidate[];
  candidatesError: () => unknown;
  providers: () => readonly DokployGitProvider[];
  onLinked: () => void;
}> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();

  const [candidateId, setCandidateId] = createSignal<string | null>(null);
  const [providerId, setProviderId] = createSignal<string | null>(null);
  const [branch, setBranch] = createSignal("");
  const [branchTouched, setBranchTouched] = createSignal(false);
  const [linking, setLinking] = createSignal(false);

  createEffect(() => {
    if (!branchTouched() && props.defaultBranch()) {
      setBranch(props.defaultBranch());
    }
  });

  const candidate = createMemo((): DokployServiceCandidate | null => {
    const list = props.candidates();
    if (list.length === 0) return null;
    const id = candidateId();
    return list.find((c) => c.id === id) ?? list[0]!;
  });
  const provider = createMemo(() => {
    const list = props.providers();
    if (list.length === 0) return null;
    const id = providerId();
    // Prefer the provider on the selected candidate's server so the pair
    // stays on one Dokploy instance without manual work.
    const selected = candidate();
    const direct = id ? list.find((p) => p.id === id) : undefined;
    if (direct) return direct;
    if (selected) {
      const sameServer = list.find((p) => p.serverId === selected.serverId);
      if (sameServer) return sameServer;
    }
    return list[0]!;
  });
  const effectiveBranch = createMemo(
    () => (branchTouched() ? branch() : props.defaultBranch()).trim() || "main",
  );

  const onLink = async () => {
    const c = candidate();
    const p = provider();
    if (!c || !p || linking()) return;
    if (
      !(await confirmRedeploy(
        `${t("projectDetail.integrationsDokployLinkButton") as string}: ${props.owner()}/${props.repo()} → ${c.projectName} / ${c.name}?`,
      ))
    ) {
      return;
    }
    setLinking(true);
    try {
      const r = await dokployLinkGithub({
        kind: c.kind,
        id: c.id,
        githubId: p.id,
        owner: props.owner(),
        repository: props.repo(),
        branch: effectiveBranch(),
        serverId: c.serverId,
      });
      if (r.isErr()) {
        toast.error(stableErrorMessage(t, r.error));
        return;
      }
      toast.success(t("projectDetail.integrationsDokployLinkOk") as string);
      void qc.invalidateQueries({ queryKey: queryKeys.dokployMatches(props.projectId()) });
      void qc.invalidateQueries({ queryKey: queryKeys.dokployServices(props.projectId()) });
      void qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "dokploy",
      });
      props.onLinked();
    } finally {
      setLinking(false);
    }
  };

  return (
    <div class="flex flex-col gap-1.5 rounded border border-indigo-500/30 bg-indigo-500/5 p-2">
      <p class="text-[11px] font-semibold text-foreground">
        {t("projectDetail.integrationsDokployLinkTitle") as string}
      </p>
      <p class="font-mono text-[10px] text-muted-foreground">
        {props.owner()}/{props.repo()}@{effectiveBranch()}
      </p>
      <Show when={props.candidatesError()}>
        <p class="rounded bg-destructive/10 p-1.5 text-[11px] text-destructive">
          {stableErrorMessage(t, props.candidatesError() as never)}
        </p>
      </Show>
      <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("projectDetail.integrationsDokployLinkCandidate") as string}
        <select
          class="rounded border border-border/60 bg-muted/40 px-1.5 py-1 text-[11px] font-medium normal-case tracking-normal text-foreground"
          value={candidate()?.id ?? ""}
          onChange={(e) => setCandidateId(e.currentTarget.value || null)}
        >
          <For each={props.candidates()}>
            {(c) => (
              <option value={c.id}>
                {c.serverName ? `${c.serverName} · ` : ""}
                {c.projectName} / {c.name} ({c.kind}
                {c.environment ? `, ${c.environment}` : ""}
                {c.branch ? `, ${c.branch}` : ""}
                {c.linked ? ", linked" : ""})
              </option>
            )}
          </For>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("projectDetail.integrationsDokployLinkProvider") as string}
        <Show
          when={props.providers().length > 0}
          fallback={
            <p class="rounded bg-muted/40 p-1.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground">
              {t("projectDetail.integrationsDokployNoProviders") as string}
            </p>
          }
        >
          <select
            class="rounded border border-border/60 bg-muted/40 px-1.5 py-1 text-[11px] font-medium normal-case tracking-normal text-foreground"
            value={provider()?.id ?? ""}
            onChange={(e) => setProviderId(e.currentTarget.value || null)}
          >
            <For each={props.providers()}>
              {(p) => (
                <option value={p.id}>
                  {p.serverName ? `${p.serverName} · ` : ""}
                  {p.name || p.id}
                  {p.providerType ? ` (${p.providerType})` : ""}
                  {p.configured ? "" : " — incomplete"}
                </option>
              )}
            </For>
          </select>
        </Show>
      </label>
      <label class="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("projectDetail.integrationsDokployLinkBranch") as string}
        <input
          type="text"
          class="rounded border border-border/60 bg-muted/40 px-1.5 py-1 font-mono text-[11px] font-medium normal-case tracking-normal text-foreground"
          value={branchTouched() ? branch() : props.defaultBranch()}
          onInput={(e) => {
            setBranchTouched(true);
            setBranch(e.currentTarget.value);
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => void onLink()}
        disabled={linking() || !candidate() || !provider()}
        class="flex items-center justify-center gap-1.5 rounded border border-indigo-500/40 bg-indigo-500/15 py-1 text-[11px] font-medium text-indigo-300 transition-all hover:bg-indigo-500/25 active:scale-95 disabled:opacity-50"
      >
        <Show when={linking()} fallback={<span class="iconify mdi--link-variant size-3.5" />}>
          <span class="iconify mdi--loading animate-spin size-3.5" />
        </Show>
        {linking()
          ? (t("projectDetail.integrationsDokployLinking") as string)
          : (t("projectDetail.integrationsDokployLinkButton") as string)}
      </button>
    </div>
  );
};
