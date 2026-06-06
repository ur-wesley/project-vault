import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/solid-query";
import { onCleanup, onMount } from "solid-js";
import { invalidateGitProjectQueries, isGitStatusChangeType } from "~/lib/git-status-sync";
import { queryKeys } from "~/services/query-keys";

export function useRealtimeProjects() {
  const qc = useQueryClient();

  onMount(() => {
    const unlisteners: (() => void)[] = [];

    void (async () => {
      unlisteners.push(
        await listen<{ projectId: string; changeType: string }>("project:changed", (ev) => {
          const { projectId, changeType } = ev.payload;

          if (changeType === "tasks") {
            qc.invalidateQueries({ queryKey: queryKeys.sessions(projectId) });
            qc.invalidateQueries({ queryKey: ["projects", projectId, "active-sessions"] });
            return;
          }

          qc.invalidateQueries({ queryKey: queryKeys.projects });
          qc.invalidateQueries({ queryKey: queryKeys.project(projectId) });

          if (changeType === "scan" || changeType === "refreshed") {
            qc.invalidateQueries({ queryKey: queryKeys.projectMiseTools(projectId) });
            qc.invalidateQueries({ queryKey: queryKeys.projectMiseSuggestions(projectId) });
            qc.invalidateQueries({ queryKey: queryKeys.projectLanguages(projectId) });
            qc.invalidateQueries({ queryKey: queryKeys.gitStatus(projectId) });
          }
          if (isGitStatusChangeType(changeType)) {
            invalidateGitProjectQueries(qc, projectId);
          }
        }),
      );

      unlisteners.push(
        await listen<{ projectId: string; changeType: string }>("git:status-changed", (ev) => {
          const { projectId, changeType } = ev.payload;
          if (isGitStatusChangeType(changeType)) {
            invalidateGitProjectQueries(qc, projectId);
          }
        }),
      );
    })();

    onCleanup(() => {
      for (const fn of unlisteners) fn();
    });
  });
}
