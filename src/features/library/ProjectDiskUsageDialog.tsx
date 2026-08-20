import { createQuery } from "@tanstack/solid-query";
import { For, Show, createEffect, createSignal } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useI18n } from "~/lib/i18n-context";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import { getDirSizeBreakdown } from "~/services/tauri/projects";

type Crumb = { name: string; path: string };

export function ProjectDiskUsageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectPath: string;
  projectSizeBytes: number;
}) {
  const { t } = useI18n();
  const [crumbs, setCrumbs] = createSignal<Crumb[]>([]);

  createEffect(() => {
    if (props.open) {
      setCrumbs([{ name: props.projectName, path: props.projectPath }]);
    }
  });

  const currentPath = () => {
    const c = crumbs();
    return c.length > 0 ? c[c.length - 1]!.path : props.projectPath;
  };

  const q = createQuery(() => ({
    queryKey: ["dir-size-breakdown", currentPath()],
    queryFn: async () => {
      const r = await getDirSizeBreakdown(currentPath());
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.open && currentPath().length > 0,
  }));

  const canGoBack = () => crumbs().length > 1;

  const goBack = () => {
    if (canGoBack()) {
      setCrumbs((prev) => prev.slice(0, -1));
    }
  };

  const navigateTo = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle class="text-sm font-bold">{props.projectName}</DialogTitle>
        </DialogHeader>

        <div class="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Show when={canGoBack()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 shrink-0 px-1.5 text-[10px]"
              onClick={goBack}
            >
              <span class="iconify mdi--arrow-left size-3.5" />
              {t("common.back") as string}
            </Button>
          </Show>
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <For each={crumbs()}>
              {(crumb, index) => (
                <>
                  <Show when={index() > 0}>
                    <span class="text-muted-foreground/40">/</span>
                  </Show>
                  <button
                    type="button"
                    class={cn(
                      "truncate rounded px-0.5 font-mono transition-colors hover:text-foreground",
                      index() === crumbs().length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:underline",
                    )}
                    disabled={index() === crumbs().length - 1}
                    onClick={() => navigateTo(index())}
                  >
                    {crumb.name}
                  </button>
                </>
              )}
            </For>
          </div>
        </div>

        <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px]">
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <span class="text-muted-foreground">{t("library.diskUsageOnDisk") as string}: </span>
              <span class="font-mono font-medium tabular-nums">
                <Show when={q.isSuccess && q.data} fallback="—">
                  {formatBytes(q.data!.totalBytes)}
                </Show>
              </span>
            </div>
            <Show when={props.projectSizeBytes > 0}>
              <div>
                <span class="text-muted-foreground">{t("library.diskUsageProjectSize") as string}: </span>
                <span class="font-mono font-medium tabular-nums">
                  {formatBytes(props.projectSizeBytes)}
                </span>
              </div>
            </Show>
          </div>
          <p class="mt-1 text-[10px] leading-snug text-muted-foreground/80">
            <Show when={crumbs().length === 1}>
              {t("library.diskUsageSkipNote") as string}
            </Show>
          </p>
        </div>

        <div class="max-h-72 overflow-y-auto rounded-md border border-border/40 bg-muted/10">
          <Show when={q.isPending}>
            <div class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <span class="iconify mdi--loading animate-spin size-4" />
              {t("library.diskUsageLoading") as string}
            </div>
          </Show>
          <Show when={q.isError}>
            <div class="py-10 text-center text-sm text-destructive">
              {t("library.diskUsageError") as string}
            </div>
          </Show>
          <Show when={q.isSuccess && q.data}>
            {(data) => (
              <Show
                when={data().entries.length > 0}
                fallback={
                  <div class="py-10 text-center text-sm text-muted-foreground">
                    {t("library.diskUsageEmpty") as string}
                  </div>
                }
              >
                <For each={data().entries}>
                  {(entry) => {
                    const pct =
                      data().totalBytes > 0
                        ? (entry.sizeBytes / data().totalBytes) * 100
                        : 0;
                    return (
                      <Show
                        when={entry.isDir}
                        fallback={
                          <div class="flex items-center gap-2 border-b border-border/20 px-3 py-2 last:border-b-0">
                            <span class="iconify mdi--file size-4 shrink-0 text-muted-foreground/60" />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5">
                                <span class="truncate font-mono text-xs">{entry.name}</span>
                                <Show when={entry.isSkip}>
                                  <Badge
                                    variant="secondary"
                                    class="h-4 shrink-0 px-1 text-[9px] font-normal"
                                  >
                                    {t("library.diskUsageSkipBadge") as string}
                                  </Badge>
                                </Show>
                              </div>
                              <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted/60">
                                <div
                                  class="h-full rounded-full bg-primary/50"
                                  style={{ width: `${Math.max(pct, entry.sizeBytes > 0 ? 2 : 0)}%` }}
                                />
                              </div>
                            </div>
                            <div class="shrink-0 text-right">
                              <span class="font-mono text-[10px] tabular-nums text-muted-foreground">
                                {formatBytes(entry.sizeBytes)}
                              </span>
                              <Show when={data().totalBytes > 0}>
                                <span class="ml-1 font-mono text-[9px] text-muted-foreground/50">
                                  {pct.toFixed(0)}%
                                </span>
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 border-b border-border/20 px-3 py-2 text-left last:border-b-0 hover:bg-primary/5"
                          onClick={() => {
                            setCrumbs((prev) => [
                              ...prev,
                              { name: entry.name, path: entry.path },
                            ]);
                          }}
                        >
                          <span class="iconify mdi--folder size-4 shrink-0 text-yellow-500/80" />
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                              <span class="truncate font-mono text-xs">{entry.name}</span>
                              <Show when={entry.isSkip}>
                                <Badge
                                  variant="secondary"
                                  class="h-4 shrink-0 px-1 text-[9px] font-normal"
                                >
                                  {t("library.diskUsageSkipBadge") as string}
                                </Badge>
                              </Show>
                            </div>
                            <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted/60">
                              <div
                                class="h-full rounded-full bg-primary/50"
                                style={{ width: `${Math.max(pct, entry.sizeBytes > 0 ? 2 : 0)}%` }}
                              />
                            </div>
                          </div>
                          <div class="shrink-0 text-right">
                            <span class="font-mono text-[10px] tabular-nums text-muted-foreground">
                              {formatBytes(entry.sizeBytes)}
                            </span>
                            <Show when={data().totalBytes > 0}>
                              <span class="ml-1 font-mono text-[9px] text-muted-foreground/50">
                                {pct.toFixed(0)}%
                              </span>
                            </Show>
                          </div>
                        </button>
                      </Show>
                    );
                  }}
                </For>
              </Show>
            )}
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
