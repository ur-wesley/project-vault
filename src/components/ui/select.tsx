import type { JSX, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { Select as KobalteSelect } from "@kobalte/core/select";
import type {
  SelectContentProps,
  SelectItemProps,
  SelectListboxProps,
  SelectTriggerProps,
  SelectValueProps,
} from "@kobalte/core/select";

import { cn } from "~/lib/utils";

const KTrigger = KobalteSelect.Trigger;
const KContent = KobalteSelect.Content;
const KPortal = KobalteSelect.Portal;
const KListbox = KobalteSelect.Listbox;
const KItem = KobalteSelect.Item;
const KValue = KobalteSelect.Value;

type AppSelectTriggerProps<T extends ValidComponent = "button"> = SelectTriggerProps<T> & {
  class?: string | undefined;
  children?: JSX.Element;
};

const SelectTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, AppSelectTriggerProps<T>>,
) => {
  const [local, others] = splitProps(props as AppSelectTriggerProps, ["class", "children"]);
  return (
    <KTrigger
      class={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:min-w-0 [&>span]:flex-1",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </KTrigger>
  );
};

type AppSelectContentProps<T extends ValidComponent = "div"> = SelectContentProps<T> & {
  class?: string | undefined;
  children?: JSX.Element;
};

const SelectContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, AppSelectContentProps<T>>,
) => {
  const [local, others] = splitProps(props as AppSelectContentProps, ["class", "children"]);
  return (
    <KPortal>
      <KContent
        class={cn(
          "relative z-[9999] min-w-32 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80",
          local.class,
        )}
        {...others}
      >
        {local.children}
      </KContent>
    </KPortal>
  );
};

type AppSelectListboxProps<Option, OptGroup, T extends ValidComponent = "ul"> = SelectListboxProps<
  Option,
  OptGroup,
  T
> & {
  class?: string | undefined;
};

const SelectListbox = <Option, OptGroup = never, T extends ValidComponent = "ul">(
  props: PolymorphicProps<T, AppSelectListboxProps<Option, OptGroup, T>>,
) => {
  const [local, others] = splitProps(props as AppSelectListboxProps<Option, OptGroup>, ["class"]);
  return (
    <KListbox
      class={cn("m-0 max-h-60 overflow-y-auto p-1 outline-none", local.class)}
      {...others}
    />
  );
};

type AppSelectItemProps = SelectItemProps & {
  class?: string | undefined;
};

const SelectItem = <T extends ValidComponent = "li">(
  props: PolymorphicProps<T, AppSelectItemProps>,
) => {
  const [local, others] = splitProps(props as AppSelectItemProps, ["class"]);
  return (
    <KItem
      class={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

type AppSelectValueProps<Option, T extends ValidComponent = "span"> = SelectValueProps<Option, T> & {
  class?: string | undefined;
};

const SelectValue = <Option, T extends ValidComponent = "span">(
  props: PolymorphicProps<T, AppSelectValueProps<Option, T>>,
) => {
  const [local, others] = splitProps(props as AppSelectValueProps<Option>, ["class"]);
  return (
    <KValue
      class={cn("min-w-0 flex-1 truncate", local.class)}
      {...others}
    />
  );
};

export const Select = Object.assign(KobalteSelect, {
  Trigger: SelectTrigger,
  Content: SelectContent,
  Listbox: SelectListbox,
  Item: SelectItem,
  Value: SelectValue,
});

export { SelectTrigger, SelectContent, SelectItem, SelectListbox, SelectValue };

export type { SelectRootProps } from "@kobalte/core/select";
