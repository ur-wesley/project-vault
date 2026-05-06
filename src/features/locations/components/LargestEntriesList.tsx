import { createQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { getLargestEntries } from "~/services/tauri";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/ui/hover-card";

type LargestEntriesListProps = {
  path: string;
};

export function LargestEntriesList(props: LargestEntriesListProps) {
  const q = createQuery(() => ({
    queryKey: ["largest-entries", props.path],
    queryFn: async () => {
      const r = await getLargestEntries(props.path, 8);
      if (r.isErr()) throw new Error(r.error.message);
      return r.value;
    },
    enabled: props.path.length > 0,
  }));

  return (
    <div class="w-56 space-y-2">
      <div class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        Largest entries
      </div>
      <Show when={q.isPending}>
        <div class="space-y-1.5">
          <For each={[1, 2, 3]}>
            {() => (
              <div class="flex items-center gap-2">
                <div class="h-3 w-3 rounded bg-muted animate-pulse" />
                <div class="h-2.5 flex-1 rounded bg-muted animate-pulse" />
                <div class="h-2.5 w-12 rounded bg-muted animate-pulse" />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={q.isError}>
        <p class="text-[10px] text-destructive">Could not load entries</p>
      </Show>
      <Show when={q.isSuccess && q.data}>
        <div class="space-y-1">
          <For each={q.data}>
            {(entry) => (
              <div class="flex items-center gap-1.5">
                <span
                  class={cn(
                    "shrink-0 h-3 w-3",
                    entry.isDir
                      ? "iconify mdi--folder-outline text-muted-foreground/60"
                      : "iconify mdi--file-outline text-muted-foreground/40",
                  )}
                />
                <span class="min-w-0 flex-1 truncate text-[10px] text-foreground/80">
                  {entry.name}
                </span>
                <span class="shrink-0 text-[10px] font-mono text-muted-foreground">
                  {formatBytes(entry.sizeBytes)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function LargestEntriesHoverCard(props: {
  path: string;
  children: any;
}) {
  return (
    <HoverCard gutter={4}>
      <HoverCardTrigger as="div">
        {props.children}
      </HoverCardTrigger>
      <HoverCardContent class="p-3 shadow-xl border-border/40">
        <LargestEntriesList path={props.path} />
      </HoverCardContent>
    </HoverCard>
  );
}
