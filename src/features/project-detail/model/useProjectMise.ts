import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";

import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { getProjectMiseTools, suggestMiseTools, pinMiseTools } from "~/services/tauri/mise";
import { queryKeys } from "~/services/query-keys";
import type { MiseToolSuggestionDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { dismissedMiseSuggestionsKey } from "../lib/mise-suggestions-storage";

export function useProjectMise(props: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const miseToolsQ = createQuery(() => ({
    queryKey: queryKeys.projectMiseTools(props.projectId),
    queryFn: async () => {
      const r = await getProjectMiseTools(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  const miseSuggestionsQ = createQuery(() => ({
    queryKey: queryKeys.projectMiseSuggestions(props.projectId),
    queryFn: async () => {
      const r = await suggestMiseTools(props.projectId);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    refetchInterval: 30_000,
  }));

  const pinMiseToolsMu = createMutation(() => ({
    mutationFn: async (tools: MiseToolSuggestionDto[]) => {
      const r = await pinMiseTools(props.projectId, tools);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projectMiseSuggestions(props.projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.projectMiseTools(props.projectId) });
    },
    onError: (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        toast.error(stableErrorMessage(t, err as StableError));
      }
    },
  }));

  const [miseSuggestionsDismissed, setMiseSuggestionsDismissed] = createSignal(
    localStorage.getItem(dismissedMiseSuggestionsKey(props.projectId)) === "1",
  );

  const dismissMiseSuggestions = () => {
    localStorage.setItem(dismissedMiseSuggestionsKey(props.projectId), "1");
    setMiseSuggestionsDismissed(true);
  };

  return {
    miseToolsQ,
    miseSuggestionsQ,
    pinMiseToolsMu,
    miseSuggestionsDismissed,
    dismissMiseSuggestions,
  };
}
