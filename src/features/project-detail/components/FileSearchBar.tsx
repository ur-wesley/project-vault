import { Show, type Component } from "solid-js";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { formatBytes } from "~/lib/format-bytes";
import type { useI18n } from "~/lib/i18n-context";
import type { createFileSearchModel } from "../model/useFileSearch";

type T = ReturnType<typeof useI18n>["t"];
type SearchModel = ReturnType<typeof createFileSearchModel>;

/**
 * Sidebar search box: query input, index build/rebuild, collapse button.
 * (Extracted verbatim from FileTree.)
 */
export const FileSearchBar: Component<{
  t: T;
  search: SearchModel;
  onCollapse: () => void;
  onSearchInput: (value: string) => void;
  onClearSearch: () => void;
}> = (props) => {
  const { t, search, onCollapse } = props;

  return (
    <div class="flex items-center gap-1.5">
      <div class="relative flex-1">
        <span class="iconify mdi--magnify absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          class="w-full rounded-md bg-background border border-border/60 pl-7 pr-7 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder={t("projectDetail.searchFiles") as string}
          value={search.searchQuery()}
          onInput={(e) => props.onSearchInput(e.currentTarget.value)}
        />
        <Show when={search.searchQuery().length > 0}>
          <button
            class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={props.onClearSearch}
          >
            <span class="iconify mdi--close h-3 w-3" />
          </button>
        </Show>
      </div>

      <Show when={!search.indexMetaQ.data}>
        <Tooltip>
          <TooltipTrigger
            as="button"
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={search.indexBusy()}
            onClick={search.onIndexProject}
          >
            <Show when={search.indexBusy()}>
              <span class="iconify mdi--loading animate-spin h-3 w-3" />
            </Show>
            <span class="iconify mdi--database-plus h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{t("projectDetail.indexProject") as string}</TooltipContent>
        </Tooltip>
      </Show>

      <Show when={search.indexMetaQ.data}>
        {(meta) => (
          <Popover gutter={4}>
            <Tooltip>
              <TooltipTrigger as="div">
                <PopoverTrigger
                  as="button"
                  type="button"
                  class="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                >
                  <span class="iconify mdi--dots-vertical h-4 w-4" />
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("projectDetail.searchResults") as string}</TooltipContent>
            </Tooltip>
            <PopoverContent class="w-56 p-2.5 space-y-2 text-foreground shadow-xl border-border/40">
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {t("projectDetail.indexedFiles") as string}
                  </span>
                  <span class="text-[10px] font-mono font-bold">{meta().indexedFiles}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {t("projectDetail.indexSize") as string}
                  </span>
                  <span class="text-[10px] font-mono font-bold">
                    {formatBytes(meta().indexSizeBytes)}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[9px] text-muted-foreground uppercase tracking-wider">
                    {t("projectDetail.lastUpdated") as string}
                  </span>
                  <span class="text-[10px] font-mono">
                    {(() => {
                      const ms = meta().lastUpdatedMs;
                      return ms != null ? new Date(ms).toLocaleString() : "—";
                    })()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="w-full inline-flex items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                disabled={search.indexBusy()}
                onClick={search.onRebuildIndex}
              >
                <Show when={search.indexBusy()}>
                  <span class="iconify mdi--loading animate-spin h-3 w-3" />
                </Show>
                {t("projectDetail.rebuildIndex") as string}
              </button>
            </PopoverContent>
          </Popover>
        )}
      </Show>

      <Tooltip>
        <TooltipTrigger
          as="button"
          type="button"
          onClick={onCollapse}
          class="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
        >
          <span class="iconify mdi--chevron-left h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>Collapse Sidebar</TooltipContent>
      </Tooltip>
    </div>
  );
};
