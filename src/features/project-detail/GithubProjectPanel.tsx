import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createSignal, createMemo, createResource } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import DOMPurify from "dompurify";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";import { stableErrorMessage } from "~/lib/invoke-error";
import {
  closeIssue,
  createIssue,
  deleteIssue,
  listRepoIssues,
  listRepoLabels,
  readProjectReadmeHtml,
  updateIssue,
  type GitHubIssueRow,
} from "~/services/github";
import { queryKeys } from "~/services/query-keys";
import type { GitHubRepoRefDto } from "~/types/dto";
import type { StableError } from "~/types/error";
import { cn } from "~/lib/utils";

async function openExternal(href: string): Promise<void> {
  if (isTauri()) {
    await openUrl(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function toStableQueryError(e: unknown): StableError {
  if (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    "message" in e &&
    typeof (e as StableError).code === "string" &&
    typeof (e as StableError).message === "string"
  ) {
    return e as StableError;
  }
  if (e instanceof Error) {
    return { code: "INVOKE_FAILED", message: e.message };
  }
  return { code: "INVOKE_FAILED", message: String(e) };
}

type IssueFilterState = "all" | "open" | "closed";
type FilterOption = { value: IssueFilterState; label: string };

function IssueMarkdown(props: { content: string }) {
  const [html] = createResource(
    () => props.content,
    async (text) => {
      const parsed = await marked.parse(text);
      return DOMPurify.sanitize(parsed);
    },
  );

  return (
    <div class="mx-auto w-full max-w-3xl prose prose-sm dark:prose-invert">
       <Show when={html()} fallback={<p class="animate-pulse text-muted-foreground text-xs">Rendering...</p>}>
          <article class="markdown-body !bg-transparent !p-0" innerHTML={html()!} />
       </Show>
    </div>
  );
}


function LabelBadge(props: { label: { name: string; color: string }, class?: string }) {
  // luminance check for text color
  const isDark = (color: string) => {
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
  };

  return (
    <span
      class={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight shadow-sm", props.class)}
      style={{
        "background-color": `#${props.label.color}`,
        color: isDark(props.label.color) ? "white" : "black",
      }}
    >
      {props.label.name}
    </span>
  );
}

export function GithubProjectPanel(props: {
  projectId: string;
  projectPath: string;
  github: GitHubRepoRefDto | null;
  view: "readme" | "issues";
  subDetail: string | null;
  onSubDetailChange: (v: string | null) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();

  // UI State
  const [createOpen, setCreateOpen] = createSignal(false);
  const [editIssue, setEditIssue] = createSignal<GitHubIssueRow | null>(null);
  const [search, setSearch] = createSignal("");
  const [filter, setFilter] = createSignal<IssueFilterState>("open");

  // Form State
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [selectedLabels, setSelectedLabels] = createSignal<string[]>([]);

  const filterOptions: FilterOption[] = [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
  ];

  const readmeQ = createQuery(() => ({
    queryKey: queryKeys.projectReadme(props.projectId),
    queryFn: async () => {
      const r = await readProjectReadmeHtml(props.projectPath);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: () => props.view === "readme",
  }));

  const labelsQ = createQuery(() => ({
    queryKey: ["github", "labels", props.github?.owner, props.github?.repo],
    queryFn: async () => {
        const g = props.github;
        if (!g) return [];
        const r = await listRepoLabels(g.owner, g.repo);
        if (r.isErr()) throw r.error;
        return r.value;
    },
    enabled: () => props.view === "issues" && props.github != null,
  }));

  const issuesQ = createQuery(() => ({
    queryKey: queryKeys.githubProjectIssues(props.projectId),
    queryFn: async () => {
      const g = props.github;
      if (g == null) throw { code: "INVOKE_FAILED", message: "No GitHub remote." };
      const r = await listRepoIssues(g.owner, g.repo);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    enabled: () => props.view === "issues" && props.github != null,
  }));

  const selectedIssue = createMemo(() => {
    if (!props.subDetail) return null;
    return issuesQ.data?.find((i) => i.number.toString() === props.subDetail) ?? null;
  });

  const filteredIssues = createMemo(() => {
    const data = issuesQ.data;
    if (!data) return [];

    let list = [...data];

    // Status Filter
    if (filter() !== "all") {
      list = list.filter((i) => i.state === filter());
    }

    // Search
    const s = search().trim().toLowerCase();
    if (s) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(s) ||
          i.body.toLowerCase().includes(s) ||
          i.number.toString() === s ||
          i.labels.some(l => l.name.toLowerCase().includes(s))
      );
    }

    return list;
  });

  const createM = createMutation(() => ({
    mutationFn: async (args: { title: string; body: string; labels: string[] }) => {
      const g = props.github;
      if (!g) throw new Error("No remote");
      const r = await createIssue(g.owner, g.repo, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.githubProjectIssues(props.projectId) });
      setCreateOpen(false);
      setTitle("");
      setBody("");
      setSelectedLabels([]);
    },
  }));

  const updateM = createMutation(() => ({
    mutationFn: async (args: { number: number; title: string; body: string; labels: string[] }) => {
      const g = props.github;
      if (!g) throw new Error("No remote");
      const r = await updateIssue(g.owner, g.repo, args.number, args.title, args.body, args.labels);
      if (r.isErr()) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.githubProjectIssues(props.projectId) });
      setEditIssue(null);
    },
  }));

  const closeM = createMutation(() => ({
    mutationFn: async (number: number) => {
      const g = props.github;
      if (!g) throw new Error("No remote");
      const r = await closeIssue(g.owner, g.repo, number);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.githubProjectIssues(props.projectId) });
    },
  }));

  const deleteM = createMutation(() => ({
    mutationFn: async (number: number) => {
      const g = props.github;
      if (!g) throw new Error("No remote");
      const r = await deleteIssue(g.owner, g.repo, number);
      if (r.isErr()) throw r.error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.githubProjectIssues(props.projectId) });
      props.onSubDetailChange(null);
    },
  }));

  const toggleLabel = (name: string) => {
    setSelectedLabels(prev => 
      prev.includes(name) ? prev.filter(l => l !== name) : [...prev, name]
    );
  };

  return (
    <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Show when={props.view === "readme"}>
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 scrollbar-none">
          <Show when={readmeQ.isPending}>
            <div class="flex items-center justify-center py-20">
               <span class="iconify mdi--loading animate-spin h-8 w-8 text-muted-foreground/20" />
            </div>
          </Show>
          <Show when={readmeQ.isError}>
              <div class="flex flex-col items-center justify-center py-24 text-center animate-in fade-in duration-500">
                <div class="size-20 rounded-full bg-muted/30 flex items-center justify-center mb-6">
                   <span class="iconify mdi--file-document-outline h-10 w-10 text-muted-foreground/20" />
                </div>
                <h3 class="text-lg font-semibold mb-1">No README found</h3>
                <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
                   This project doesn't have a README file in its root directory or it could not be loaded.
                </p>
              </div>
          </Show>
          <Show when={readmeQ.isSuccess && readmeQ.data != null}>
            <div class="pv-github-readme mx-auto w-full max-w-3xl pb-10 pt-4">
              <article class="markdown-body !bg-transparent" innerHTML={readmeQ.data} />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.view === "issues" && props.github != null}>
        <Show
          when={selectedIssue()}
          fallback={
            <div class="flex h-full flex-col min-h-0">
              <div class="mb-4 flex flex-col gap-3 border-b border-border/50 pb-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <span class="text-sm font-semibold">Issues</span>
                    <Badge variant="secondary" class="h-5 px-1.5 text-[10px] tabular-nums font-mono">
                      {filteredIssues().length}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    class="h-8 gap-1.5 px-3"
                    onClick={() => {
                      setTitle("");
                      setBody("");
                      setSelectedLabels([]);
                      setCreateOpen(true);
                    }}
                  >
                    <span class="iconify mdi--plus h-4 w-4" />
                    New Issue
                  </Button>
                </div>

                <div class="flex gap-2">
                  <TextField class="flex-1">
                    <TextFieldInput
                      placeholder="Search title, body or labels..."
                      class="h-8 text-xs"
                      value={search()}
                      onInput={(e) => setSearch(e.currentTarget.value)}
                      autocomplete="off"
                    />
                  </TextField>
                  <div class="w-32">
                    <Select<FilterOption>
                      options={filterOptions}
                      optionValue="value"
                      optionTextValue="label"
                      value={filterOptions.find((o) => o.value === filter())}
                      onChange={(o) => o && setFilter(o.value)}
                      itemComponent={(p) => (
                        <Select.Item item={p.item}>
                          <Select.ItemLabel class="text-xs">
                            {p.item.rawValue.label}
                          </Select.ItemLabel>
                        </Select.Item>
                      )}
                    >
                      <Select.Trigger class="h-8 bg-muted/30 text-xs">
                        <Select.Value<FilterOption>>
                          {(s) => s.selectedOption()?.label ?? "Status"}
                        </Select.Value>
                        <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
                      </Select.Trigger>
                      <Select.Content />
                    </Select>
                  </div>
                </div>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                <Show when={issuesQ.isPending}>
                  <p class="text-sm text-muted-foreground">{t("github.loadingIssues") as string}</p>
                </Show>
                <Show when={issuesQ.isError}>
                  <p class="text-sm text-destructive" role="alert">
                    {stableErrorMessage(t, toStableQueryError(issuesQ.error))}
                  </p>
                </Show>
                <Show
                  when={issuesQ.isSuccess && filteredIssues().length > 0}
                  fallback={
                    <Show when={issuesQ.isSuccess}>
                      <div class="flex flex-col items-center justify-center py-12 text-center">
                        <span class="iconify mdi--alert-circle-outline mb-2 h-8 w-8 text-muted-foreground/40" />
                        <p class="text-sm text-muted-foreground">
                          No issues found matching your criteria.
                        </p>
                      </div>
                    </Show>
                  }
                >
                  <ul class="space-y-2 pb-4">
                    <For each={filteredIssues()}>
                      {(row) => (
                        <li
                          class="group flex flex-col gap-1.5 rounded-md border border-border/40 bg-card/40 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/30"
                          onClick={() => props.onSubDetailChange(row.number.toString())}
                        >
                          <div class="flex items-start gap-2">
                            <span
                              class={cn(
                                "iconify h-4 w-4 shrink-0 mt-0.5",
                                row.state === "open"
                                  ? "mdi--alert-circle-outline text-green-500"
                                  : "mdi--check-circle-outline text-purple-500",
                              )}
                            />
                            <div class="min-w-0 flex-1 space-y-1">
                                <div class="flex items-center gap-2 justify-between">
                                   <span class="min-w-0 flex-1 truncate text-sm font-medium">
                                     {row.title}
                                   </span>
                                   <span class="text-[10px] text-muted-foreground font-mono tabular-nums opacity-60">
                                     #{row.number}
                                   </span>
                                </div>
                                <Show when={row.labels.length > 0}>
                                   <div class="flex flex-wrap gap-1">
                                      <For each={row.labels}>
                                         {(l) => <LabelBadge label={l} />}
                                      </For>
                                   </div>
                                </Show>
                            </div>
                          </div>
                          <div class="flex items-center gap-2 pl-6 text-[10px] text-muted-foreground">
                            <span>{new Date(row.updatedAt).toLocaleDateString()}</span>
                            <span>•</span>
                            <span>{row.userLogin}</span>
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </div>
          }
        >
          {(issue) => (
            <div class="flex h-full flex-col min-h-0 animate-in fade-in slide-in-from-right-4 duration-300">
              <div class="mb-4 flex items-center justify-between border-b border-border/50 pb-3 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-8 gap-1.5 text-xs -ml-2"
                  onClick={() => props.onSubDetailChange(null)}
                >
                  <span class="iconify mdi--arrow-left h-4 w-4" />
                  Back to List
                </Button>
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-8 gap-1.5 text-xs"
                    onClick={() => {
                      const i = issue();
                      setTitle(i.title);
                      setBody(i.body);
                      setSelectedLabels(i.labels.map(l => l.name));
                      setEditIssue(i);
                    }}
                  >
                    <span class="iconify mdi--pencil h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Show when={issue().state === "open"}>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10"
                      disabled={closeM.isPending}
                      onClick={() => closeM.mutate(issue().number)}
                    >
                      <Show when={closeM.isPending}>
                        <span class="iconify mdi--loading animate-spin h-3.5 w-3.5" />
                      </Show>
                      <Show when={!closeM.isPending}>
                        <span class="iconify mdi--close-circle-outline h-3.5 w-3.5" />
                      </Show>
                      Close
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={deleteM.isPending}
                    onClick={() => {
                      if (confirm("Permanently delete this issue? This cannot be undone.")) {
                        deleteM.mutate(issue().number);
                      }
                    }}
                    title="Delete Issue"
                  >
                    <span class="iconify mdi--trash-can-outline h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div class="flex-1 overflow-y-auto pr-1">
                <div class="flex flex-wrap items-center gap-y-2 gap-x-4 mb-3 pb-4 border-b border-border/30">
                  <Badge
                    class="gap-1.5 h-6"
                    variant={issue().state === "open" ? "default" : "secondary"}
                  >
                    <span
                      class={cn(
                        "iconify h-3.5 w-3.5",
                        issue().state === "open"
                          ? "mdi--alert-circle-outline"
                          : "mdi--check-circle-outline",
                      )}
                    />
                    {issue().state}
                  </Badge>
                  <div class="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <span class="iconify mdi--pound h-3.5 w-3.5 opacity-50" />
                    {issue().number}
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span class="iconify mdi--clock-outline h-3.5 w-3.5 opacity-50" />
                    {new Date(issue().updatedAt).toLocaleDateString()}
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span class="iconify mdi--account-circle-outline h-3.5 w-3.5 opacity-50" />
                    {issue().userLogin}
                  </div>
                </div>

                <Show when={issue().labels.length > 0}>
                   <div class="flex flex-wrap gap-1.5 mb-5">
                      <For each={issue().labels}>
                         {(l) => <LabelBadge label={l} class="px-2.5 py-1 text-[10px]" />}
                      </For>
                   </div>
                </Show>

                <h2 class="text-xl font-bold tracking-tight mb-6">{issue().title}</h2>

                <div class="rounded-lg border border-border/40 bg-muted/20 p-4">
                  <Show
                    when={issue().body}
                    fallback={
                      <p class="italic text-muted-foreground text-xs">No description provided.</p>
                    }
                  >
                    <IssueMarkdown content={issue().body} />
                  </Show>
                </div>

                <div class="mt-8 flex justify-center pb-6">
                   <Button
                     variant="link"
                     class="text-xs text-muted-foreground hover:text-primary gap-1.5"
                     onClick={() => void openExternal(issue().htmlUrl)}
                   >
                     <span class="iconify mdi--github h-3.5 w-3.5" />
                     View this issue on GitHub
                   </Button>
                </div>
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* New Issue Dialog */}
      <Dialog open={createOpen()} onOpenChange={setCreateOpen}>
        <DialogContent class="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create New Issue</DialogTitle>
            <DialogDescription>
              Submit a new issue to {props.github?.owner}/{props.github?.repo}
            </DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <TextField class="grid gap-2">
              <TextFieldInput
                placeholder="Title"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </TextField>
            <textarea
              class="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Description (Markdown supported)"
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
            />
            
            <div class="space-y-2">
               <label class="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Labels</label>
               <div class="flex flex-wrap gap-1.5">
                  <For each={labelsQ.data ?? []}>
                     {(l) => (
                        <button
                          type="button"
                          onClick={() => toggleLabel(l.name)}
                          class={cn(
                            "transition-opacity hover:opacity-100",
                            selectedLabels().includes(l.name) ? "opacity-100" : "opacity-30 grayscale-[50%]"
                          )}
                        >
                           <LabelBadge label={l} class="cursor-pointer py-1 px-2.5" />
                        </button>
                     )}
                  </For>
               </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createM.isPending || !title().trim()}
              onClick={() => createM.mutate({ title: title(), body: body(), labels: selectedLabels() })}
            >
              <Show when={createM.isPending}>
                <span class="iconify mdi--loading mr-2 h-4 w-4 animate-spin" />
              </Show>
              Create Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Issue Dialog */}
      <Dialog open={!!editIssue()} onOpenChange={(o) => !o && setEditIssue(null)}>
        <DialogContent class="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Issue #{editIssue()?.number}</DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <TextField class="grid gap-2">
              <TextFieldInput
                placeholder="Title"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </TextField>
            <textarea
              class="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Description (Markdown supported)"
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
            />

            <div class="space-y-2">
               <label class="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Labels</label>
               <div class="flex flex-wrap gap-1.5">
                  <For each={labelsQ.data ?? []}>
                     {(l) => (
                        <button
                          type="button"
                          onClick={() => toggleLabel(l.name)}
                          class={cn(
                            "transition-opacity hover:opacity-100",
                            selectedLabels().includes(l.name) ? "opacity-100" : "opacity-30 grayscale-[50%]"
                          )}
                        >
                           <LabelBadge label={l} class="cursor-pointer py-1 px-2.5" />
                        </button>
                     )}
                  </For>
               </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditIssue(null)}>
              Cancel
            </Button>
            <Button
              disabled={updateM.isPending || !title().trim()}
              onClick={() =>
                updateM.mutate({ 
                    number: editIssue()!.number, 
                    title: title(), 
                    body: body(),
                    labels: selectedLabels() 
                })
              }
            >
              <Show when={updateM.isPending}>
                <span class="iconify mdi--loading mr-2 h-4 w-4 animate-spin" />
              </Show>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
