import { Show, type Component } from "solid-js";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectListbox,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export type KanbanSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = Readonly<{
  value: string;
  options: KanbanSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Visible label rendered above the trigger via Kobalte Select.Label. */
  label?: string;
  class?: string;
  disabled?: boolean;
}>;

/**
 * Single-select wrapper around ui/select (Kobalte) with the established
 * options/itemComponent pattern. An option with value "" acts as the
 * empty/clear choice (filters, "no parent", auto executor).
 */
export const KanbanSelect: Component<Props> = (props) => {
  return (
    <div class="grid gap-1">
      <Select
        options={props.options}
        optionValue="value"
        optionTextValue="label"
        optionDisabled="disabled"
        placeholder={props.placeholder ?? props.ariaLabel}
        value={props.options.find((o) => o.value === props.value) ?? null}
        onChange={(o) => {
          if (o) props.onChange(o.value);
        }}
        itemComponent={(p) => (
          <SelectItem item={p.item} class="pl-2">
            <Select.ItemLabel class="text-xs">{p.item.rawValue.label}</Select.ItemLabel>
          </SelectItem>
        )}
      >
        <Show when={props.label}>
          {(label) => (
            <Select.Label class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {label()}
            </Select.Label>
          )}
        </Show>
        <SelectTrigger
          class={`h-8 text-xs ${props.class ?? ""}`}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
        >
          <SelectValue<KanbanSelectOption>>
            {(s) => s.selectedOption()?.label ?? props.placeholder ?? ""}
          </SelectValue>
          <span class="iconify mdi--chevron-down size-4 shrink-0 opacity-50" />
        </SelectTrigger>
        <SelectContent>
          <SelectListbox />
        </SelectContent>
      </Select>
    </div>
  );
};
