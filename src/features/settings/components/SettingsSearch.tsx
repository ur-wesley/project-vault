import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";

import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { SearchHighlightedText } from "~/features/clipboard-history/lib/highlight-search-text";
import { cn } from "~/lib/utils";

import { filterSettings, type SettingsSearchResult } from "../lib/settings-index";

export type SettingsSearchProps = Readonly<{
  t: (key: string) => string;
  onSelect: (item: SettingsSearchResult) => void;
}>;

export const SettingsSearch: Component<SettingsSearchProps> = (props) => {
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const results = createMemo(() => filterSettings(query(), props.t));
  const showDropdown = () => dropdownOpen() && query().trim().length > 0;

  createEffect(() => {
    query();
    setActiveIndex(0);
    setDropdownOpen(query().trim().length > 0);
  });

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!dropdownOpen()) return;
      const root = rootRef;
      if (root && !root.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

  const select = (item: SettingsSearchResult) => {
    props.onSelect(item);
    setQuery("");
    setDropdownOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setDropdownOpen(false);
      return;
    }

    const items = results();

    if (event.key === "Enter" && showDropdown()) {
      event.preventDefault();
      const item = items[activeIndex()];
      if (item) select(item);
      return;
    }

    if (!showDropdown() || items.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    }
  };

  return (
    <div ref={rootRef} class="relative w-full shrink-0">
      <TextField>
        <div class="relative">
          <span
            class="iconify mdi--magnify pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <TextFieldInput
            type="search"
            class="h-9 bg-muted/30 pl-9"
            placeholder={props.t("settings.searchPlaceholder")}
            aria-label={props.t("settings.searchAriaLabel")}
            value={query()}
            autocomplete="off"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onFocus={() => {
              if (query().trim().length > 0) setDropdownOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </TextField>
      <Show when={showDropdown()}>
        <div class="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <Show
            when={results().length > 0}
            fallback={
              <p class="px-3 py-4 text-center text-xs text-muted-foreground">
                {props.t("settings.searchEmpty")}
              </p>
            }
          >
            <ul class="max-h-72 overflow-y-auto py-1" role="listbox">
              <For each={results()}>
                {(item, index) => (
                  <li role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index() === activeIndex()}
                      class={cn(
                        "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/60",
                        index() === activeIndex() && "bg-muted/60",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(item)}
                      onMouseEnter={() => setActiveIndex(index())}
                    >
                      <span class="text-sm font-medium">
                        <SearchHighlightedText text={item.label} query={query()} />
                      </span>
                      <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <SearchHighlightedText text={item.tabLabel} query={query()} />
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  );
};
