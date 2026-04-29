import { For, Show, createSignal, createMemo, onMount, onCleanup, type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { createQuery, useQueryClient } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { readProjectReadmeHtml, type GitHubIssueRow } from "~/services/github";
import { queryKeys } from "~/services/query-keys";
import { cn } from "~/lib/utils";
import type { StableError } from "~/types/error";

import { useGithubIssues } from "./model/useGithubIssues";
import { LabelBadge } from "./components/LabelBadge";
import { GithubIssueDetail } from "./components/GithubIssueDetail";
import { GithubIssueDialogs } from "./components/GithubIssueDialogs";

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

async function safeConfirm(message: string): Promise<boolean> {
  if (isTauri()) {
    return await ask(message, {
      title: "Project Vault",
      kind: "warning",
    });
  }
  return window.confirm(message);
}

type IssueFilterState = "all" | "open" | "closed";
type FilterOption = { value: IssueFilterState; label: string };

export const GithubProjectPanel: Component<{
  projectId: string;
  projectPath: string;
  github: { owner: string; repo: string } | null;
  view: "readme" | "issues";
  subDetail: string | null;
  onSubDetailChange: (id: string | null) => void;
}> = (props) => {
  const { t, localeCode } = useI18n();
  const [mutationError, setMutationError] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;

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
    { value: "open", label: t("projectDetail.issueStatusOpen") as string },
    { value: "closed", label: t("projectDetail.issueStatusClosed") as string },
    { value: "all", label: t("projectDetail.issueStatusAll") as string },
  ];

  const readmeQ = createQuery(() => ({
    queryKey: queryKeys.projectReadme(props.projectId),
    queryFn: async () => {
      const r = await readProjectReadmeHtml(props.projectPath);
      if (r.isErr()) throw r.error;
      // Re-parse with our renderer for copy buttons
      const rawHtml = r.value;
      // readProjectReadmeHtml might return pre-parsed HTML if it's coming from a service that converts markdown.
      // But the tool list shows it as readProjectReadmeHtml.
      // If it's already HTML, we'd need to inject buttons into the DOM.
      // For now assume we need to parse it if we want the renderer to work.
      // Wait, readProjectReadmeHtml usually returns HTML.
      return r.value;
    },
    enabled: props.view === "readme",
    retry: false,
  }));

  const handleCopy = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest(".markdown-copy-btn") as HTMLButtonElement;
    if (!btn) return;

    const pre = btn.closest("pre");
    if (!pre) return;

    const code = pre.querySelector("code");
    const text = code ? code.innerText : pre.innerText.replace("Copy", "").trim();

    try {
      await navigator.clipboard.writeText(text);
      const icon = btn.querySelector(".iconify");
      if (icon) {
        const oldClass = icon.className;
        icon.className = "iconify mdi--check text-green-500 h-3.5 w-3.5";
        setTimeout(() => {
          icon.className = oldClass;
        }, 2000);
      }
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const { labelsQ, issuesQ, createM, updateM, closeM } = useGithubIssues({
    projectId: () => props.projectId,
    github: () => props.github,
    t: (k, a) => t(k, a) as string,
    setMutationError,
    onIssueCreated: () => {
      setCreateOpen(false);
      setTitle("");
      setBody("");
      setSelectedLabels([]);
    },
    onIssueUpdated: () => {
      setEditIssue(null);
      setTitle("");
      setBody("");
      setSelectedLabels([]);
    },
  });

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
          i.labels.some((l) => l.name.toLowerCase().includes(s)),
      );
    }

    return list;
  });

  const toggleLabel = (name: string) => {
    setSelectedLabels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    );
  };

  onMount(() => {
    containerRef?.addEventListener("click", handleCopy);
  });

  onCleanup(() => {
    containerRef?.removeEventListener("click", handleCopy);
  });

  return (
    <div ref={containerRef} class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Show when={props.view === "readme"}>
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 pb-3 scrollbar-none">
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
              <h3 class="text-lg font-semibold mb-1">{t("projectDetail.readmeNotFound") as string}</h3>
              <p class="max-w-[280px] text-sm text-muted-foreground leading-relaxed">
                {t("projectDetail.readmeNotFoundDescription") as string}
              </p>
            </div>
          </Show>
          <Show when={readmeQ.isSuccess && readmeQ.data != null}>
            <div class="pv-github-readme mx-auto w-full max-w-3xl pt-4">
              <article class="markdown-body !bg-transparent" innerHTML={readmeQ.data!} />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.view === "issues" && props.github != null}>
        <Show
          when={selectedIssue()}
          fallback={
            <div class="flex h-full flex-col min-h-0">
              <div class="mx-auto w-full max-w-3xl flex flex-col h-full min-h-0">
                <Show when={mutationError()}>
                  <div class="mb-4 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive animate-in fade-in slide-in-from-top-2">
                    <div class="flex items-center gap-2">
                      <span class="iconify mdi--alert-circle h-4 w-4" />
                      {mutationError()}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-6 w-6 text-destructive hover:bg-destructive/10"
                      onClick={() => setMutationError(null)}
                    >
                      <span class="iconify mdi--close h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Show>

                <div class="mb-4 flex flex-col gap-3 border-b border-border/50 pb-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <span class="text-sm font-semibold">
                        {t("projectDetail.githubIssues") as string}
                      </span>
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
                      {t("projectDetail.newIssue") as string}
                    </Button>
                  </div>

                  <div class="flex gap-2">
                    <TextField class="flex-1">
                      <TextFieldInput
                        placeholder={t("projectDetail.searchIssues") as string}
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
                            {(s) => s.selectedOption()?.label ?? (t("common.status") as string)}
                          </Select.Value>
                          <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Listbox />
                        </Select.Content>
                      </Select>
                    </div>
                  </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto pr-1 pb-3 scrollbar-none">
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
                            {t("projectDetail.noIssuesFound") as string}
                          </p>
                        </div>
                      </Show>
                    }
                  >
                    <ul class="space-y-2">
                      <For each={filteredIssues()}>
                        {(row) => (
                          <li
                            class={cn(
                              "group flex flex-col gap-1.5 rounded-md border border-border/40 bg-card/40 px-3 py-2.5 transition-colors",
                              row.isPending
                                ? "opacity-60 cursor-default grayscale-[50%]"
                                : "cursor-pointer hover:bg-muted/30",
                            )}
                            onClick={() =>
                              !row.isPending && props.onSubDetailChange(row.number.toString())
                            }
                          >
                            <div class="flex items-start gap-2">
                              <span
                                class={cn(
                                  "iconify h-4 w-4 shrink-0 mt-0.5",
                                  row.isPending
                                    ? "mdi--loading animate-spin text-muted-foreground"
                                    : row.state === "open"
                                      ? "mdi--alert-circle-outline text-green-500"
                                      : "mdi--check-circle-outline text-purple-500",
                                )}
                              />
                              <div class="min-w-0 flex-1 space-y-1">
                                <div class="flex items-center gap-2 justify-between">
                                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                                    {row.title}
                                  </span>
                                  <Show
                                    when={!row.isPending}
                                    fallback={
                                      <span class="text-[9px] font-bold uppercase tracking-widest text-primary animate-pulse">
                                        Sending...
                                      </span>
                                    }
                                  >
                                    <span class="text-[10px] text-muted-foreground font-mono tabular-nums opacity-60">
                                      #{row.number}
                                    </span>
                                  </Show>
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
                              <span>{new Date(row.updatedAt).toLocaleDateString(localeCode())}</span>
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
            </div>
          }
        >
          {(issue) => (
            <GithubIssueDetail
              issue={issue()}
              onBack={() => props.onSubDetailChange(null)}
              onEdit={() => {
                const i = issue();
                setTitle(i.title);
                setBody(i.body);
                setSelectedLabels(i.labels.map((l) => l.name));
                setEditIssue(i);
              }}
              onClose={async () => {
                if (await safeConfirm(t("projectDetail.closeIssueConfirm") as string)) {
                  closeM.mutate(issue().number);
                }
              }}
              isClosing={closeM.isPending}
              openExternal={openExternal}
              localeCode={localeCode()}
              t={(k) => t(k) as string}
            />
          )}
        </Show>
      </Show>

      <GithubIssueDialogs
        createOpen={createOpen()}
        setCreateOpen={setCreateOpen}
        editIssue={editIssue()}
        setEditIssue={setEditIssue}
        title={title()}
        setTitle={setTitle}
        body={body()}
        setBody={setBody}
        selectedLabels={selectedLabels()}
        toggleLabel={toggleLabel}
        labels={labelsQ.data ?? []}
        github={props.github}
        createM={createM}
        updateM={updateM}
        t={(k, a) => t(k, a) as string}
      />
    </div>
  );
};
