import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import type { AgentSessionDto, WorkspaceChangeEntry } from "~/types/dto";
import {
  sessionCreate,
  sessionPrompt,
  workspaceFileDiff,
  workspacePush,
} from "~/services/tauri/workspaces";
import { pairSideBySide, parseUnifiedDiff, type DiffRow } from "./diffParse";
import { PrDialog } from "./PrDialog";

export type ReviewComment = {
  id: string;
  file: string;
  line: number;
  side: "added" | "removed" | "context";
  text: string;
};

type Props = Readonly<{
  workspaceId: string;
  changes: WorkspaceChangeEntry[];
  sessions: AgentSessionDto[];
  onChanged: () => void;
}>;

function getRowBg(kind: DiffRow["kind"]): string {
  if (kind === "add") return "bg-green-500/10";
  if (kind === "del") return "bg-red-500/10";
  if (kind === "hunk") return "bg-muted/60 text-muted-foreground";
  return "";
}

const rowBg = (kind: DiffRow["kind"]) => getRowBg(kind);

export const ReviewPanel: Component<Props> = (props) => {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [fileSearch, setFileSearch] = createSignal("");
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"unified" | "side">("unified");
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const [draftTarget, setDraftTarget] = createSignal<{ file: string; row: DiffRow } | null>(null);
  const [comments, setComments] = createSignal<ReviewComment[]>([]);
  const [message, setMessage] = createSignal("");
  const [prOpen, setPrOpen] = createSignal(false);
  const [pushing, setPushing] = createSignal(false);

  createEffect(() => {
    // Default to the first changed file; reset drafts when switching files.
    const files = filteredFiles();
    if (!selectedFile() && files.length > 0) setSelectedFile(files[0]!.path);
    if (selectedFile() && !files.some((f) => f.path === selectedFile())) {
      setSelectedFile(files[0]?.path ?? null);
    }
  });

  const filteredFiles = createMemo(() => {
    const q = fileSearch().trim().toLowerCase();
    const list = props.changes;
    if (!q) return list;
    return list.filter((f) => f.path.toLowerCase().includes(q));
  });

  const diffQ = createQuery(() => ({
    queryKey: ["workspace-diff", props.workspaceId, selectedFile()],
    queryFn: async () => {
      const file = selectedFile();
      if (!file) return null;
      const r = await workspaceFileDiff(props.workspaceId, file);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: selectedFile() !== null,
  }));

  const rows = createMemo(() => parseUnifiedDiff(diffQ.data?.diff ?? ""));
  const pairs = createMemo(() => pairSideBySide(rows()));

  const rowKey = (file: string, row: DiffRow) => `${file}:${row.newNo ?? `o${row.oldNo ?? "?"}`}`;

  const sideOf = (row: DiffRow): ReviewComment["side"] => {
    if (row.kind === "add") return "added";
    if (row.kind === "del") return "removed";
    return "context";
  };

  const targetKey = () => {
    const target = draftTarget();
    return target ? rowKey(target.file, target.row) : null;
  };

  const addComment = () => {
    const target = draftTarget();
    if (!target) return;
    const key = rowKey(target.file, target.row);
    const text = (drafts()[key] ?? "").trim();
    if (!text) return;
    const line = target.row.newNo ?? target.row.oldNo ?? 0;
    setComments((cs) => [
      ...cs,
      { id: crypto.randomUUID(), file: target.file, line, side: sideOf(target.row), text },
    ]);
    setDrafts((d) => ({ ...d, [key]: "" }));
    setDraftTarget(null);
  };

  const toggleDraft = (file: string, row: DiffRow) => {
    const cur = draftTarget();
    if (cur && cur.file === file && cur.row === row) setDraftTarget(null);
    else setDraftTarget({ file, row });
  };

  const removeComment = (id: string) => setComments((cs) => cs.filter((c) => c.id !== id));

  const runningSession = createMemo(
    () => props.sessions.find((s) => s.status === "running") ?? null,
  );

  const formatFeedback = () => {
    const lines = comments().map((c) => `- \`${c.file}\` line ${c.line} (${c.side}): ${c.text}`);
    const extra = message().trim();
    return `Review feedback:\n${lines.join("\n")}${extra ? `\n\n${extra}` : ""}`;
  };

  const sendToAgent = async () => {
    if (comments().length === 0) return;
    const feedback = formatFeedback();
    setMessage("");
    const live = runningSession();
    if (live) {
      const r = await sessionPrompt(live.id, feedback);
      if (r.isErr())
        notify({
          title: t("workspace.promptFailed") as string,
          body: r.error.message,
          severity: "error",
        });
      else {
        setComments([]);
        props.onChanged();
      }
      return;
    }
    // No live agent: start a fresh session carrying the feedback.
    const r = await sessionCreate(props.workspaceId, undefined, feedback);
    if (r.isErr())
      notify({
        title: t("workspace.sessionFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setComments([]);
      props.onChanged();
    }
  };

  const push = async () => {
    setPushing(true);
    const r = await workspacePush(props.workspaceId);
    setPushing(false);
    if (r.isErr())
      notify({
        title: t("workspace.pushFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      notify({ title: t("workspace.pushed") as string, severity: "success" });
      qc.invalidateQueries({ queryKey: ["workspace", props.workspaceId] });
    }
  };

  const totals = createMemo(() => {
    let add = 0;
    let del = 0;
    for (const f of props.changes) {
      add += f.additions;
      del += f.deletions;
    }
    return { add, del };
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <TextField class="w-44">
          <TextFieldInput
            placeholder={t("workspace.filterFiles") as string}
            class="h-8 text-xs"
            value={fileSearch()}
            onInput={(e) => setFileSearch(e.currentTarget.value)}
            autocomplete="off"
          />
        </TextField>
        <div class="flex overflow-hidden rounded-md border">
          <Button
            size="sm"
            variant={viewMode() === "unified" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs"
            onClick={() => setViewMode("unified")}
          >
            {t("workspace.unified") as string}
          </Button>
          <Button
            size="sm"
            variant={viewMode() === "side" ? "default" : "ghost"}
            class="h-8 rounded-none text-xs"
            onClick={() => setViewMode("side")}
          >
            {t("workspace.sideBySide") as string}
          </Button>
        </div>
        <Badge variant="secondary">
          +{totals().add} −{totals().del}
        </Badge>
        <div class="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-8 text-xs"
            disabled={pushing()}
            onClick={() => void push()}
          >
            {t("workspace.push") as string}
          </Button>
          <Button size="sm" variant="outline" class="h-8 text-xs" onClick={() => setPrOpen(true)}>
            {t("workspace.newPr") as string}
          </Button>
          <Button
            size="sm"
            variant="default"
            class="h-8 text-xs"
            disabled={comments().length === 0}
            onClick={() => void sendToAgent()}
          >
            {t("workspace.sendToAgent") as string}
            <Show when={comments().length > 0}>
              <Badge variant="secondary" class="ml-1.5">
                {comments().length}
              </Badge>
            </Show>
          </Button>
        </div>
      </div>

      <Show when={comments().length > 0}>
        <div class="flex flex-col gap-1.5 rounded-md border p-2">
          <For each={comments()}>
            {(c) => (
              <div class="flex items-start gap-2 text-xs">
                <span class="shrink-0 font-mono text-muted-foreground">
                  {c.file}:{c.line} ({c.side})
                </span>
                <span class="min-w-0 flex-1">{c.text}</span>
                <button
                  type="button"
                  class="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => removeComment(c.id)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <TextField>
            <TextFieldInput
              placeholder={t("workspace.feedbackMessage") as string}
              class="h-7 text-xs"
              value={message()}
              onInput={(e) => setMessage(e.currentTarget.value)}
            />
          </TextField>
        </div>
      </Show>

      <div class="flex min-h-0 flex-1 gap-2 overflow-hidden">
        {/* File tree */}
        <ul class="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto rounded-md border p-1.5">
          <For each={filteredFiles()}>
            {(f) => (
              <li>
                <button
                  type="button"
                  class={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-muted/60 ${selectedFile() === f.path ? "bg-muted/60" : ""}`}
                  onClick={() => setSelectedFile(f.path)}
                >
                  <Badge variant="outline" class="shrink-0 px-1">
                    {f.status}
                  </Badge>
                  <span class="min-w-0 flex-1 truncate">{f.path}</span>
                  <span class="shrink-0 text-green-600">+{f.additions}</span>
                  <span class="shrink-0 text-red-500">−{f.deletions}</span>
                </button>
              </li>
            )}
          </For>
          <Show when={filteredFiles().length === 0}>
            <p class="px-1 py-2 text-[11px] text-muted-foreground">
              {t("workspace.noFiles") as string}
            </p>
          </Show>
        </ul>

        {/* Diff viewer */}
        <div class="min-w-0 flex-1 overflow-auto rounded-md border">
          <Show
            when={diffQ.data}
            fallback={
              <p class="p-3 text-xs text-muted-foreground">
                {diffQ.isPending
                  ? (t("kanban.loading") as string)
                  : (t("workspace.noDiff") as string)}
              </p>
            }
          >
            <Show
              when={viewMode() === "unified"}
              fallback={
                <SideView
                  pairs={pairs()}
                  file={selectedFile()!}
                  targetKey={targetKey()}
                  drafts={drafts()}
                  onToggle={toggleDraft}
                  onDraft={setDrafts}
                  onAdd={addComment}
                  t={t}
                />
              }
            >
              <div class="min-w-max py-1 font-mono text-[11px] leading-5">
                <For each={rows()}>
                  {(row) => (
                    <Show
                      when={row.kind !== "meta"}
                      fallback={<div class="px-3 py-0.5 text-muted-foreground">{row.text}</div>}
                    >
                      <div class={`group flex items-start gap-1 px-1 ${rowBg(row.kind)}`}>
                        <span class="w-10 shrink-0 select-none text-right text-muted-foreground">
                          {row.oldNo ?? ""}
                        </span>
                        <span class="w-10 shrink-0 select-none text-right text-muted-foreground">
                          {row.newNo ?? ""}
                        </span>
                        <button
                          type="button"
                          class="hidden w-5 shrink-0 text-primary group-hover:inline"
                          title={t("workspace.addComment") as string}
                          onClick={() => toggleDraft(selectedFile()!, row)}
                        >
                          +
                        </button>
                        <span class="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">
                          {row.text}
                        </span>
                      </div>
                      <Show when={targetKey() === rowKey(selectedFile()!, row)}>
                        <CommentDraft
                          value={drafts()[rowKey(selectedFile()!, row)] ?? ""}
                          onInput={(v) =>
                            setDrafts((d) => ({ ...d, [rowKey(selectedFile()!, row)]: v }))
                          }
                          onAdd={addComment}
                          t={t}
                        />
                      </Show>
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={prOpen()}>
        <PrDialog
          workspaceId={props.workspaceId}
          onClose={() => setPrOpen(false)}
          onChanged={props.onChanged}
        />
      </Show>
    </div>
  );
};

type TFn = ReturnType<typeof useI18n>["t"];

function CommentDraft(
  props: Readonly<{
    value: string;
    onInput: (v: string) => void;
    onAdd: () => void;
    t: TFn;
  }>,
) {
  return (
    <div class="flex gap-1.5 px-3 py-1.5">
      <TextField class="flex-1">
        <TextFieldTextArea
          rows={2}
          class="min-h-0 text-xs"
          placeholder={props.t("workspace.commentPlaceholder") as string}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) props.onAdd();
          }}
        />
      </TextField>
      <Button size="sm" variant="outline" class="h-7 self-end text-xs" onClick={props.onAdd}>
        {props.t("kanban.add") as string}
      </Button>
    </div>
  );
}

function SideView(
  props: Readonly<{
    pairs: ReturnType<typeof pairSideBySide>;
    file: string;
    targetKey: string | null;
    drafts: Record<string, string>;
    onToggle: (file: string, row: DiffRow) => void;
    onDraft: (d: Record<string, string>) => void;
    onAdd: () => void;
    t: TFn;
  }>,
) {
  const keyOf = (row: DiffRow) => `${props.file}:${row.newNo ?? `o${row.oldNo ?? "?"}`}`;
  const cell = (row: DiffRow | null, side: "left" | "right") => {
    if (!row) return <div class="bg-muted/30 px-2 py-0.5"> </div>;
    if (row.kind === "hunk" || row.kind === "meta") {
      return <div class="col-span-2 bg-muted/60 px-2 py-0.5 text-muted-foreground">{row.text}</div>;
    }
    const no = side === "left" ? row.oldNo : row.newNo;
    return (
      <div class={`group flex items-start gap-1 px-1 ${rowBg(row.kind)}`}>
        <span class="w-8 shrink-0 select-none text-right text-muted-foreground">{no ?? ""}</span>
        <button
          type="button"
          class="hidden w-4 shrink-0 text-primary group-hover:inline"
          title={props.t("workspace.addComment") as string}
          onClick={() => props.onToggle(props.file, row)}
        >
          +
        </button>
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-all">{row.text}</span>
      </div>
    );
  };
  const draftFor = (p: { left: DiffRow | null; right: DiffRow | null }) => {
    const target = props.targetKey;
    if (!target) return false;
    return (p.left && keyOf(p.left) === target) || (p.right && keyOf(p.right) === target);
  };
  return (
    <div class="grid min-w-max grid-cols-2 gap-x-2 py-1 font-mono text-[11px] leading-5">
      <For each={props.pairs}>
        {(p) => (
          <>
            {cell(p.left, "left")}
            {p.left?.kind === "hunk" || p.left?.kind === "meta" ? null : cell(p.right, "right")}
            <Show when={draftFor(p) && props.targetKey}>
              {(key) => (
                <div class="col-span-2">
                  <CommentDraft
                    value={props.drafts[key()] ?? ""}
                    onInput={(v) => props.onDraft({ ...props.drafts, [key()]: v })}
                    onAdd={props.onAdd}
                    t={props.t}
                  />
                </div>
              )}
            </Show>
          </>
        )}
      </For>
    </div>
  );
}
