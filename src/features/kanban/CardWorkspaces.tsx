import { For, Show, createSignal, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import { KanbanSelect } from "./KanbanSelect";
import {
  executorsList,
  workspaceCreate,
  workspaceLinkCard,
  workspaceList,
} from "~/services/tauri/workspaces";

type Props = Readonly<{
  projectId: string;
  boardId: string;
  cardId: string;
  cardTitle: string;
  onChanged: () => void;
}>;

const sectionTitle = "text-xs font-bold uppercase tracking-wider text-muted-foreground";

export const CardWorkspaces: Component<Props> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [executor, setExecutor] = createSignal("");

  const linkedQ = createQuery(() => ({
    queryKey: ["card-workspaces", props.projectId, props.boardId, props.cardId],
    queryFn: async () => {
      const r = await workspaceList({
        project: props.projectId,
        boardId: props.boardId,
        cardId: props.cardId,
      });
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.cardId !== "",
  }));

  const executorsQ = createQuery(() => ({
    queryKey: ["executors"],
    queryFn: async () => {
      const r = await executorsList();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 60_000,
  }));

  const refresh = () => {
    qc.invalidateQueries({
      queryKey: ["card-workspaces", props.projectId, props.boardId, props.cardId],
    });
    props.onChanged();
  };

  const create = async () => {
    const auto = executorsQ.data?.find((e) => e.available)?.id;
    const r = await workspaceCreate({
      project: props.projectId,
      name: props.cardTitle,
      boardId: props.boardId,
      cardId: props.cardId,
      executor: executor() || auto,
    });
    if (r.isErr())
      notify({
        title: t("workspace.createFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else refresh();
  };

  const unlink = async (workspaceId: string) => {
    const r = await workspaceLinkCard(workspaceId, null, null);
    if (r.isErr())
      notify({
        title: t("workspace.updateFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else refresh();
  };

  return (
    <div class="flex flex-col gap-1.5">
      <h4 class={sectionTitle}>{t("kanban.workspaces") as string}</h4>
      <Show when={(linkedQ.data ?? []).length > 0}>
        <ul class="flex flex-col gap-1">
          <For each={linkedQ.data ?? []}>
            {(ws) => (
              <li class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                <span class="min-w-0 flex-1 truncate">{ws.name}</span>
                <span class="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {ws.branch}
                </span>
                <Badge variant="outline" class="shrink-0">
                  {ws.status}
                </Badge>
                <button
                  type="button"
                  class="shrink-0 text-muted-foreground hover:text-foreground"
                  title={t("kanban.remove") as string}
                  onClick={() => void unlink(ws.id)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="flex gap-1.5">
        <KanbanSelect
          ariaLabel="executor"
          placeholder={t("workspace.autoExecutor") as string}
          value={executor()}
          options={[
            { value: "", label: t("workspace.autoExecutor") as string },
            ...(executorsQ.data ?? []).map((ex) => ({
              value: ex.id,
              label: `${ex.display}${ex.available ? "" : ` ${t("workspace.executorMissing") as string}`}`,
              disabled: !ex.available,
            })),
          ]}
          onChange={setExecutor}
          class="min-w-0 flex-1"
        />
        <Button size="sm" variant="outline" onClick={() => void create()}>
          {t("workspace.createAndRun") as string}
        </Button>
      </div>
      <p class="text-[11px] text-muted-foreground">{t("kanban.workspacesHint") as string}</p>
    </div>
  );
};
