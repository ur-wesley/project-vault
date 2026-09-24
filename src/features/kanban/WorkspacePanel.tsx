import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import {
  executorsList,
  sessionCreate,
  sessionGet,
  sessionPrompt,
  sessionStop,
  workspaceArchive,
  workspaceCreate,
  workspaceDelete,
  workspaceGet,
  workspaceList,
} from "~/services/tauri/workspaces";
import { ReviewPanel } from "./ReviewPanel";
import { KanbanSelect } from "./KanbanSelect";

type Props = Readonly<{
  projectId: string;
  attachToTask: (sessionId: string, label: string) => void;
}>;

const STATUS_STYLE: Record<string, string> = {
  running: "bg-green-500/15 text-green-600 border-green-500/30",
  done: "bg-muted text-muted-foreground",
  error: "bg-red-500/15 text-red-600 border-red-500/30",
  idle: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  stopped: "bg-muted text-muted-foreground",
  active: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

export const WorkspacePanel: Component<Props> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [newName, setNewName] = createSignal("");
  const [newExecutor, setNewExecutor] = createSignal("");
  const [sessionPromptDraft, setSessionPromptDraft] = createSignal("");
  const [followUps, setFollowUps] = createSignal<Record<string, string>>({});
  const [outputFor, setOutputFor] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const executorsQ = createQuery(() => ({
    queryKey: ["executors"],
    queryFn: async () => {
      const r = await executorsList();
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    staleTime: 60_000,
  }));

  const workspacesQ = createQuery(() => ({
    queryKey: ["workspaces", props.projectId],
    queryFn: async () => {
      const r = await workspaceList({ project: props.projectId });
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
  }));

  createEffect(() => {
    const list = workspacesQ.data;
    if (list && list.length > 0 && !selectedId()) setSelectedId(list[0]!.id);
    if (list && list.length === 0) setSelectedId(null);
  });

  const detailQ = createQuery(() => ({
    queryKey: ["workspace", selectedId()],
    queryFn: async () => {
      const id = selectedId();
      if (!id) return null;
      const r = await workspaceGet(id);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: selectedId() !== null,
    refetchInterval: 5000,
  }));

  const outputQ = createQuery(() => ({
    queryKey: ["session-output", outputFor()],
    queryFn: async () => {
      const id = outputFor();
      if (!id) return null;
      const r = await sessionGet(id);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: outputFor() !== null,
  }));

  const invalidate = (detailOnly = false) => {
    if (!detailOnly) qc.invalidateQueries({ queryKey: ["workspaces", props.projectId] });
    qc.invalidateQueries({ queryKey: ["workspace", selectedId()] });
  };

  const fail = (title: string) => (msg: { message: string }) =>
    notify({ title, body: msg.message, severity: "error" });

  const createWorkspace = async () => {
    const name = newName().trim();
    if (!name) return;
    const executor = newExecutor() || executorsQ.data?.find((e) => e.available)?.id;
    const r = await workspaceCreate({ project: props.projectId, name, executor });
    if (r.isErr()) fail(t("workspace.createFailed") as string)(r.error);
    else {
      setNewName("");
      setSelectedId(r.value.workspace.id);
      invalidate();
    }
  };

  const startSession = async () => {
    const id = selectedId();
    if (!id) return;
    const r = await sessionCreate(
      id,
      newExecutor() || undefined,
      sessionPromptDraft().trim() || undefined,
    );
    if (r.isErr()) fail(t("workspace.sessionFailed") as string)(r.error);
    else {
      setSessionPromptDraft("");
      invalidate(true);
    }
  };

  const sendFollowUp = async (sessionId: string) => {
    const text = (followUps()[sessionId] ?? "").trim();
    if (!text) return;
    const r = await sessionPrompt(sessionId, text);
    if (r.isErr()) fail(t("workspace.promptFailed") as string)(r.error);
    else {
      setFollowUps((p) => ({ ...p, [sessionId]: "" }));
      invalidate(true);
    }
  };

  const stopSession = async (sessionId: string) => {
    const r = await sessionStop(sessionId);
    if (r.isErr()) fail(t("workspace.stopFailed") as string)(r.error);
    else invalidate(true);
  };

  const deleteWorkspace = async () => {
    const id = selectedId();
    if (!id) return;
    if (!confirmDelete()) {
      setConfirmDelete(true);
      return;
    }
    const r = await workspaceDelete(id, false);
    if (r.isErr()) fail(t("workspace.deleteFailed") as string)(r.error);
    else {
      setConfirmDelete(false);
      setSelectedId(null);
      invalidate();
    }
  };

  const archiveWorkspace = async (archived: boolean) => {
    const id = selectedId();
    if (!id) return;
    const r = await workspaceArchive(id, archived);
    if (r.isErr()) fail(t("workspace.updateFailed") as string)(r.error);
    else invalidate();
  };

  createEffect(() => {
    selectedId();
    setConfirmDelete(false);
    setOutputFor(null);
  });

  const sessions = () => detailQ.data?.sessions ?? [];

  return (
    <div class="flex h-full min-h-0 gap-3">
      {/* Workspace list */}
      <div class="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border p-2">
        <For each={workspacesQ.data ?? []}>
          {(ws) => (
            <button
              type="button"
              class={`rounded-md border p-2.5 text-left hover:border-primary/40 ${ws.id === selectedId() ? "border-primary/60 bg-muted/40" : ""}`}
              onClick={() => setSelectedId(ws.id)}
            >
              <p class="truncate text-sm font-medium">{ws.name}</p>
              <p class="truncate font-mono text-[11px] text-muted-foreground">{ws.branch}</p>
              <div class="mt-1.5 flex items-center gap-1">
                <Badge variant="outline" class={STATUS_STYLE[ws.status] ?? ""}>
                  {ws.status}
                </Badge>
                <Show when={ws.cardId}>
                  <Badge variant="secondary" title={ws.cardId ?? ""}>
                    <span class="iconify mdi--card-text-outline size-3" />
                  </Badge>
                </Show>
              </div>
            </button>
          )}
        </For>
        <Show when={(workspacesQ.data ?? []).length === 0 && !workspacesQ.isPending}>
          <p class="px-1 py-2 text-xs text-muted-foreground">{t("workspace.empty") as string}</p>
        </Show>
        <div class="mt-auto flex flex-col gap-1.5 border-t pt-2">
          <TextField>
            <TextFieldInput
              placeholder={t("workspace.newName") as string}
              class="h-8 text-xs"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createWorkspace();
              }}
            />
          </TextField>
          <KanbanSelect
            ariaLabel="executor"
            placeholder={t("workspace.autoExecutor") as string}
            value={newExecutor()}
            options={[
              { value: "", label: t("workspace.autoExecutor") as string },
              ...(executorsQ.data ?? []).map((ex) => ({
                value: ex.id,
                label: `${ex.display}${ex.available ? "" : ` ${t("workspace.executorMissing") as string}`}`,
                disabled: !ex.available,
              })),
            ]}
            onChange={setNewExecutor}
          />
          <Button size="sm" variant="outline" onClick={() => void createWorkspace()}>
            {t("workspace.create") as string}
          </Button>
        </div>
      </div>

      {/* Detail */}
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <Show
          when={detailQ.data}
          fallback={
            <p class="text-xs text-muted-foreground">{t("workspace.selectHint") as string}</p>
          }
        >
          {(detail) => (
            <>
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-bold">{detail().workspace.name}</h3>
                <Badge variant="outline" class={STATUS_STYLE[detail().workspace.status] ?? ""}>
                  {detail().workspace.status}
                </Badge>
                <span class="font-mono text-[11px] text-muted-foreground">
                  {detail().workspace.branch}
                </span>
                <div class="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs"
                    onClick={() => void archiveWorkspace(!detail().workspace.archived)}
                  >
                    {detail().workspace.archived
                      ? (t("workspace.unarchive") as string)
                      : (t("workspace.archive") as string)}
                  </Button>
                  <Button
                    size="sm"
                    variant={confirmDelete() ? "destructive" : "ghost"}
                    class="h-7 text-xs"
                    onClick={() => void deleteWorkspace()}
                  >
                    {confirmDelete()
                      ? (t("kanban.confirmDelete") as string)
                      : (t("workspace.delete") as string)}
                  </Button>
                </div>
              </div>

              {/* Sessions */}
              <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("workspace.sessions") as string}
              </h4>
              <div class="flex flex-col gap-2">
                <For each={sessions()}>
                  {(s) => (
                    <div class="rounded-md border p-2.5">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{s.executor}</Badge>
                        <Badge variant="outline" class={STATUS_STYLE[s.status] ?? ""}>
                          {s.status}
                        </Badge>
                        <div class="ml-auto flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            class="h-6 px-2 text-[11px]"
                            onClick={() =>
                              props.attachToTask(
                                s.ptySessionId,
                                `${detail().workspace.name} · ${s.executor}`,
                              )
                            }
                          >
                            {t("workspace.attach") as string}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            class="h-6 px-2 text-[11px]"
                            onClick={() => setOutputFor(outputFor() === s.id ? null : s.id)}
                          >
                            {t("workspace.output") as string}
                          </Button>
                          <Show when={s.status === "running"}>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="h-6 px-2 text-[11px]"
                              onClick={() => void stopSession(s.id)}
                            >
                              {t("workspace.stop") as string}
                            </Button>
                          </Show>
                        </div>
                      </div>
                      <Show when={s.lastPrompt}>
                        <p class="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {s.lastPrompt}
                        </p>
                      </Show>
                      <Show when={s.status === "running"}>
                        <div class="mt-1.5 flex gap-1.5">
                          <TextField class="flex-1">
                            <TextFieldInput
                              placeholder={t("workspace.followUp") as string}
                              class="h-7 text-xs"
                              value={followUps()[s.id] ?? ""}
                              onInput={(e) =>
                                setFollowUps((p) => ({ ...p, [s.id]: e.currentTarget.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void sendFollowUp(s.id);
                              }}
                            />
                          </TextField>
                          <Button
                            size="sm"
                            variant="outline"
                            class="h-7 text-xs"
                            onClick={() => void sendFollowUp(s.id)}
                          >
                            {t("kanban.add") as string}
                          </Button>
                        </div>
                      </Show>
                      <Show when={outputFor() === s.id}>
                        <pre class="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">
                          {outputQ.data?.outputTail ?? (t("workspace.loadingOutput") as string)}
                        </pre>
                      </Show>
                    </div>
                  )}
                </For>
                <div class="flex gap-1.5">
                  <TextField class="flex-1">
                    <TextFieldInput
                      placeholder={t("workspace.newPrompt") as string}
                      class="h-8 text-xs"
                      value={sessionPromptDraft()}
                      onInput={(e) => setSessionPromptDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void startSession();
                      }}
                    />
                  </TextField>
                  <Button size="sm" variant="outline" onClick={() => void startSession()}>
                    {t("workspace.startSession") as string}
                  </Button>
                </div>
              </div>

              {/* Review: changes, diffs, inline feedback, PR */}
              <h4 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("workspace.review") as string} ({detail().changes.length})
              </h4>
              <Show
                when={detail().changes.length > 0}
                fallback={
                  <p class="text-xs text-muted-foreground">{t("workspace.noChanges") as string}</p>
                }
              >
                <ReviewPanel
                  workspaceId={detail().workspace.id}
                  changes={detail().changes}
                  sessions={detail().sessions}
                  onChanged={() => invalidate(true)}
                />
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
};
