import { createMemo, type Accessor } from "solid-js";
import { Show } from "solid-js";
import { StackIcon } from "~/components/StackIcon";
import {
  Combobox,
  ComboboxContent,
  ComboboxControl,
  ComboboxItem,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { TextField, TextFieldInput } from "~/components/ui/text-field";

type FilterOption = { value: string; label: string; textValue: string };

export function SidebarHeaderSearch(props: {
  search: Accessor<string>;
  setSearch: (v: string) => void;
  filter: Accessor<string>;
  setFilter: (v: string) => void;
  filterOptions: Accessor<FilterOption[]>;
  t: (k: string) => string;
  shortcutHint: string;
  onOpenCommandPalette?: () => void;
}) {
  const selectedFilterOption = createMemo(() => {
    return (
      props.filterOptions().find((o) => o.value === props.filter()) ??
      props.filterOptions()[0]
    );
  });

  return (
    <div class="flex items-center bg-sidebar-accent/15">
      <TextField class="flex-1">
        <TextFieldInput
          placeholder={`${props.t("common.search")} ${props.shortcutHint}`}
          class="h-9 border-0 bg-transparent text-xs focus-visible:ring-0 focus-visible:ring-offset-0 px-3 cursor-pointer placeholder:text-sidebar-foreground/40"
          value={props.search()}
          readOnly
          onClick={() => props.onOpenCommandPalette?.()}
          autocomplete="off"
        />
      </TextField>
      <div class="h-5 w-px bg-sidebar-border/30" />
      <Combobox<FilterOption>
        options={props.filterOptions()}
        optionValue="value"
        optionTextValue="textValue"
        optionLabel="label"
        value={selectedFilterOption()}
        onChange={(opt) => {
          if (opt) props.setFilter(opt.value);
        }}
        disallowEmptySelection
        defaultFilter="contains"
        itemComponent={(p) => {
          const opt = p.item.rawValue;
          const st = opt.value.startsWith("stack:")
            ? opt.value.slice(6)
            : null;
          return (
            <ComboboxItem item={p.item}>
              <span class="flex min-w-0 items-center gap-2">
                <Show when={st != null}>
                  <StackIcon
                    stack={st!}
                    class="h-3.5 w-3.5"
                    title={opt.label}
                  />
                </Show>
                <span class="truncate text-xs">{opt.label}</span>
              </span>
            </ComboboxItem>
          );
        }}
      >
        <ComboboxControl class="h-9 border-0 bg-transparent px-2">
          <ComboboxTrigger
            class="flex h-full w-auto items-center gap-0.5 opacity-70 hover:opacity-100"
            aria-label={props.t("library.filterLabel")}
          >
            <span
              class={
                props.filter() !== "all"
                  ? "iconify mdi--filter size-3.5 text-primary"
                  : "iconify mdi--filter-outline size-3.5"
              }
            />
            <span class="iconify mdi--chevron-down size-3" />
          </ComboboxTrigger>
        </ComboboxControl>
        <ComboboxContent />
      </Combobox>
    </div>
  );
}
