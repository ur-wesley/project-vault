import { createQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { getLargestEntries } from "~/services/tauri/projects";
import { formatBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/ui/hover-card";
import { useI18n } from "~/lib/i18n-context";

export function LargestEntriesHoverIcon(props: {
  path: string;
}) {
  const { t } = useI18n();

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
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger
        as="button"
        type="button"
        class="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground/40 hover:bg-primary/10 hover:text-primary transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <span class="iconify mdi--information-outline h-3.5 w-3.5" />
      </HoverCardTrigger>
      <HoverCardContent class="w-60 p-3 shadow-xl border-border/40">
        <div class="space-y-2">
          <div class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("locations.largestEntries") as string}
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
      </HoverCardContent>
    </HoverCard>
  );
}
