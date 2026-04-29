import { splitProps, type Component, type ComponentProps, type ValidComponent } from "solid-js";
import { Polymorphic, type PolymorphicProps } from "@kobalte/core/polymorphic";
import { cn } from "~/lib/utils";

export const SidebarGroup: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      data-sidebar="group"
      class={cn(
        "relative flex w-full min-w-0 flex-col p-2 group-data-[collapsible=icon]:p-0",
        local.class,
      )}
      {...others}
    />
  );
};

export type SidebarGroupLabelProps<T extends ValidComponent = "div"> = ComponentProps<T>;

export const SidebarGroupLabel = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SidebarGroupLabelProps<T>>,
) => {
  const [local, others] = splitProps(props as any, ["class"]);

  return (
    <Polymorphic<SidebarGroupLabelProps>
      as="div"
      data-sidebar="group-label"
      class={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:hidden",
        local.class,
      )}
      {...others}
    />
  );
};

export type SidebarGroupActionProps<T extends ValidComponent = "button"> = ComponentProps<T>;

export const SidebarGroupAction = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SidebarGroupActionProps<T>>,
) => {
  const [local, others] = splitProps(props as any, ["class"]);
  return (
    <Polymorphic<SidebarGroupActionProps>
      as="button"
      data-sidebar="group-action"
      class={cn(
        "absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "after:absolute after:-inset-2 after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        local.class,
      )}
      {...others}
    />
  );
};

export const SidebarGroupContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div data-sidebar="group-content" class={cn("w-full text-sm", local.class)} {...others} />;
};
