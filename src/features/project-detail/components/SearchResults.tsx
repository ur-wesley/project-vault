import { For, Show, type Component } from "solid-js";

import type { useI18n } from "~/lib/i18n-context";
import { SearchResultItem } from "./SearchResultItem";
import type { createFileSearchModel } from "../model/useFileSearch";

type T = ReturnType<typeof useI18n>["t"];
type SearchModel = ReturnType<typeof createFileSearchModel>;

/**
 * Search-results overlay panel.
 * (Extracted verbatim from FileTree.)
 */
export const SearchResults: Component<{
  t: T;
  search: SearchModel;
  rootPath: string;
  onResultClick: (path: string, line: number, query: string) => void;
}> = (props) => {
  const { t, search, rootPath, onResultClick } = props;

  return (
    <div class="absolute inset-0 flex flex-col min-w-0 bg-card rounded-md border border-border/40 overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border/40 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="iconify mdi--magnify h-3.5 w-3.5 text-muted-foreground" />
          <span class="text-[10px] font-mono text-muted-foreground truncate">
            {t("projectDetail.searchResults") as string}
          </span>
        </div>
        <Show when={search.searchQ.isLoading}>
          <span class="text-[9px] text-muted-foreground animate-pulse">
            {t("projectDetail.searchLoading") as string}
          </span>
        </Show>
      </div>
      <div class="flex-1 overflow-auto p-3 space-y-2">
        <Show when={!search.searchQ.isLoading && search.filteredHits().length === 0}>
          <div class="flex items-center justify-center h-full text-muted-foreground text-xs italic">
            {t("projectDetail.searchEmpty") as string}
          </div>
        </Show>
        <For each={search.filteredHits()}>
          {(hit) => (
            <SearchResultItem
              hit={hit}
              rootPath={rootPath}
              topScore={search.topScore()}
              query={search.searchQuery()}
              onClick={onResultClick}
            />
          )}
        </For>
      </div>
    </div>
  );
};
