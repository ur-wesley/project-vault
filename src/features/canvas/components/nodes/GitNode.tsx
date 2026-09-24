import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { getGitStatus, gitChangedFiles, gitFileDiff, gitPull, gitPush } from "~/services/tauri/git";
import { queryKeys } from "~/services/query-keys";
import { CanvasNodeContainer, type CanvasNodeComponentProps } from "./CanvasNodeContainer";

const STATUS_COLORS: Record<string, string> = {
  M: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  A: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  D: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  R: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  U: "text-red-400 border-red-500/40 bg-red-500/10",
  "?": "text-muted-foreground border-border/60 bg-muted/40",
};

/** Cap rendered diff lines so a huge hunk can't blow up the canvas. */
const MAX_DIFF_LINES = 600;

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-sky-400";
  if (line.startsWith("+") && !line.startsWith("+++")) return "text-emerald-400 bg-emerald-500/10";
  if (line.startsWith("-") && !line.startsWith("---")) return "text-rose-400 bg-rose-500/10";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  )
    return "text-muted-foreground";
  return "text-foreground/80";
}

export const GitNode: Component<CanvasNodeComponentProps> = (props) => {
  const qc = useQueryClient();
  const gitQ = createQuery(() => ({
    queryKey: queryKeys.gitStatus(props.project().id),
    queryFn: async () => {
      const res = await getGitStatus(props.project().id);
      return res.isOk() ? res.value : null;
    },
    refetchInterval: 3000,
  }));

  const [tab, setTab] = createSignal<"status" | "diff">("status");
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  // Only poll while the diff tab is visible; the status query already
  // polls every 3s and drives the Dirty/Clean badge.
  const filesQ = createQuery(() => ({
    queryKey: queryKeys.gitChangedFiles(props.project().id),
    queryFn: async () => {
      const res = await gitChangedFiles(props.project().id);
      return res.isOk() ? res.value : null;
    },
    refetchInterval: 5000,
    enabled: tab() === "diff",
  }));

  const files = () => filesQ.data ?? [];

  // Auto-select the first changed file; drop the selection when it
  // disappears from the list (e.g. after an external commit).
  createEffect(() => {
    const list = files();
    const sel = selectedPath();
    if (list.length === 0) {
      if (sel !== null) setSelectedPath(null);
      return;
    }
    if (sel === null || !list.some((f) => f.path === sel)) {
      setSelectedPath(list[0]!.path);
    }
  });

  const diffQ = createQuery(() => ({
    queryKey: queryKeys.gitFileDiff(props.project().id, selectedPath() ?? ""),
    queryFn: async () => {
      const res = await gitFileDiff(props.project().id, selectedPath() ?? "");
      return res.isOk() ? res.value : null;
    },
    refetchInterval: 5000,
    enabled: tab() === "diff" && selectedPath() !== null,
  }));

  const diffLines = createMemo(() => {
    const diff = diffQ.data?.diff ?? "";
    if (!diff) return [] as string[];
    return diff.split(/\r?\n/);
  });
  const renderedLines = createMemo(() => diffLines().slice(0, MAX_DIFF_LINES));
  const hiddenLineCount = () => Math.max(0, diffLines().length - renderedLines().length);

  const isDirty = () => gitQ.data?.isDirty ?? false;
  const branch = () => gitQ.data?.branch ?? "unknown";
  const ahead = () => gitQ.data?.ahead ?? 0;
  const behind = () => gitQ.data?.behind ?? 0;

  const handlePull = async () => {
    await gitPull(props.project().id);
    qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.project().id) });
  };

  const handlePush = async () => {
    await gitPush(props.project().id);
    qc.invalidateQueries({ queryKey: queryKeys.gitStatus(props.project().id) });
  };

  const handleRefreshDiff = () => {
    qc.invalidateQueries({ queryKey: queryKeys.gitChangedFiles(props.project().id) });
    const sel = selectedPath();
    if (sel !== null) {
      qc.invalidateQueries({ queryKey: queryKeys.gitFileDiff(props.project().id, sel) });
    }
  };

  return (
    <CanvasNodeContainer
      node={props.node}
      icon="mdi--git"
      badge={isDirty() ? "Dirty" : "Clean"}
      badgeVariant={isDirty() ? "amber" : "nominal"}
      isDraggable={props.isDraggable}
      snapEnabled={props.snapEnabled}
      zoom={props.zoom}
      resizable={tab() === "diff"}
      onPositionChange={props.onPositionChange}
      onResize={props.onResize}
      onDelete={props.onDelete}
      onPinToggle={props.onPinToggle}
      isFocused={props.isFocused}
      isFullscreen={props.isFullscreen}
      onFocusNode={props.onFocusNode}
      onToggleFullscreen={props.onToggleFullscreen}
      onTitleChange={props.onTitleChange}
      onStartDrag={props.onStartDrag}
    >
      <div class="flex flex-col gap-2.5">
        {/* Status / Diff tab switcher */}
        <div class="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("status")}
            class="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": tab() === "status",
              "text-muted-foreground hover:text-foreground": tab() !== "status",
            }}
            title="Branch status, pull & push"
          >
            <span class="iconify mdi--source-branch size-3.5" />
            Status
          </button>
          <button
            type="button"
            onClick={() => setTab("diff")}
            class="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium transition-colors"
            classList={{
              "bg-background text-foreground shadow-sm": tab() === "diff",
              "text-muted-foreground hover:text-foreground": tab() !== "diff",
            }}
            title="Changed files & uncommitted diff"
          >
            <span class="iconify mdi--file-compare size-3.5" />
            Diff
            <Show when={filesQ.data && filesQ.data.length > 0}>
              <span class="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                {filesQ.data!.length}
              </span>
            </Show>
          </button>
        </div>

        <Show
          when={tab() === "status"}
          fallback={
            <div class="flex flex-col gap-2">
              {/* Diff toolbar: count + refresh */}
              <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  <Show when={filesQ.isPending} fallback={<>{files().length} changed file(s)</>}>
                    Loading changes…
                  </Show>
                </span>
                <button
                  type="button"
                  onClick={handleRefreshDiff}
                  class="flex items-center gap-1 rounded border border-border/60 bg-secondary/50 px-2 py-0.5 font-medium hover:bg-secondary active:scale-95 transition-all"
                  title="Reload changed files & diff"
                >
                  <span
                    class="iconify mdi--refresh size-3"
                    classList={{ "animate-spin": filesQ.isFetching || diffQ.isFetching }}
                  />
                  Refresh
                </button>
              </div>

              <Show
                when={!filesQ.isPending && files().length > 0}
                fallback={
                  <Show when={!filesQ.isPending}>
                    <div class="rounded bg-muted/40 px-2 py-3 text-center text-[11px] text-muted-foreground">
                      <Show
                        when={gitQ.data === null}
                        fallback="Working tree is clean — nothing to diff."
                      >
                        Not a git repository.
                      </Show>
                    </div>
                  </Show>
                }
              >
                {/* Changed-file list */}
                <div class="flex max-h-36 flex-col gap-1 overflow-auto rounded bg-muted/40 p-1.5">
                  <For each={files()}>
                    {(f) => (
                      <button
                        type="button"
                        onClick={() => setSelectedPath(f.path)}
                        class="flex items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] transition-colors hover:bg-muted"
                        classList={{ "bg-primary/15": selectedPath() === f.path }}
                        title={f.path}
                      >
                        <span
                          class={`flex w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                            STATUS_COLORS[f.status] ?? STATUS_COLORS["?"]!
                          }`}
                        >
                          {f.status}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-foreground/90">{f.path}</span>
                        <Show when={f.additions > 0 || f.deletions > 0}>
                          <span class="shrink-0">
                            <span class="text-emerald-400">+{f.additions}</span>
                            <span class="text-muted-foreground">/</span>
                            <span class="text-rose-400">-{f.deletions}</span>
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>

                {/* Per-file unified diff (read-only; <pre> so text selection never starts a drag) */}
                <div class="flex min-h-0 flex-col gap-1">
                  <div
                    class="truncate font-mono text-[11px] font-semibold text-primary"
                    title={selectedPath() ?? ""}
                  >
                    {selectedPath()}
                  </div>
                  <Show
                    when={!diffQ.isPending && diffQ.data}
                    fallback={
                      <div class="rounded bg-muted/40 px-2 py-3 text-center text-[11px] text-muted-foreground">
                        {diffQ.isPending ? "Loading diff…" : "Could not load diff."}
                      </div>
                    }
                  >
                    <pre
                      class="overflow-auto rounded border border-border/40 bg-background/50 p-2 font-mono text-[10px] leading-relaxed"
                      classList={{
                        "max-h-64": !props.isFullscreen,
                        "min-h-0 flex-1": !!props.isFullscreen,
                      }}
                    >
                      <For each={renderedLines()}>
                        {(line) => (
                          <div class={`whitespace-pre-wrap break-all px-1 ${diffLineClass(line)}`}>
                            {line || " "}
                          </div>
                        )}
                      </For>
                      <Show when={hiddenLineCount() > 0 || diffQ.data!.truncated}>
                        <div class="px-1 pt-1 text-muted-foreground">
                          … {hiddenLineCount() > 0 ? `${hiddenLineCount()} more line(s) ` : ""}
                          {diffQ.data!.truncated
                            ? "(output truncated at 100KB)"
                            : "(render capped)"}{" "}
                          — open the file to see the rest.
                        </div>
                      </Show>
                    </pre>
                  </Show>
                </div>
              </Show>
            </div>
          }
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 font-mono text-xs font-semibold text-primary">
              <span class="iconify mdi--source-branch size-4" />
              <span class="truncate max-w-[150px]">{branch()}</span>
            </div>

            <div class="flex items-center gap-2 text-[11px]">
              <span
                class="flex items-center gap-0.5"
                classList={{
                  "text-emerald-400 font-semibold": ahead() > 0,
                  "text-muted-foreground": ahead() === 0,
                }}
                title={`${ahead()} commit(s) ahead`}
              >
                <span class="iconify mdi--arrow-up size-3" />
                {ahead()}
              </span>
              <span
                class="flex items-center gap-0.5"
                classList={{
                  "text-amber-400 font-semibold": behind() > 0,
                  "text-muted-foreground": behind() === 0,
                }}
                title={`${behind()} commit(s) behind`}
              >
                <span class="iconify mdi--arrow-down size-3" />
                {behind()}
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span>Working Tree:</span>
            <span class={isDirty() ? "text-amber-400 font-medium" : "text-emerald-400 font-medium"}>
              {isDirty() ? "Uncommitted Changes" : "All Changes Committed"}
            </span>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handlePull}
              class="flex flex-1 items-center justify-center gap-1 rounded border border-border/60 bg-secondary/50 py-1 text-[11px] font-medium hover:bg-secondary active:scale-95 transition-all"
            >
              <span class="iconify mdi--download size-3.5" />
              Pull
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={ahead() === 0}
              class="flex flex-1 items-center justify-center gap-1 rounded border border-border/60 bg-primary/20 text-primary py-1 text-[11px] font-medium hover:bg-primary/30 disabled:opacity-40 active:scale-95 transition-all"
            >
              <span class="iconify mdi--upload size-3.5" />
              Push
            </button>
          </div>
        </Show>
      </div>
    </CanvasNodeContainer>
  );
};
