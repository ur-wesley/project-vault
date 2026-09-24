import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { toast } from "solid-sonner";

import { stableErrorMessage } from "~/lib/invoke-error";
import type { useI18n } from "~/lib/i18n-context";
import {
  dokployRedeploy,
  dokployServiceStatus,
  dokployStatusTone,
  findDokployMatchByKey,
  rankDokployMatches,
  type DokployMatch,
} from "~/services/tauri/dokploy";
import { queryKeys } from "~/services/query-keys";
import type { DokployIdentity } from "./useDokployIdentity";
import type { DokployMatchesModel } from "./useDokployMatches";
import { confirmRedeploy } from "./dokployUiHelpers";

type T = ReturnType<typeof useI18n>["t"];

/**
 * Selection/status domain: ranked matches, picked service, live status,
 * redeploy, tags + header badge. (Extracted verbatim from DokployNode.)
 */
export function useDokployStatus(opts: {
  t: T;
  identity: Accessor<DokployIdentity>;
  matches: DokployMatchesModel;
  branch: Accessor<string | null | undefined>;
  projectName: Accessor<string>;
  projectTags: Accessor<string[] | undefined>;
}) {
  const { t, identity, matches, branch, projectName, projectTags } = opts;
  const { matchesQ } = matches;

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const rankedMatches = createMemo((): DokployMatch[] => {
    const list = matchesQ.data ?? [];
    return rankDokployMatches(list, {
      branch: branch(),
      projectName: projectName(),
    });
  });
  const selected = createMemo((): DokployMatch | null => {
    const list = matchesQ.data ?? [];
    if (list.length === 0) return null;
    const key = selectedId();
    if (key) return findDokployMatchByKey(list, key);
    // Automatic selection: best branch match, then production environment,
    // then name/project order. Confident matches only; name-only guesses
    // still need the picker (selected stays null → needsPick).
    const ranked = rankedMatches();
    return (
      ranked.find((m) => m.matchKind === "exact") ??
      ranked.find((m) => m.matchKind === "owner_repo") ??
      null
    );
  });
  const needsPick = createMemo(() => {
    const list = matchesQ.data ?? [];
    return list.length > 0 && selected() == null;
  });

  const statusQ = createQuery(() => ({
    queryKey: queryKeys.dokployStatus(
      selected()?.kind ?? "",
      selected()?.id ?? "",
      selected()?.serverId ?? "",
    ),
    queryFn: async () => {
      const s = selected();
      if (!s) return null;
      const r = await dokployServiceStatus(s.kind, s.id, s.serverId);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: selected() != null,
    refetchInterval: 30_000,
    retry: false,
  }));

  const [redeploying, setRedeploying] = createSignal(false);

  const onRedeploy = async () => {
    const s = selected();
    if (!s || redeploying()) return;
    if (!(await confirmRedeploy(t("projectDetail.integrationsDokployRedeploy") as string))) return;
    setRedeploying(true);
    try {
      const r = await dokployRedeploy(s.kind, s.id, s.serverId);
      if (r.isErr()) {
        toast.error(stableErrorMessage(t, r.error));
        return;
      }
      toast.success(t("projectDetail.integrationsDokployRedeployQueued") as string);
      void statusQ.refetch();
    } finally {
      setRedeploying(false);
    }
  };

  const tags = createMemo(() => projectTags() ?? []);
  const hasMarkers = createMemo(() => {
    const tg = tags();
    return tg.includes("dokploy") || tg.includes("docker") || tg.includes("compose");
  });
  const badge = createMemo(() => {
    const st = statusQ.data?.status ?? selected()?.status ?? null;
    if (identity() == null) return "Dokploy";
    if (matchesQ.isPending) return "Dokploy";
    if (matchesQ.isError) return "Dokploy";
    if (!selected()) return hasMarkers() ? "Unlinked" : "Dokploy";
    return st ?? selected()!.kind;
  });
  const badgeVariant = createMemo(() =>
    dokployStatusTone(statusQ.data?.status ?? selected()?.status),
  );

  return {
    selectedId,
    setSelectedId,
    rankedMatches,
    selected,
    needsPick,
    statusQ,
    redeploying,
    onRedeploy,
    tags,
    hasMarkers,
    badge,
    badgeVariant,
  };
}

export type DokployStatusModel = ReturnType<typeof useDokployStatus>;
