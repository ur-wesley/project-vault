import { useQueryClient } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import { stopProjectTask } from "~/services/tauri/tasks";
import { embeddedTerminalKill } from "~/services/tauri/terminal";
import { stableErrorMessage } from "~/lib/invoke-error";
import { queryKeys } from "~/services/query-keys";
import type { Accessor } from "solid-js";
import type { EmbeddedTerminalInstance } from "../EmbeddedTerminal";
import { getProjectTerminalStore } from "./global-terminal-store";

export type UseProjectTerminalProps = Readonly<{
  projectId: Accessor<string>;
  t: (key: string, args?: any) => string;
  showBanner: (msg: string) => void;
  onDetailTabChange: (tab: "readme" | "issues" | "files" | "tasks" | "terminal" | "history") => void;
}>;

export function useProjectTerminal(props: UseProjectTerminalProps) {
  const qc = useQueryClient();

  // createMemo ensures reactivity: when projectId changes, the memo re-runs
  // and returns the new store's signal. Consumers (<For>) will track the new signal.
  const store = createMemo(() => getProjectTerminalStore(props.projectId()));
  const terminalInstances = createMemo(() => store().instances());
  const activeTerminalId = createMemo(() => store().activeId());

  const openTerminal = (instance: Pick<EmbeddedTerminalInstance, "name" | "shell" | "icon">) => {
    const id = crypto.randomUUID();
    const nextInstance: EmbeddedTerminalInstance = {
      id,
      name: instance.name,
      shell: instance.shell,
      icon: instance.icon,
    };
    store().setInstances((current) => [nextInstance, ...current.filter((item) => item.id !== id)]);
    store().setActiveId(id);
  };

  const updateTerminalSessionId = (id: string, sessionId: string) => {
    store().setInstances((current) => {
      const item = current.find((i) => i.id === id);
      if (item) {
        item.sessionId = sessionId;
      }
      return [...current];
    });
  };

  const selectTerminal = (id: string) => {
    if (terminalInstances().some((item) => item.id === id)) {
      store().setActiveId(id);
    }
  };

  const closeTerminal = async (id: string) => {
    const instance = terminalInstances().find((item) => item.id === id);
    if (!instance) return;

    if (instance.attachSessionId) {
      const sessionId = instance.attachSessionId;
      const r = await stopProjectTask(sessionId);
      if (r.isErr()) {
        props.showBanner(stableErrorMessage(props.t, r.error));
        return;
      }
    } else if (instance.sessionId) {
      const r = await embeddedTerminalKill(instance.sessionId);
      if (r.isErr()) {
        const msg = String(r.error.message ?? r.error);
        if (!msg.toLowerCase().includes("not found")) {
          props.showBanner(stableErrorMessage(props.t, r.error));
          return;
        }
      }
    }

    const nextInstances = terminalInstances().filter((item) => item.id !== id);
    store().setInstances(nextInstances);
    if (activeTerminalId() === id) {
      store().setActiveId(nextInstances.length > 0 ? nextInstances[0]!.id : null);
    }

    void qc.invalidateQueries({ queryKey: ["projects", props.projectId(), "active-sessions"] });
    void qc.invalidateQueries({ queryKey: queryKeys.sessions(props.projectId()) });
    void qc.invalidateQueries({ queryKey: queryKeys.project(props.projectId()) });
  };

  const closeFinishedTerminals = (activeSessionIds: Set<string>) => {
    const toRemove = terminalInstances().filter(
      (inst) => inst.attachSessionId && !activeSessionIds.has(inst.attachSessionId),
    );
    if (toRemove.length === 0) return;
    const nextInstances = terminalInstances().filter(
      (inst) => !toRemove.some((r) => r.id === inst.id),
    );
    store().setInstances(nextInstances);
    if (nextInstances.length > 0 && !nextInstances.some((i) => i.id === activeTerminalId())) {
      store().setActiveId(nextInstances[0]!.id);
    }
  };

  const attachToTask = (sessionId: string, label: string, focus = true) => {
    const existing = terminalInstances().find(
      (item) => item.attachSessionId === sessionId || item.sessionId === sessionId,
    );
    if (existing) {
      store().setInstances((current) => [existing, ...current.filter((item) => item.id !== existing.id)]);
      store().setActiveId(existing.id);
      if (focus) props.onDetailTabChange("terminal");
      return;
    }

    const id = crypto.randomUUID();
    const newInstance: EmbeddedTerminalInstance = {
      id,
      name: label,
      icon: "mdi--application-variable-outline",
      attachSessionId: sessionId,
    };
    store().setInstances((current) => [newInstance, ...current.filter((item) => item.id !== id)]);
    store().setActiveId(id);
    if (focus) props.onDetailTabChange("terminal");
  };

  return {
    terminalInstances,
    activeTerminalId,
    openTerminal,
    closeTerminal,
    closeFinishedTerminals,
    selectTerminal,
    updateTerminalSessionId,
    attachToTask,
  };
}
