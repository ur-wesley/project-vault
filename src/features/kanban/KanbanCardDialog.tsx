import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { notify } from "~/lib/notification-store";
import { listRepoIssues } from "~/services/github";
import { listIssues } from "~/services/tauri/issues";
import {
  kanbanCreateCard,
  kanbanDeleteCard,
  kanbanSetTagColor,
  kanbanUpdateCard,
} from "~/services/tauri/kanban";
import { CardWorkspaces } from "./CardWorkspaces";
import { KanbanSelect } from "./KanbanSelect";
import { KANBAN_PRIORITY_STYLE } from "./KanbanCardView";
import {
  KANBAN_ALL_STATUSES,
  KANBAN_PRIORITIES,
  type KanbanBoardView,
  type KanbanRelation,
} from "./types";

type Props = Readonly<{
  projectId: string;
  boardId: string;
  board: KanbanBoardView;
  cardId: string | null;
  github: { owner: string; repo: string } | null;
  onClose: () => void;
  onChanged: () => void;
  onSelectCard: (id: string) => void;
}>;

type IssueOption = {
  ref: string;
  number: number;
  title: string;
  state: string;
  isLocal: boolean;
};

const sectionTitle = "text-xs font-bold uppercase tracking-wider text-muted-foreground";

export const KanbanCardDialog: Component<Props> = (props) => {
  const { t } = useI18n();
  const [issueSearch, setIssueSearch] = createSignal("");
  const [issueOptions, setIssueOptions] = createSignal<IssueOption[]>([]);
  const [issuesLoading, setIssuesLoading] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal("");
  const [bodyDraft, setBodyDraft] = createSignal("");
  const [tagDraft, setTagDraft] = createSignal("");
  const [assigneeDraft, setAssigneeDraft] = createSignal("");
  const [subDraft, setSubDraft] = createSignal("");
  const [relKind, setRelKind] = createSignal("related");
  const [relTarget, setRelTarget] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const card = createMemo(() => {
    const id = props.cardId;
    if (!id) return null;
    return props.board.cards.find((c) => c.id === id) ?? null;
  });

  // Sync drafts when switching cards.
  createEffect(() => {
    const c = card();
    setTitleDraft(c?.title ?? "");
    setBodyDraft(c?.body ?? "");
    setAssigneeDraft(c?.assignees.join(", ") ?? "");
    setConfirmDelete(false);
  });

  // Lazy-load linkable issues when the dialog opens.
  createEffect(() => {
    const id = props.cardId;
    if (!id) return;
    setIssuesLoading(true);
    void (async () => {
      const g = props.github;
      const [localRes, githubRes] = await Promise.all([
        listIssues(props.projectId),
        g ? listRepoIssues(g.owner, g.repo) : Promise.resolve(null),
      ]);
      const out: IssueOption[] = [];
      if (localRes.isOk()) {
        for (const i of localRes.value) {
          out.push({
            ref: `local:${i.number}`,
            number: i.number,
            title: i.title,
            state: i.state,
            isLocal: true,
          });
        }
      }
      if (githubRes && githubRes.isOk()) {
        for (const i of githubRes.value) {
          out.push({
            ref: `github:${i.number}`,
            number: i.number,
            title: i.title,
            state: i.state,
            isLocal: false,
          });
        }
      }
      setIssueOptions(out);
      setIssuesLoading(false);
    })();
  });

  const patch = async (p: Record<string, unknown>) => {
    const c = card();
    if (!c) return;
    const r = await kanbanUpdateCard({
      project: props.projectId,
      boardId: props.boardId,
      cardId: c.id,
      ...p,
    });
    if (r.isErr())
      notify({
        title: t("kanban.updateFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else props.onChanged();
  };

  const linkedRefs = () => card()?.links.issues ?? [];

  const pickerOptions = () => {
    const linked = new Set(linkedRefs());
    const q = issueSearch().trim().toLowerCase();
    return issueOptions().filter((o) => {
      if (linked.has(o.ref)) return false;
      if (!q) return true;
      return o.title.toLowerCase().includes(q) || String(o.number).includes(q);
    });
  };

  const setIssueLinks = async (issues: string[]) => {
    const c = card();
    if (!c) return;
    const r = await kanbanUpdateCard({
      project: props.projectId,
      boardId: props.boardId,
      cardId: c.id,
      links: { tasks: c.links.tasks, files: c.links.files, issues },
    });
    if (r.isErr())
      notify({ title: t("kanban.linkFailed") as string, body: r.error.message, severity: "error" });
    else props.onChanged();
  };

  // Descendant ids (cycle guard for the parent picker).
  const descendants = createMemo(() => {
    const c = card();
    if (!c) return new Set<string>();
    const byParent = new Map<string, string[]>();
    for (const k of props.board.cards) {
      if (k.parent) {
        const arr = byParent.get(k.parent) ?? [];
        arr.push(k.id);
        byParent.set(k.parent, arr);
      }
    }
    const out = new Set<string>();
    const stack = [...(byParent.get(c.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(byParent.get(id) ?? []));
    }
    return out;
  });

  const children = createMemo(() => {
    const c = card();
    if (!c) return [];
    return props.board.cards.filter((k) => k.parent === c.id);
  });

  const parentOptions = createMemo(() => {
    const c = card();
    const blocked = descendants();
    return props.board.cards.filter((k) => k.id !== c?.id && !blocked.has(k.id));
  });

  const addTag = () => {
    const c = card();
    const name = tagDraft().trim();
    if (!c || !name || c.tags.includes(name)) return;
    setTagDraft("");
    void patch({ tags: [...c.tags, name] });
  };

  const saveAssignees = () => {
    const list = assigneeDraft()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    void patch({ assignees: list });
  };

  const createSubIssue = async () => {
    const c = card();
    const title = subDraft().trim();
    if (!c || !title) return;
    const r = await kanbanCreateCard({
      project: props.projectId,
      boardId: props.boardId,
      title,
      status: c.status,
      parent: c.id,
    });
    if (r.isErr())
      notify({
        title: t("kanban.createFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      setSubDraft("");
      props.onChanged();
    }
  };

  const addRelation = () => {
    const c = card();
    const to = relTarget();
    if (!c || !to || to === c.id) return;
    const rels: KanbanRelation[] = [...c.relations, { to, kind: relKind() }];
    setRelTarget("");
    void patch({ relations: rels });
  };

  const removeRelation = (to: string, kind: string) => {
    const c = card();
    if (!c) return;
    void patch({ relations: c.relations.filter((r) => !(r.to === to && r.kind === kind)) });
  };

  const deleteCard = async () => {
    const c = card();
    if (!c) return;
    if (!confirmDelete()) {
      setConfirmDelete(true);
      return;
    }
    const r = await kanbanDeleteCard(props.projectId, props.boardId, c.id);
    if (r.isErr())
      notify({
        title: t("kanban.deleteFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else {
      props.onChanged();
      props.onClose();
    }
  };

  const setColor = async (name: string, color: string) => {
    const r = await kanbanSetTagColor(props.projectId, props.boardId, name, color);
    if (r.isErr())
      notify({
        title: t("kanban.updateFailed") as string,
        body: r.error.message,
        severity: "error",
      });
    else props.onChanged();
  };

  const cardById = (id: string) => props.board.cards.find((k) => k.id === id);

  return (
    <Dialog open={props.cardId !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader class="shrink-0 px-6 pt-6">
          <DialogTitle>{card()?.title ?? ""}</DialogTitle>
        </DialogHeader>
        <Show when={card()}>
          {(c) => (
            <>
              <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
                {/* Title */}
                <div class="flex gap-1.5">
                  <TextField class="flex-1">
                    <TextFieldInput
                      value={titleDraft()}
                      onInput={(e) => setTitleDraft(e.currentTarget.value)}
                    />
                  </TextField>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void patch({ title: titleDraft().trim() })}
                  >
                    {t("kanban.save") as string}
                  </Button>
                </div>

                {/* Priority / status / due / archived */}
                <div class="flex flex-wrap items-center gap-1.5">
                  <KanbanSelect
                    ariaLabel="priority"
                    value={c().priority}
                    options={KANBAN_PRIORITIES.map((p) => ({ value: p, label: p }))}
                    onChange={(v) => void patch({ priority: v })}
                    class="w-28"
                  />
                  <KanbanSelect
                    ariaLabel="status"
                    value={c().status}
                    options={KANBAN_ALL_STATUSES.map((s) => ({ value: s, label: s }))}
                    onChange={(v) => void patch({ status: v })}
                    class="w-32"
                  />
                  <input
                    type="date"
                    class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                    aria-label="due"
                    value={c().due ?? ""}
                    onChange={(e) => void patch({ due: e.currentTarget.value || null })}
                  />
                  <Button
                    size="sm"
                    variant={c().archived ? "default" : "outline"}
                    class="h-8 text-xs"
                    onClick={() => void patch({ archived: !c().archived })}
                  >
                    {t("kanban.archived") as string}
                  </Button>
                  <Badge variant="outline" class={KANBAN_PRIORITY_STYLE[c().priority] ?? ""}>
                    {c().priority}
                  </Badge>
                </div>

                {/* Description */}
                <div class="flex flex-col gap-1.5">
                  <h4 class={sectionTitle}>{t("kanban.description") as string}</h4>
                  <TextField>
                    <TextFieldTextArea
                      value={bodyDraft()}
                      onInput={(e) => setBodyDraft(e.currentTarget.value)}
                      rows={5}
                      class="text-sm"
                    />
                  </TextField>
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void patch({ body: bodyDraft() })}
                    >
                      {t("kanban.save") as string}
                    </Button>
                  </div>
                </div>

                {/* Tags */}
                <div class="flex flex-col gap-1.5">
                  <h4 class={sectionTitle}>{t("kanban.tags") as string}</h4>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <For each={c().tags}>
                      {(tag) => (
                        <span class="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs">
                          <input
                            type="color"
                            class="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                            title={t("kanban.tagColor") as string}
                            value={(props.board.tagColors ?? {})[tag] ?? "#888888"}
                            onChange={(e) => void setColor(tag, e.currentTarget.value)}
                          />
                          {tag}
                          <button
                            type="button"
                            class="text-muted-foreground hover:text-foreground"
                            title={t("kanban.remove") as string}
                            onClick={() => void patch({ tags: c().tags.filter((x) => x !== tag) })}
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                    <div class="flex gap-1">
                      <TextField class="w-28">
                        <TextFieldInput
                          placeholder={t("kanban.newTag") as string}
                          class="h-7 text-xs"
                          value={tagDraft()}
                          onInput={(e) => setTagDraft(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addTag();
                          }}
                        />
                      </TextField>
                      <Button size="sm" variant="outline" class="h-7 text-xs" onClick={addTag}>
                        {t("kanban.add") as string}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Assignees */}
                <div class="flex flex-col gap-1.5">
                  <h4 class={sectionTitle}>{t("kanban.assignees") as string}</h4>
                  <div class="flex gap-1.5">
                    <TextField class="flex-1">
                      <TextFieldInput
                        placeholder={t("kanban.assigneesPlaceholder") as string}
                        class="h-8 text-xs"
                        value={assigneeDraft()}
                        onInput={(e) => setAssigneeDraft(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveAssignees();
                        }}
                      />
                    </TextField>
                    <Button size="sm" variant="outline" onClick={saveAssignees}>
                      {t("kanban.save") as string}
                    </Button>
                  </div>
                </div>

                {/* Parent + sub-issues */}
                <div class="flex flex-col gap-1.5">
                  <h4 class={sectionTitle}>{t("kanban.subIssues") as string}</h4>
                  <Show when={c().parent}>
                    <p class="text-xs">
                      {t("kanban.childOf") as string}{" "}
                      <button
                        type="button"
                        class="text-primary hover:underline"
                        onClick={() => props.onSelectCard(c().parent!)}
                      >
                        {cardById(c().parent!)?.title ?? c().parent}
                      </button>
                      <button
                        type="button"
                        class="ml-2 text-muted-foreground hover:text-foreground"
                        title={t("kanban.remove") as string}
                        onClick={() => void patch({ parent: null })}
                      >
                        ×
                      </button>
                    </p>
                  </Show>
                  <div class="flex items-center gap-1.5">
                    <KanbanSelect
                      ariaLabel="parent"
                      value={c().parent ?? ""}
                      options={[
                        { value: "", label: t("kanban.noParent") as string },
                        ...parentOptions().map((o) => ({ value: o.id, label: o.title })),
                      ]}
                      onChange={(v) => void patch({ parent: v || null })}
                      class="min-w-0 flex-1"
                    />
                  </div>
                  <Show when={children().length > 0}>
                    <ul class="flex flex-col gap-1">
                      <For each={children()}>
                        {(child) => (
                          <li>
                            <button
                              type="button"
                              class="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                              onClick={() => props.onSelectCard(child.id)}
                            >
                              <Badge variant="secondary" class="shrink-0">
                                {child.status}
                              </Badge>
                              <span class="min-w-0 flex-1 truncate">{child.title}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <div class="flex gap-1.5">
                    <TextField class="flex-1">
                      <TextFieldInput
                        placeholder={t("kanban.newSubIssue") as string}
                        class="h-8 text-xs"
                        value={subDraft()}
                        onInput={(e) => setSubDraft(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void createSubIssue();
                        }}
                      />
                    </TextField>
                    <Button size="sm" variant="outline" onClick={() => void createSubIssue()}>
                      {t("kanban.add") as string}
                    </Button>
                  </div>
                </div>

                {/* Relations */}
                <div class="flex flex-col gap-1.5">
                  <h4 class={sectionTitle}>{t("kanban.relations") as string}</h4>
                  <Show when={c().relations.length > 0}>
                    <ul class="flex flex-col gap-1">
                      <For each={c().relations}>
                        {(rel) => (
                          <li class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                            <Badge variant="outline" class="shrink-0">
                              {rel.kind}
                            </Badge>
                            <button
                              type="button"
                              class="min-w-0 flex-1 truncate text-left hover:underline"
                              onClick={() => props.onSelectCard(rel.to)}
                            >
                              {cardById(rel.to)?.title ?? rel.to}
                            </button>
                            <button
                              type="button"
                              class="text-muted-foreground hover:text-foreground"
                              title={t("kanban.remove") as string}
                              onClick={() => removeRelation(rel.to, rel.kind)}
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
                      ariaLabel="relation kind"
                      value={relKind()}
                      options={["blocking", "related", "duplicate"].map((k) => ({
                        value: k,
                        label: k,
                      }))}
                      onChange={setRelKind}
                      class="w-32"
                    />
                    <KanbanSelect
                      ariaLabel="relation target"
                      value={relTarget()}
                      options={[
                        { value: "", label: t("kanban.selectCard") as string },
                        ...props.board.cards
                          .filter((k) => k.id !== c().id)
                          .map((o) => ({ value: o.id, label: o.title })),
                      ]}
                      onChange={setRelTarget}
                      class="min-w-0 flex-1"
                    />
                    <Button size="sm" variant="outline" onClick={addRelation}>
                      {t("kanban.add") as string}
                    </Button>
                  </div>
                </div>

                {/* Linked issues (existing) */}
                <div class="flex flex-col gap-2">
                  <h4 class={sectionTitle}>{t("kanban.linkedIssues") as string}</h4>
                  <Show
                    when={linkedRefs().length > 0}
                    fallback={
                      <p class="text-xs text-muted-foreground">
                        {t("kanban.noLinkedIssues") as string}
                      </p>
                    }
                  >
                    <ul class="flex flex-col gap-1.5">
                      <For each={linkedRefs()}>
                        {(ref) => (
                          <li class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                            <span class="min-w-0 flex-1 truncate">
                              {issueOptions().find((o) => o.ref === ref)?.title ?? ref}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="h-6 w-6 shrink-0 p-0"
                              title={t("kanban.unlinkIssue") as string}
                              onClick={() =>
                                void setIssueLinks(linkedRefs().filter((r) => r !== ref))
                              }
                            >
                              ×
                            </Button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <TextField>
                    <TextFieldInput
                      placeholder={t("kanban.searchIssues") as string}
                      class="h-8 text-xs"
                      value={issueSearch()}
                      onInput={(e) => setIssueSearch(e.currentTarget.value)}
                      autocomplete="off"
                    />
                  </TextField>
                  <Show when={issuesLoading()}>
                    <p class="text-xs text-muted-foreground">{t("kanban.loading") as string}</p>
                  </Show>
                  <ul class="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    <For each={pickerOptions()}>
                      {(o) => (
                        <li>
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                            onClick={() => void setIssueLinks([...linkedRefs(), o.ref])}
                            title={t("kanban.linkIssue") as string}
                          >
                            <span class="min-w-0 flex-1 truncate">{o.title}</span>
                            <span class="shrink-0 font-mono text-[11px] text-muted-foreground">
                              #{o.number}
                            </span>
                            <span class="iconify mdi--plus size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>

                {/* Workspaces */}
                <CardWorkspaces
                  projectId={props.projectId}
                  boardId={props.boardId}
                  cardId={c().id}
                  cardTitle={c().title}
                  onChanged={props.onChanged}
                />
              </div>

              {/* Danger zone: pinned footer, tight padding */}
              <div class="flex shrink-0 justify-end border-t bg-background px-6 py-2">
                <Button
                  size="sm"
                  variant={confirmDelete() ? "destructive" : "outline"}
                  onClick={() => void deleteCard()}
                >
                  {confirmDelete()
                    ? (t("kanban.confirmDelete") as string)
                    : (t("kanban.deleteCard") as string)}
                </Button>
              </div>
            </>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
};
