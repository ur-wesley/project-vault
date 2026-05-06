import { createQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { useQueryClient } from "@tanstack/solid-query";

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { listDiscoveredIdes, openProjectInIde, stopProjectIde, isProjectIdeRunning } from "~/services/tauri/ide";
import { getSetting } from "~/services/tauri/settings";
import { queryKeys } from "~/services/query-keys";
import { projectIdeStorageKey } from "../lib/ide-storage";
import type { IdeSelectOption } from "../types";

export function useProjectIde(props: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selectedIdeExecutable, setSelectedIdeExecutable] = createSignal<string | null>(null);
  const lastIdeInitProjectId = { current: "" as string };

  const ideRunningQ = createQuery(() => ({
    queryKey: ["projects", props.projectId, "ide-running"] as const,
    queryFn: async () => {
      const r = await isProjectIdeRunning(props.projectId);
      return r.isErr() ? false : r.value;
    },
    refetchInterval: 5000,
  }));

  const idesQ = createQuery(() => ({
    queryKey: queryKeys.discoveredIdes,
    queryFn: async () => {
      const r = await listDiscoveredIdes();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 1000 * 60 * 5,
  }));

  const defaultIdeQ = createQuery(() => ({
    queryKey: ["settings", "default_ide_path"] as const,
    queryFn: async () => {
      const r = await getSetting("default_ide_path");
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const ideSelectOptions = createMemo((): readonly IdeSelectOption[] => {
    const ides = idesQ.data;
    if (ides == null) return [];
    return ides.map((i) => ({
      value: i.executable,
      label: i.label,
      textValue: `${i.label} ${i.executable}`,
      executable: i.executable,
      icon: i.icon,
    }));
  });

  const selectedIdeOption = createMemo((): IdeSelectOption | null => {
    const ex = selectedIdeExecutable();
    if (ex == null) return null;
    return ideSelectOptions().find((o) => o.executable === ex) ?? null;
  });

  createEffect(() => {
    const pid = props.projectId;
    const ides = idesQ.data;
    const globalDefault = defaultIdeQ.data;
    if (ides == null || ides.length === 0) {
      if (lastIdeInitProjectId.current !== pid) {
        lastIdeInitProjectId.current = pid;
        setSelectedIdeExecutable(null);
      }
      return;
    }
    if (lastIdeInitProjectId.current !== pid) {
      lastIdeInitProjectId.current = pid;
      const stored = localStorage.getItem(projectIdeStorageKey(pid));
      const m = stored
        ? ides.find((i) => i.executable === stored)
        : globalDefault
          ? ides.find((i) => i.executable === globalDefault)
          : null;
      setSelectedIdeExecutable((m ?? ides[0]!).executable);
      return;
    }
    setSelectedIdeExecutable((cur) => {
      const fallback =
        globalDefault && ides.find((i) => i.executable === globalDefault)
          ? globalDefault
          : ides[0]!.executable;
      if (cur == null) return fallback;
      return ides.some((i) => i.executable === cur) ? cur : fallback;
    });
  });

  const onIdeSelected = (projectId: string, executable: string) => {
    setSelectedIdeExecutable(executable);
    localStorage.setItem(projectIdeStorageKey(projectId), executable);
  };

  const onOpenIde = async (projectId: string, executable: string) => {
    const r = await openProjectInIde({ projectId, executable });
    if (r.isErr()) toast.error(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

  const onStopIde = async (projectId: string) => {
    const r = await stopProjectIde(projectId);
    if (r.isErr()) toast.error(stableErrorMessage(t, r.error));
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
  };

  return {
    ideRunningQ,
    idesQ,
    defaultIdeQ,
    ideSelectOptions,
    selectedIdeOption,
    selectedIdeExecutable,
    setSelectedIdeExecutable,
    onIdeSelected,
    onOpenIde,
    onStopIde,
  };
}
