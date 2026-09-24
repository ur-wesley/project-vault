import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { stableErrorMessage } from "~/lib/invoke-error";
import type { useI18n } from "~/lib/i18n-context";
import {
  DOKPLOY_API_VERSION,
  dokployApiVersion,
  dokployDebugScan,
  dokployGitProviders,
  dokployLinkGithub,
  dokployListMatches,
  dokployListServices,
  findAutoLinkTarget,
} from "~/services/tauri/dokploy";
import { getGitStatus } from "~/services/tauri/git";
import { queryKeys } from "~/services/query-keys";
import type { ProjectDto } from "~/types/dto";
import type { DokployIdentity } from "./useDokployIdentity";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Match/link domain: service matches, API-version gate, debug scan,
 * link candidates/providers/branch, zero-touch auto-link.
 * (Extracted verbatim from DokployNode.)
 */
export function useDokployMatches(opts: {
  t: T;
  identity: Accessor<DokployIdentity>;
  projectId: Accessor<string>;
  project: Accessor<ProjectDto>;
}) {
  const { t, identity, projectId, project } = opts;

  const matchesQ = createQuery(() => ({
    queryKey: queryKeys.dokployMatches(projectId()),
    queryFn: async () => {
      const g = identity();
      if (!g) return [];
      const r = await dokployListMatches(g.owner, g.repo, g.remoteUrl);
      if (r.isErr()) throw r.error;
      return [...r.value];
    },
    enabled: identity() != null,
    refetchInterval: 60_000,
    retry: false,
  }));

  // Backend handshake: the canvas talks to newer Tauri commands with every
  // iteration. If the running binary predates them, every query fails with
  // confusing errors — surface one clear rebuild banner instead.
  const versionQ = createQuery(() => ({
    queryKey: ["dokploy", "api-version"] as const,
    queryFn: async () => {
      const r = await dokployApiVersion();
      if (r.isErr()) throw r.error;
      return r.value;
    },
    retry: false,
  }));
  const backendStale = createMemo(
    () => versionQ.isError || (versionQ.isSuccess && versionQ.data !== DOKPLOY_API_VERSION),
  );

  const debugQ = createQuery(() => ({
    queryKey: ["dokploy", "debug", projectId()] as const,
    queryFn: async () => {
      const g = identity();
      if (!g) return null;
      const r = await dokployDebugScan(g.owner, g.repo, g.remoteUrl);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: matchesQ.isSuccess && (matchesQ.data?.length ?? 0) === 0,
    retry: false,
  }));

  // Link data lives at node level so the auto-link effect and the manual
  // picker share the same queries without duplicate fetching.
  const linkable = createMemo(() => {
    const g = identity();
    return (
      g != null &&
      g.owner !== "" &&
      g.repo !== "" &&
      matchesQ.isSuccess &&
      (matchesQ.data?.length ?? 0) === 0
    );
  });
  const candidatesQ = createQuery(() => ({
    queryKey: queryKeys.dokployServices(projectId()),
    queryFn: async () => {
      const r = await dokployListServices(project().name);
      if (r.isErr()) throw r.error;
      return [...r.value];
    },
    enabled: linkable(),
    retry: false,
  }));
  const providersQ = createQuery(() => ({
    queryKey: queryKeys.dokployProviders(),
    queryFn: async () => {
      const r = await dokployGitProviders();
      if (r.isErr()) throw r.error;
      return [...r.value];
    },
    enabled: linkable(),
    retry: false,
  }));
  const branchQ = createQuery(() => ({
    queryKey: queryKeys.gitStatus(projectId()),
    queryFn: async () => {
      const r = await getGitStatus(projectId());
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: linkable(),
    retry: false,
  }));

  // Zero-touch linking: the best unlinked name-match (branch, then
  // production environment, same-server provider) links automatically,
  // once. Anything ambiguous falls through to the manual picker below.
  const qc = useQueryClient();
  const [autoTried, setAutoTried] = createSignal(false);
  createEffect(() => {
    projectId();
    setAutoTried(false);
  });
  createEffect(() => {
    if (autoTried()) return;
    if (!linkable()) return;
    if (!candidatesQ.isSuccess || !providersQ.isSuccess) return;
    const g = identity();
    if (!g) return;
    const branch = branchQ.data?.branch?.trim() || "main";
    const target = findAutoLinkTarget(
      candidatesQ.data ?? [],
      providersQ.data ?? [],
      project().name,
      { branch },
    );
    if (!target) return;
    setAutoTried(true);
    void (async () => {
      const r = await dokployLinkGithub({
        kind: target.candidate.kind,
        id: target.candidate.id,
        githubId: target.provider.id,
        owner: g.owner,
        repository: g.repo,
        branch,
        serverId: target.candidate.serverId,
      });
      if (r.isErr()) {
        toast.error(stableErrorMessage(t, r.error));
        return;
      }
      toast.success(
        t("projectDetail.integrationsDokployAutoLinked", {
          name: target.candidate.name,
        }) as string,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.dokployMatches(projectId()) });
      void qc.invalidateQueries({ queryKey: queryKeys.dokployServices(projectId()) });
    })();
  });

  return {
    matchesQ,
    versionQ,
    backendStale,
    debugQ,
    linkable,
    candidatesQ,
    providersQ,
    branchQ,
  };
}

export type DokployMatchesModel = ReturnType<typeof useDokployMatches>;
