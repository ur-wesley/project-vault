import { For, Show, createSignal, createMemo, createEffect, onMount, onCleanup, type Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { createQuery } from "@tanstack/solid-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useI18n } from "~/lib/i18n-context";
import { stableErrorMessage } from "~/lib/invoke-error";
import { readProjectReadmeHtml } from "~/services/github";
import { deleteAllLocalIssues, setProjectTag } from "~/services/tauri";
import { queryKeys } from "~/services/query-keys";
import { cn } from "~/lib/utils";
import type { StableError } from "~/types/error";

import { useGithubIssues, type ExtendedIssueRow } from "./model/useGithubIssues";
import { LabelBadge } from "./components/LabelBadge";
import { GithubIssueDetail } from "./components/GithubIssueDetail";
import { GithubIssueDialogs } from "./components/GithubIssueDialogs";
import type { ProjectDetailModel } from "./model/createProjectDetailModel";

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
  projectId: () => string;
  projectPath: () => string;
  github: () => { owner: string; repo: string } | null;
  view: "readme" | "issues";
  subDetail: string | null;
  onSubDetailChange: (id: string | null) => void;
  model: ProjectDetailModel;
}> = (props) => {
  const { t, localeCode } = useI18n();
  const [mutationError, setMutationError] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;

  const syncDismissed = createMemo(() => props.model.projectQ.data?.tags.includes("dismissed_sync_banner") ?? false);

  const setSyncDismissed = async () => {
    const r = await setProjectTag({ id: props.projectId(), tag: "dismissed_sync_banner" });
    if (r.isErr()) setMutationError(r.error.message);
    void props.model.projectQ.refetch();
  };

  // UI State
  const [createOpen, setCreateOpen] = createSignal(false);
  const [editIssue, setEditIssue] = createSignal<ExtendedIssueRow | null>(null);
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
    queryKey: queryKeys.projectReadme(props.projectId()),
    queryFn: async () => {
      const r = await readProjectReadmeHtml(props.projectPath());
      if (r.isErr()) throw r.error;
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

  const { labels, issuesQ, localIssuesQ, syncM, createM, updateM, closeM } = useGithubIssues({
    projectId: props.projectId,
    github: props.github,
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
    selectedLabels,
  });

  createEffect(() => {
    console.log("[GithubProjectPanel] Sync Check:", {
        hasGithub: props.github() != null,
        github: props.github(),
        localCount: localIssuesQ.data?.length ?? 0,
        localIssues: localIssuesQ.data,
        syncDismissed: syncDismissed()
    });
  });

  const selectedIssue = createMemo(() => {
    if (!props.subDetail) return null;
    const [numStr, source] = props.subDetail.split(":");
    return issuesQ.data?.find((i) => 
      i.number.toString() === numStr && 
      (source === "local" ? i.isLocal : !i.isLocal)
    ) ?? null;
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
      <div class="mx-auto w-full max-w-3xl px-1 shrink-0">
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

        <Show when={props.github() != null && localIssuesQ.data && localIssuesQ.data.length > 0 && !syncDismissed()}>
          <div class="mb-6 flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 relative">
            <div class="flex items-start justify-between gap-4">
              <div class="space-y-1">
                <h4 class="text-sm font-bold text-primary">
                  {t("projectDetail.localIssuesDetected") as string}
                </h4>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  {t("projectDetail.localIssuesSyncDescription", { count: localIssuesQ.data!.length }) as string}
                </p>
              </div>
              <span class="iconify mdi--cloud-sync-outline h-8 w-8 text-primary/30 shrink-0" />
            </div>
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                class="h-8 gap-1.5 px-4"
                onClick={() => syncM.mutate()}
                disabled={syncM.isPending}
              >
                <Show when={syncM.isPending} fallback={<span class="iconify mdi--cloud-upload h-4 w-4" />}>
                   <span class="iconify mdi--cloud-upload h-4 w-4" />
                </Show>
                {t("projectDetail.syncToGithub") as string}
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-8 px-4 text-xs"
                onClick={() => setSyncDismissed()}
              >
                {t("common.dismiss") as string}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 px-4 text-xs text-muted-foreground hover:text-destructive"
                onClick={async () => {
                   if (await safeConfirm(t("projectDetail.discardLocalIssuesConfirm") as string)) {
                      await deleteAllLocalIssues(props.projectId());
                      void localIssuesQ.refetch();
                      void issuesQ.refetch();
                   }
                }}
              >
                {t("projectDetail.discardLocal") as string}
              </Button>
            </div>
          </div>
        </Show>
      </div>

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

      <Show when={props.view === "issues"}>
        <Show
          when={selectedIssue()}
          fallback={
            <div class="flex h-full flex-col min-h-0">
              <div class="mx-auto w-full max-w-3xl flex flex-col h-full min-h-0">
                <div class="mb-4 flex flex-col gap-3 border-b border-border/50 pb-4 shrink-0">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <span class="text-sm font-semibold">
                        {t("projectDetail.githubIssues") as string}
                      </span>
                      <Badge variant="secondary" class="h-5 px-1.5 text-[10px] tabular-nums font-mono">
                        {filteredIssues().length}
                      </Badge>
                      
                      <Show when={props.github() != null && localIssuesQ.data && localIssuesQ.data.length > 0 && syncDismissed()}>
                        <Tooltip>
                          <TooltipTrigger
                            as={Button}
                            size="icon"
                            variant="ghost"
                            class="h-6 w-6 text-primary/60 hover:text-primary hover:bg-primary/10"
                            onClick={() => syncM.mutate()}
                            disabled={syncM.isPending}
                          >
                            <Show when={syncM.isPending} fallback={<span class="iconify mdi--cloud-upload h-3.5 w-3.5" />}>
                               <span class="iconify mdi--loading animate-spin h-3.5 w-3.5" />
                            </Show>
                          </TooltipTrigger>
                          <TooltipContent class="text-xs">
                             {t("projectDetail.syncLocalIssuesTooltip", { count: localIssuesQ.data!.length }) as string}
                          </TooltipContent>
                        </Tooltip>
                      </Show>
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
                          <SelectItem item={p.item}>
                            {p.item.rawValue.label}
                          </SelectItem>
                        )}
                      >
                        <SelectTrigger class="h-8 bg-muted/30 text-xs">
                          <SelectValue<FilterOption>>
                            {(s) => s.selectedOption()?.label ?? (t("common.status") as string)}
                          </SelectValue>
                          <span class="iconify mdi--chevron-down h-4 w-4 opacity-50" />
                        </SelectTrigger>
                        <SelectContent />
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
                              !row.isPending && props.onSubDetailChange(`${row.number}:${row.isLocal ? "local" : "github"}`)
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
                                  <div class="flex items-center gap-2 min-w-0 flex-1">
                                    <span class="min-w-0 truncate text-sm font-medium">
                                      {row.title}
                                    </span>
                                    <Show when={row.isLocal}>
                                      <Badge variant="outline" class="h-4 px-1 text-[8px] font-bold uppercase tracking-tighter border-primary/30 text-primary/70">
                                        local
                                      </Badge>
                                    </Show>
                                  </div>
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
                              <span>
                                {(() => {
                                  const date = new Date(row.updatedAt);
                                  return isNaN(date.getTime()) ? "recently" : date.toLocaleDateString(localeCode());
                                })()}
                              </span>
                              <span>•</span>
                              <span>{row.userLogin || "local"}</span>
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
                  closeM.mutate({ number: issue().number, isLocal: issue().isLocal });
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
        labels={labels()}
        github={props.github()}
        createM={createM}
        updateM={updateM}
        t={(k, a) => t(k, a) as string}
      />
    </div>
  );
};
